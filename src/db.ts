import { getSchema, type JSONContent } from '@tiptap/core';
import { editorExtensions } from './editor';
import { EMPTY_DOC, IMAGE_TYPES, type Note } from './types';
import { pageKey, safeImageUrl } from './url';

let database: Promise<IDBDatabase> | undefined;
export function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('marginclip', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('notes', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('別のMarginClipを閉じて再度お試しください。'));
  });
}

export class ConflictError extends Error {
  constructor() { super('別のウィンドウでこのメモが更新されました。編集内容を退避して最新版を開いてください。'); }
}

export async function getNote(key: string): Promise<Note | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('notes').objectStore('notes').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listNotes(): Promise<Note[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('notes').objectStore('notes').getAll();
    request.onsuccess = () => resolve((request.result as Note[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  });
}

export async function putNote(note: Note, expectedRevision: number): Promise<Note> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('notes', 'readwrite');
    const store = transaction.objectStore('notes');
    const request = store.get(note.key);
    let conflict = false;
    const saved = { ...note, revision: expectedRevision + 1 };
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== expectedRevision) {
        conflict = true;
        transaction.abort();
      } else store.put(saved);
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(conflict ? new ConflictError() : transaction.error ?? new Error('保存が中断されました。'));
    transaction.onerror = () => reject(transaction.error);
  });
}

export function newNote(url: string, title: string): Note {
  const key = pageKey(url);
  if (!key) throw new Error('HTTP/HTTPSページを開いてください。');
  return { key, url, title, doc: structuredClone(EMPTY_DOC), markdown: '', updatedAt: new Date().toISOString(), revision: 0, article: null };
}

export function backupJson(notes: Note[]): string {
  return JSON.stringify({ format: 'marginclip-backup', version: 1, exportedAt: new Date().toISOString(), notes }, null, 2);
}

const nodeTypes = new Set(['doc', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'image']);
const markTypes = new Set(['bold', 'italic', 'strike', 'code', 'link']);
function validDoc(doc: unknown, depth = 0): doc is JSONContent {
  if (!doc || typeof doc !== 'object' || depth > 40) return false;
  const node = doc as JSONContent;
  if (!nodeTypes.has(node.type ?? '')) return false;
  if (node.type === 'text' && typeof node.text !== 'string') return false;
  if (node.type === 'heading' && ![1, 2, 3, 4, 5, 6].includes(node.attrs?.level)) return false;
  if (node.type === 'image' && (typeof node.attrs?.src !== 'string' || !safeImageUrl(node.attrs.src))) return false;
  if (node.marks && (!Array.isArray(node.marks) || !node.marks.every(mark => markTypes.has(mark.type) && (mark.type !== 'link' || /^https?:\/\//i.test(mark.attrs?.href ?? ''))))) return false;
  return !node.content || (Array.isArray(node.content) && node.content.every(child => validDoc(child, depth + 1)));
}

export function parseBackup(text: string): Note[] {
  const value = JSON.parse(text);
  if (value?.format !== 'marginclip-backup' || value.version !== 1 || !Array.isArray(value.notes) || value.notes.length > 10000) throw new Error('MarginClipのバックアップ（version 1）を選択してください。');
  const seen = new Set<string>();
  const schema = getSchema(editorExtensions());
  for (const note of value.notes) {
    if (!note || pageKey(note.url) !== note.key || !note.key || seen.has(note.key) || typeof note.title !== 'string' || typeof note.markdown !== 'string' || !Number.isInteger(note.revision) || note.revision < 0 || !Number.isFinite(Date.parse(note.updatedAt)) || note.doc?.type !== 'doc' || !validDoc(note.doc)) throw new Error('バックアップに不正なメモがあります。復元は行いませんでした。');
    try { schema.nodeFromJSON(note.doc).check(); } catch { throw new Error('バックアップのメモ構造が不正です。'); }
    if (note.article !== null) {
      const a = note.article;
      if (!a || typeof a.title !== 'string' || typeof a.markdown !== 'string' || pageKey(a.url) !== note.key || !Array.isArray(a.imageUrls) || !a.imageUrls.every((src: unknown) => typeof src === 'string' && safeImageUrl(src)) || typeof a.fallback !== 'boolean' || typeof a.extractedAt !== 'string' || !(a.byline === null || typeof a.byline === 'string') || !(a.publishedTime === null || typeof a.publishedTime === 'string')) throw new Error('バックアップの記事情報が不正です。');
    }
    seen.add(note.key);
  }
  return value.notes;
}

// Merge only absent URLs, in one atomic transaction. Existing notes are never overwritten.
export async function restoreNotes(notes: Note[]): Promise<number> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    let count = 0;
    for (const note of notes) {
      const req = store.get(note.key);
      req.onsuccess = () => {
        if (!req.result) { store.add({ ...note, revision: 1 }); count++; }
      };
    }
    tx.oncomplete = () => resolve(count);
    tx.onabort = () => reject(tx.error ?? new Error('復元が中断されました。'));
    tx.onerror = () => reject(tx.error);
  });
}

export function validateImage(file: File): void {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('PNG・JPEG・WebP・GIFの画像を選んでください。');
  if (file.size > 8 * 1024 * 1024) throw new Error('画像は1枚8MB以下にしてください。');
}
