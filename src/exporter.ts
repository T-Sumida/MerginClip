import { strToU8, zipSync, type Zippable } from 'fflate';
import type { JSONContent } from '@tiptap/core';
import { MAX_IMAGE_BYTES, errorText, type Note } from './types';
import { imageDestination, safeFilename, safeImageUrl } from './url';

export interface Bundle { files: Record<string, Uint8Array>; title: string; basename: string; folder: string; savedAt: Date; warnings: string[] }
export interface Archive { bytes: Uint8Array; filename: string; warnings: string[] }
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const mimeTypes: Record<string, string> = { ...Object.fromEntries(Object.entries(extensions).map(([type, ext]) => [ext, type])), md: 'text/markdown;charset=utf-8' };
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function imageSources(doc: JSONContent): string[] {
  const result: string[] = [];
  function visit(node: JSONContent) {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') result.push(node.attrs.src);
    node.content?.forEach(visit);
  }
  visit(doc);
  return result;
}

async function fetchImage(src: string, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; ext: string }> {
  if (!safeImageUrl(src)) throw new Error('未対応の画像URL');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(src, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext = extensions[type];
    if (!ext) throw new Error('未対応の画像形式');
    if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('8MBを超える画像');
    if (!response.body) throw new Error('画像データがありません');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('8MBを超える画像'); }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, ext };
  } finally { clearTimeout(timeout); }
}

function header(title: string, url: string, kind: 'article' | 'note', note: Note, savedAt: Date): string {
  // JSON string scalars are valid YAML, including multiline quotes and URLs.
  const fields: Record<string, string> = { title, source: url, type: kind, saved_at: savedAt.toISOString() };
  if (kind === 'article' && note.article) {
    if (note.article.byline) fields.author = note.article.byline;
    if (note.article.publishedTime) fields.published_at = note.article.publishedTime;
    fields.extracted_at = note.article.extractedAt;
  } else fields.updated_at = note.updatedAt;
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n`;
}

export async function createBundle(note: Note, fetcher: typeof fetch = fetch): Promise<Bundle> {
  const savedAt = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = `${savedAt.getFullYear()}${pad(savedAt.getMonth() + 1)}${pad(savedAt.getDate())}_${pad(savedAt.getHours())}${pad(savedAt.getMinutes())}${pad(savedAt.getSeconds())}`;
  const title = note.article?.title || note.title;
  const basename = `${timestamp}_${safeFilename(title)}`;
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  const article = note.article?.markdown || '記事本文を取得できませんでした。元のページを参照してください。';
  let markdown = note.markdown;
  const noteSources = new Set(imageSources(note.doc));
  // Article images keep their original Markdown URLs, even when a note uses the same image.
  const sources = [...noteSources];
  if (!note.article) warnings.push('記事本文を取得できなかったため、記事のMarkdownには元ページの情報のみ保存しています。');
  if (note.article?.fallback) warnings.push('記事を特定できなかったため、ページの本文領域から抽出しました。');
  const textWithoutImageData = (text: string) => sources.reduce((value, src) => src.startsWith('data:') ? value.replaceAll(src, 'assets/image') : value, text);
  let totalBytes = strToU8(article).length + strToU8(textWithoutImageData(markdown)).length;
  if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('保存データが64MBを超えています。');
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    try {
      if (i >= 60 && !src.startsWith('data:')) throw new Error('リモート画像は60枚まで');
      const image = await fetchImage(src, fetcher);
      if (totalBytes + image.bytes.length > MAX_ARCHIVE_BYTES) throw new Error('ZIP内のデータ上限64MB');
      totalBytes += image.bytes.length;
      const path = `assets/image-${String(i + 1).padStart(3, '0')}.${image.ext}`;
      files[path] = image.bytes;
      markdown = markdown.replaceAll(src, path).replaceAll(imageDestination(src), path);
    } catch (error) {
      if (src.startsWith('data:') && noteSources.has(src)) throw new Error(`メモの貼り付け画像を保存できません: ${errorText(error)}`);
      warnings.push(`画像 ${i + 1}: ${errorText(error)}。元の参照を保持しました。${src.startsWith('data:') ? '' : ` ${src}`}`);
    }
  }
  files[`${basename}_article.md`] = strToU8(header(title, note.url, 'article', note, savedAt) + article + '\n');
  files[`${basename}_note.md`] = strToU8(header(note.title, note.url, 'note', note, savedAt) + markdown + '\n');
  // Chrome renames conflicting files one by one, which would break assets/ references,
  // so each export gets its own folder even for the same title within one second.
  return { files, title: note.title, basename, folder: `MarginClip/${basename}_${crypto.randomUUID().slice(0, 8)}`, savedAt, warnings };
}

export async function createArchive(note: Note, fetcher: typeof fetch = fetch): Promise<Archive> {
  const { files, title, savedAt, warnings } = await createBundle(note, fetcher);
  // fflate's async ZIP spawns blob workers for large files, which MV3's CSP blocks.
  // Images are already compressed: store them directly and compress only text.
  const input: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) input[path] = path.startsWith('assets/') ? [bytes, { level: 0 }] : bytes;
  const bytes = zipSync(input, { level: 6 });
  return { bytes, filename: `MarginClip-${safeFilename(title)}-${savedAt.toISOString().slice(0, 10)}.zip`, warnings };
}

// The Downloads API cannot place several files in a user-chosen folder, so files go
// into one subfolder of the Downloads directory, keeping assets/ next to the Markdown.
export async function downloadBundle(bundle: Bundle): Promise<string> {
  const paths = Object.keys(bundle.files).sort((a, b) => Number(a.startsWith('assets/')) - Number(b.startsWith('assets/')) || a.localeCompare(b));
  for (const path of paths) {
    const type = mimeTypes[path.slice(path.lastIndexOf('.') + 1)] || 'application/octet-stream';
    await downloadBlob(new Blob([new Uint8Array(bundle.files[path])], { type }), `${bundle.folder}/${path}`, false);
  }
  return bundle.folder;
}

// Picks `name`, `name_2`, … so a chosen folder never has existing files overwritten.
async function freeName(directory: FileSystemDirectoryHandle, stem: string, ext = ''): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}${i === 1 ? '' : `_${i}`}${ext}`;
    try { await directory.getFileHandle(candidate); }
    catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return candidate;
      // A folder with that name exists.
      if ((error as DOMException).name !== 'TypeMismatchError') throw error;
    }
  }
  throw new Error('同じ名前のファイルが多すぎます。');
}

// Panels in other windows share this origin and may export into the same folder.
// Finding a free name and creating the entry must not interleave, or both exports
// could take the same name. Once created, the name is visibly taken, so writing
// the contents can happen outside the lock.
async function reserve<T>(create: () => Promise<T>): Promise<T> {
  return await navigator.locks.request('marginclip-export-name', create);
}

async function writeTo(file: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await file.createWritable();
  try { await writable.write(new Uint8Array(bytes)); await writable.close(); }
  catch (error) { await writable.abort().catch(() => undefined); throw error; }
}

async function writeFile(directory: FileSystemDirectoryHandle, path: string, bytes: Uint8Array) {
  const parts = path.split('/');
  let parent = directory;
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
  await writeTo(await parent.getFileHandle(parts.at(-1)!, { create: true }), bytes);
}

// Writes into a folder the user chose with the File System Access API.
export async function writeArchive(directory: FileSystemDirectoryHandle, archive: Archive): Promise<string> {
  const file = await reserve(async () => directory.getFileHandle(await freeName(directory, archive.filename.replace(/\.zip$/, ''), '.zip'), { create: true }));
  await writeTo(file, archive.bytes);
  return file.name;
}

export async function writeBundle(directory: FileSystemDirectoryHandle, bundle: Bundle): Promise<string> {
  const target = await reserve(async () => directory.getDirectoryHandle(await freeName(directory, bundle.basename), { create: true }));
  for (const [path, bytes] of Object.entries(bundle.files)) await writeFile(target, path, bytes);
  return target.name;
}

export async function downloadBlob(blob: Blob, filename: string, saveAs = true): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs });
    const dispose = () => { URL.revokeObjectURL(url); chrome.downloads.onChanged.removeListener(listener); clearTimeout(timeout); };
    const listener = (delta: chrome.downloads.DownloadDelta) => { if (delta.id === id && delta.state && delta.state.current !== 'in_progress') dispose(); };
    const timeout = setTimeout(dispose, 300000);
    chrome.downloads.onChanged.addListener(listener);
    return id;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
