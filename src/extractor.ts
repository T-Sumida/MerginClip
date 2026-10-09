import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import type { Article } from './types';
import { safeImageUrl } from './url';

function meta(doc: Document, selectors: string): string | null {
  return doc.querySelector(selectors)?.getAttribute('content')?.trim() || null;
}

export function extractArticle(doc: Document): Article {
  const url = doc.location?.href || doc.URL;
  const clone = doc.cloneNode(true) as Document;
  // Readability safely reads JSON-LD metadata; keep it until parsing is complete.
  clone.querySelectorAll('script:not([type="application/ld+json"]), style, noscript, iframe, form, button, input, textarea, select, svg, canvas').forEach(node => node.remove());
  // Resolve relative and lazy-loaded images while the source DOM still has a base URL.
  clone.querySelectorAll('img').forEach(image => {
    const original = image.getAttribute('data-src') || image.getAttribute('data-original') || image.getAttribute('src');
    try {
      if (original) image.setAttribute('src', new URL(original, doc.baseURI).href);
      else image.remove();
    } catch { image.remove(); }
    image.removeAttribute('srcset');
  });
  clone.querySelectorAll('a[href]').forEach(link => {
    try {
      const resolved = new URL(link.getAttribute('href')!, doc.baseURI);
      if (['http:', 'https:', 'mailto:'].includes(resolved.protocol)) link.setAttribute('href', resolved.href);
      else link.removeAttribute('href');
    } catch { link.removeAttribute('href'); }
  });
  let parsed: ReturnType<Readability['parse']> = null;
  try { parsed = new Readability(clone, { maxElemsToParse: 50000 }).parse(); } catch { /* Fall back to the main content. */ }
  const fallback = !parsed?.content?.trim();
  const source = parsed?.content || (clone.querySelector('article, main, [role="main"]') || clone.body)?.innerHTML || '';
  const container = doc.createElement('div');
  container.innerHTML = DOMPurify.sanitize(source, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'video', 'audio', 'iframe'], FORBID_ATTR: ['style', 'srcset'] });
  const imageUrls = new Set<string>();
  container.querySelectorAll('img').forEach(image => {
    const src = image.getAttribute('src') ?? '';
    if (!safeImageUrl(src)) image.remove();
    else imageUrls.add(src);
  });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  converter.addRule('safeImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const image = node as HTMLImageElement;
      const src = image.getAttribute('src') ?? '';
      const alt = (image.getAttribute('alt') || '画像').replace(/[\[\]\\\r\n]/g, ' ');
      return `![${alt}](<${src}>)`;
    },
  });
  return {
    title: parsed?.title || meta(doc, 'meta[property="og:title"]') || doc.title || '無題のページ',
    url,
    markdown: converter.turndown(container.innerHTML).trim(),
    byline: parsed?.byline || meta(doc, 'meta[name="author"], meta[property="article:author"]'),
    publishedTime: parsed?.publishedTime || meta(doc, 'meta[property="article:published_time"], meta[name="date"], meta[itemprop="datePublished"]') || doc.querySelector('time[datetime]')?.getAttribute('datetime') || null,
    extractedAt: new Date().toISOString(),
    imageUrls: [...imageUrls],
    fallback,
  };
}

export function extractCurrentPage(): Article { return extractArticle(document); }
