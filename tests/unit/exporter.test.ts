import { strFromU8, unzipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { createArchive, createBundle, downloadBundle, writeArchive, writeBundle } from '../../src/exporter';
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

it('saves the same Markdown and assets as separate files in one Downloads subfolder', async () => {
  const note = newNote('https://example.com/read', '記事:個別保存');
  const src = 'data:image/png;base64,aGVsbG8=';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  note.markdown = `![貼付](${src})`;
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const bundle = await createBundle(note, fetcher);
  expect(bundle.folder).toMatch(/^MarginClip\/\d{8}_\d{6}_記事-個別保存_[0-9a-f]{8}$/);
  expect((await createBundle(note, fetcher)).folder).not.toBe(bundle.folder);
  const download = vi.fn(async (_options: chrome.downloads.DownloadOptions) => download.mock.calls.length);
  vi.stubGlobal('chrome', { downloads: { download, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
  try {
    expect(await downloadBundle(bundle)).toBe(bundle.folder);
  } finally { vi.unstubAllGlobals(); }
  const options = download.mock.calls.map(([value]) => value);
  expect(options.map(value => value.filename)).toEqual([
    expect.stringMatching(/_article\.md$/),
    expect.stringMatching(/_note\.md$/),
    `${bundle.folder}/assets/image-001.png`,
  ]);
  for (const value of options) {
    expect(value.filename!.startsWith(`${bundle.folder}/`)).toBe(true);
    expect(value.saveAs).toBe(false);
  }
  expect(strFromU8(bundle.files[options[1].filename!.slice(bundle.folder.length + 1)])).toContain('![貼付](assets/image-001.png)');
  const archive = unzipSync((await createArchive(note, fetcher)).bytes);
  expect(Object.keys(archive).map(path => path.replace(/^\d{8}_\d{6}_/, '')).sort()).toEqual(Object.keys(bundle.files).map(path => path.replace(/^\d{8}_\d{6}_/, '')).sort());
});

// A minimal in-memory File System Access directory, enough for the export writer.
class MemoryDirectory {
  kind = 'directory' as const;
  entries = new Map<string, MemoryDirectory | Uint8Array>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name);
    if (entry instanceof MemoryDirectory) return entry;
    if (entry) throw new DOMException('file', 'TypeMismatchError');
    if (!options?.create) throw new DOMException('missing', 'NotFoundError');
    const directory = new MemoryDirectory(name);
    this.entries.set(name, directory);
    return directory;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const entry = this.entries.get(name);
    if (entry instanceof MemoryDirectory) throw new DOMException('directory', 'TypeMismatchError');
    if (!entry && !options?.create) throw new DOMException('missing', 'NotFoundError');
    return { createWritable: async () => {
      let data: Uint8Array = new Uint8Array();
      return { write: async (bytes: Uint8Array) => { data = bytes; }, close: async () => { this.entries.set(name, data); }, abort: async () => undefined };
    } };
  }
  file(path: string): Uint8Array {
    const parts = path.split('/');
    let current: MemoryDirectory = this;
    for (const part of parts.slice(0, -1)) current = current.entries.get(part) as MemoryDirectory;
    return current.entries.get(parts.at(-1)!) as Uint8Array;
  }
}

it('writes Markdown, assets and ZIPs directly into a chosen folder without overwriting', async () => {
  const note = newNote('https://example.com/read', 'Node.js 入門');
  const src = 'data:image/png;base64,aGVsbG8=';
  note.doc = { type: 'doc', content: [{ type: 'image', attrs: { src } }] };
  note.markdown = `![貼付](${src})`;
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const directory = new MemoryDirectory('notes-repo');
  const handle = directory as unknown as FileSystemDirectoryHandle;
  const bundle = await createBundle(note, fetcher);
  expect(await writeBundle(handle, bundle)).toBe(bundle.basename);
  expect(bundle.basename).toMatch(/^\d{8}_\d{6}_Node\.js 入門$/);
  expect(strFromU8(directory.file(`${bundle.basename}/${bundle.basename}_note.md`))).toContain('![貼付](assets/image-001.png)');
  expect([...directory.file(`${bundle.basename}/assets/image-001.png`)]).toEqual([1, 2, 3]);
  // The same second and title gets a numbered folder instead of mixing files.
  expect(await writeBundle(handle, bundle)).toBe(`${bundle.basename}_2`);
  expect(directory.file(`${bundle.basename}_2/${bundle.basename}_article.md`)).toBeDefined();

  const archive = await createArchive(note, fetcher);
  expect(await writeArchive(handle, archive)).toBe(archive.filename);
  expect(await writeArchive(handle, archive)).toBe(archive.filename.replace(/\.zip$/, '_2.zip'));
  expect(Object.keys(unzipSync(directory.file(archive.filename)))).toContain('assets/image-001.png');
});
