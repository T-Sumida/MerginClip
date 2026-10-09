import { describe, expect, it } from 'vitest';
import { backupJson, ConflictError, getNote, newNote, parseBackup, putNote, restoreNotes, validateImage } from '../../src/db';
import { pageKey, safeFilename } from '../../src/url';

describe('URL identity and filesystem portability', () => {
  it('shares fragments while preserving queries, order, and trailing slash', () => {
    expect(pageKey('https://EXAMPLE.com:443/read?a=1#part')).toBe('https://example.com/read?a=1');
    expect(pageKey('https://example.com/read?a=2')).not.toBe(pageKey('https://example.com/read?a=1'));
    expect(pageKey('https://example.com/read/')).not.toBe(pageKey('https://example.com/read'));
    expect(pageKey('chrome://settings')).toBeNull();
    expect(pageKey('file:///test')).toBeNull();
    expect(pageKey('invalid')).toBeNull();
  });
  it('handles forbidden Windows filenames and empty titles', () => {
    expect(safeFilename('CON')).toBe('_CON');
    expect(safeFilename('NUL.txt')).toBe('_NUL.txt');
    expect(safeFilename('a:b/c?')).toBe('a-b-c-');
    expect(safeFilename('   ')).toBe('untitled');
  });
});

describe('autosave, conflict detection and backup', () => {
  it('commits and restores Japanese text and image data', async () => {
    const note = newNote('https://example.com/read#here', '記事');
    note.doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'メモ' }] }, { type: 'image', attrs: { src: 'data:image/png;base64,aGVsbG8=' } }] };
    note.markdown = 'メモ\n\n![画像](data:image/png;base64,aGVsbG8=)';
    const saved = await putNote(note, 0);
    expect(await getNote(note.key)).toEqual(saved);
    expect(parseBackup(backupJson([saved]))).toEqual([saved]);
  });
  it('rejects simultaneous stale writes without overwriting the newer memo', async () => {
    const a = newNote('https://example.com/read', 'A');
    const b = { ...a, title: 'B' };
    const results = await Promise.allSettled([putNote(a, 0), putNote(b, 0)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ConflictError);
    expect((await getNote(a.key))?.revision).toBe(1);
  });
  it('merges missing notes and never overwrites an existing URL', async () => {
    const a = newNote('https://example.com/a', '現行');
    await putNote(a, 0);
    expect(await restoreNotes([{ ...a, title: '旧版' }, newNote('https://example.com/b', '復元')])).toBe(1);
    expect((await getNote(a.key))?.title).toBe('現行');
    expect((await getNote('https://example.com/b'))?.title).toBe('復元');
  });
  it('rejects invalid, duplicate, or malicious backup records before importing', () => {
    const a = newNote('https://example.com/a', '記事');
    expect(() => parseBackup(backupJson([a, a]))).toThrow();
    expect(() => parseBackup(backupJson([{ ...a, key: 'https://example.com/b' }]))).toThrow();
    a.doc = { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] };
    expect(() => parseBackup(backupJson([a]))).toThrow();
    a.doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'heading', attrs: { level: 1 } }] }] };
    expect(() => parseBackup(backupJson([a]))).toThrow('構造');
  });
  it('rejects oversized or unsupported pasted files', () => {
    expect(() => validateImage(new File(['x'], 'vector.svg', { type: 'image/svg+xml' }))).toThrow();
    expect(() => validateImage(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))).toThrow();
  });
});
