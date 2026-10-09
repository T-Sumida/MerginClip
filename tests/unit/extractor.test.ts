import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { extractArticle } from '../../src/extractor';

it('extracts article metadata and resolves lazy image and link URLs without mutating the page', () => {
  const dom = new JSDOM(`<title>記事タイトル</title><meta name="author" content="著者"><meta property="article:published_time" content="2026-10-09"><article><h1>記事タイトル</h1><p>${'実際に読む記事の本文です。'.repeat(70)}</p><h2>見出し</h2><p><strong>大切な部分</strong>と<a href="/reference">参考資料</a>。</p><img data-src="/image.png" alt="図"><img src="javascript:alert(1)"><script>window.evil=1</script><p onclick="alert(1)">続き</p></article>`, { url: 'https://example.com/read' });
  const original = dom.window.document.documentElement.outerHTML;
  const article = extractArticle(dom.window.document);
  expect(article.title).toBe('記事タイトル');
  expect(article.byline).toBe('著者');
  expect(article.publishedTime).toBe('2026-10-09');
  expect(article.markdown).toContain('**大切な部分**');
  expect(article.markdown).toContain('https://example.com/reference');
  expect(article.imageUrls).toEqual(['https://example.com/image.png']);
  expect(article.markdown).not.toContain('javascript:');
  expect(article.markdown).not.toContain('onclick');
  expect(dom.window.document.documentElement.outerHTML).toBe(original);
});

it('handles pages without a recognizable article using a labeled fallback', () => {
  const dom = new JSDOM('<title>短いページ</title><main><h2>概要</h2><p>短いメモ。</p></main>', { url: 'https://example.com/short' });
  const article = extractArticle(dom.window.document);
  expect(article.markdown).toContain('短いメモ。');
  expect(article.url).toBe('https://example.com/short');
});

it('preserves author and publication metadata supplied only through JSON-LD', () => {
  const data = JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: '構造化された記事', author: { '@type': 'Person', name: '構造化データの著者' }, datePublished: '2026-10-09T12:00:00+09:00' });
  const dom = new JSDOM(`<title>構造化された記事</title><script type="application/ld+json">${data}</script><article><h1>構造化された記事</h1><p>${'構造化データを含む記事本文です。'.repeat(80)}</p></article>`, { url: 'https://example.com/structured' });
  const article = extractArticle(dom.window.document);
  expect(article.byline).toBe('構造化データの著者');
  expect(article.publishedTime).toBe('2026-10-09T12:00:00+09:00');
  expect(article.markdown).not.toContain('@context');
});
