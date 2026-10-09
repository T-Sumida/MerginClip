import { strFromU8, unzipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { createArchive } from '../../src/exporter';
import { newNote } from '../../src/db';

function markdownFile(files: Record<string, Uint8Array>, kind: 'note' | 'article'): Uint8Array {
  const path = Object.keys(files).find(path => path.endsWith(`_${kind}.md`));
  expect(path).toMatch(/^\d{8}_\d{6}_.+_(note|article)\.md$/);
  return files[path!];
}

it('exports article image URLs and local note images in separate Markdown documents', async () => {
  const note = newNote('https://example.com/read', '記事:読書');
  const src = 'data:image/png;base64,aGVsbG8=';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  note.markdown = `# メモ\n\n![貼付](${src})`;
  note.article = { title: '記事タイトル', url: note.url, markdown: '本文\n\n![図](<https://example.com/image.png>)', byline: '著者', publishedTime: '2026-10-09', extractedAt: new Date().toISOString(), imageUrls: ['https://example.com/image.png'], fallback: false };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1,2,3]), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const archive = await createArchive(note, fetcher);
  const files = unzipSync(archive.bytes);
  expect(strFromU8(markdownFile(files, 'article'))).toContain('author: "著者"');
  expect(strFromU8(markdownFile(files, 'article'))).toContain('![図](<https://example.com/image.png>)');
  expect(strFromU8(markdownFile(files, 'article'))).not.toContain('assets/');
  expect(strFromU8(markdownFile(files, 'note'))).toContain('assets/image-001.png');
  expect(strFromU8(markdownFile(files, 'note'))).not.toContain('data:image');
  expect(Object.keys(files)).toContain('assets/image-001.png');
  expect(Object.keys(files).filter(path => path.startsWith('assets/'))).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(src, expect.any(Object));
  expect(Object.keys(files).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^\d{8}_\d{6}_記事タイトル_article\.md$/), expect.stringMatching(/^\d{8}_\d{6}_記事タイトル_note\.md$/), 'assets/image-001.png']));
  expect(Object.keys(files)).toHaveLength(3);
  expect(archive.warnings).toEqual([]);
  expect(archive.filename).not.toContain(':');
  expect(archive.filename).toMatch(/^MarginClip-.*\.zip$/);
});

it('keeps remote references and reports image failures while saving the memo', async () => {
  const note = newNote('https://example.com/read', '記事');
  note.article = { title: '記事', url: note.url, markdown: '![図](https://example.com/private.png)', byline: null, publishedTime: null, extractedAt: new Date().toISOString(), imageUrls: ['https://example.com/private.png'], fallback: false };
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/note-private.png' } }] };
  note.markdown = '![メモの図](https://example.com/note-private.png)';
  const fetcher = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch;
  const archive = await createArchive(note, fetcher);
  const files = unzipSync(archive.bytes);
  expect(strFromU8(markdownFile(files, 'article'))).toContain('https://example.com/private.png');
  expect(strFromU8(markdownFile(files, 'note'))).toContain('https://example.com/note-private.png');
  expect(archive.warnings[0]).toContain('HTTP 403');
  expect(archive.warnings).toHaveLength(1);
});

it('never downloads article-only images or adds download warnings for their URLs', async () => {
  const note = newNote('https://example.com/read', '記事');
  const markdown = '![図](<https://example.com/private.png>)\n\n![ベクター](https://example.com/diagram.svg)';
  note.article = { title: '記事', url: note.url, markdown, byline: null, publishedTime: null, extractedAt: new Date().toISOString(), imageUrls: ['https://example.com/private.png', 'https://example.com/diagram.svg'], fallback: false };
  const fetcher = vi.fn(async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
  const archive = await createArchive(note, fetcher);
  const files = unzipSync(archive.bytes);
  expect(fetcher).not.toHaveBeenCalled();
  expect(strFromU8(markdownFile(files, 'article'))).toContain(markdown);
  expect(Object.keys(files).filter(path => path.startsWith('assets/'))).toEqual([]);
  expect(archive.warnings).toEqual([]);
});

it('keeps an article image URL even when the same image is bundled for the note', async () => {
  const note = newNote('https://example.com/read', '記事');
  const src = 'https://example.com/shared.png';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  note.markdown = `![メモ](<${src}>)`;
  note.article = { title: '記事', url: note.url, markdown: `![記事](<${src}>)`, byline: null, publishedTime: null, extractedAt: new Date().toISOString(), imageUrls: [src], fallback: false };
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const archive = await createArchive(note, fetcher);
  const files = unzipSync(archive.bytes);
  expect(strFromU8(markdownFile(files, 'article'))).toContain(`![記事](<${src}>)`);
  expect(strFromU8(markdownFile(files, 'note'))).toContain('![メモ](<assets/image-001.png>)');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('fails explicitly if a pasted image cannot be included instead of silently losing it', async () => {
  const note = newNote('https://example.com/read', '記事');
  const src = 'data:image/png;base64,aGVsbG8=';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  const fetcher = vi.fn(async () => { throw new Error('failure'); }) as unknown as typeof fetch;
  await expect(createArchive(note, fetcher)).rejects.toThrow('貼り付け画像');
});

it('rewrites escaped Markdown destinations for image URLs containing spaces', async () => {
  const note = newNote('https://example.com/read', '記事');
  const src = 'https://example.com/my image.png';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  note.markdown = '![画像](<https://example.com/my%20image.png>)';
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const archive = await createArchive(note, fetcher);
  expect(strFromU8(markdownFile(unzipSync(archive.bytes), 'note'))).toContain('![画像](<assets/image-001.png>)');
});

it('uses one local save timestamp and a safe shared article title, without extra files', async () => {
  const savedAt = new Date(2026, 9, 10, 1, 2, 3);
  vi.useFakeTimers();
  vi.setSystemTime(savedAt);
  try {
    const note = newNote('https://example.com/read', '古いタイトル');
    note.article = { title: '記事:タイトル/例', url: note.url, markdown: '本文', byline: null, publishedTime: null, extractedAt: savedAt.toISOString(), imageUrls: [], fallback: false };
    const files = unzipSync((await createArchive(note)).bytes);
    expect(Object.keys(files).sort()).toEqual(['20261010_010203_記事-タイトル-例_article.md', '20261010_010203_記事-タイトル-例_note.md']);
    for (const bytes of Object.values(files)) expect(strFromU8(bytes)).toContain(`saved_at: "${savedAt.toISOString()}"`);
  } finally { vi.useRealTimers(); }
});
