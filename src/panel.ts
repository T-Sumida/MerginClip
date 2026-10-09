import type { Editor } from '@tiptap/core';
import { backupJson, ConflictError, getNote, listNotes, newNote, parseBackup, putNote, restoreNotes, validateImage } from './db';
import { createNoteEditor } from './editor';
import { createArchive, downloadBlob } from './exporter';
import { errorText, type Article, type Note } from './types';
import { pageKey } from './url';
import './panel.css';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}
const exportButton = el<HTMLButtonElement>('export');
const refreshButton = el<HTMLButtonElement>('refresh');
const imageInput = el<HTMLInputElement>('image-file');
let editor: Editor | undefined;
let note: Note | undefined;
let currentTabId: number | undefined;
let windowId: number;
let following = true;
let generation = 0;
let sequence = 0;
let saving: Promise<void> = Promise.resolve();
let images: Promise<void> = Promise.resolve();
let navigation: Promise<void> = Promise.resolve();
let extraction: Promise<void> = Promise.resolve();
let saveFailed = false;
let exporting = false;
let transitioning = false;
let libraryNotes: Note[] = [];

function message(text: string, error = false) {
  el('message').textContent = text;
  el('message').classList.toggle('error', error);
  el('message').hidden = !text;
}

function saveStatus(text: string, state = '') {
  el('save-status').textContent = text;
  el('save-status').className = state;
}

function controls() {
  exportButton.disabled = !note || exporting;
  refreshButton.disabled = !note || !following || currentTabId === undefined || transitioning;
  document.querySelectorAll<HTMLButtonElement>('#toolbar button').forEach(button => button.disabled = !editor || saveFailed || transitioning);
}

function updateToolbar(current: Editor) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('#toolbar button[data-command]')) {
    const cmd = button.dataset.command!;
    if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(current.isActive(cmd === 'heading' ? 'heading' : cmd)));
    if (cmd === 'undo') button.disabled = !current.can().undo() || saveFailed;
    if (cmd === 'redo') button.disabled = !current.can().redo() || saveFailed;
  }
}

function queueSave(target: Note) {
  if (saveFailed) return;
  const snapshot = structuredClone(target);
  const seq = ++sequence;
  saveStatus('保存中…', 'saving');
  // Start a transaction on each edit. The queue prevents older writes overtaking newer edits.
  saving = saving.then(async () => {
    if (saveFailed) return;
    const saved = await putNote(snapshot, target.revision);
    target.revision = saved.revision;
    if (target === note && seq === sequence) saveStatus('✓ 保存済み');
  }).catch(error => {
    saveFailed = true;
    editor?.setEditable(false, false);
    saveStatus('保存できません', 'error');
    message(error instanceof ConflictError ? error.message : `ローカル保存に失敗しました: ${errorText(error)}。編集内容を退避して再度開いてください。`, true);
    el('conflict-actions').hidden = false;
    controls();
  });
}

function changed(current: Editor) {
  if (!note) return;
  note.doc = current.getJSON();
  note.markdown = current.getMarkdown();
  note.updatedAt = new Date().toISOString();
  el('word-count').textContent = `${current.getText().replace(/\s/g, '').length.toLocaleString('ja-JP')} 文字`;
  queueSave(note);
  updateToolbar(current);
}

function readImage(file: File): Promise<string> {
  validateImage(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function addImages(files: File[], position?: number) {
  const target = editor;
  if (!target || saveFailed) return;
  const selection = position ?? target.state.selection.from;
  images = images.then(async () => {
    // Capture both editor and selection before FileReader yields or a page changes.
    const sources = await Promise.all(files.map(readImage));
    if (target.isDestroyed) throw new Error('画像を追加するページを再度開いてください。');
    const inserted = target.commands.insertContentAt(Math.min(selection, target.state.doc.content.size), sources.map((src, index) => ({ type: 'image', attrs: { src, alt: files[index].name || '貼り付け画像' } })));
    if (!inserted) throw new Error('この位置に画像を挿入できませんでした。');
    target.commands.focus();
  }).catch(error => message(errorText(error), true));
}

function showNote(target: Note) {
  transitioning = false;
  editor?.destroy();
  el('editor').replaceChildren();
  note = target;
  saveFailed = false;
  el('conflict-actions').hidden = true;
  editor = createNoteEditor({ element: el('editor'), doc: target.doc, onUpdate: changed, onSelection: updateToolbar, onImages: addImages });
  el('page-title').textContent = target.title;
  const link = el<HTMLAnchorElement>('page-url');
  link.href = target.url;
  link.textContent = target.url;
  link.title = target.url;
  el('page-mode').textContent = following ? 'CURRENT PAGE' : 'SAVED NOTE';
  el('follow').hidden = following;
  el('word-count').textContent = `${editor.getText().replace(/\s/g, '').length.toLocaleString('ja-JP')} 文字`;
  saveStatus(target.revision ? '✓ 保存済み' : 'ローカルに自動保存');
  el('article-status').textContent = target.article ? (target.article.fallback ? '本文領域から取得済み' : '記事を取得済み') : '記事未取得';
  controls();
  updateToolbar(editor);
}

async function leaveNote(): Promise<boolean> {
  transitioning = true;
  editor?.setEditable(false, false);
  controls();
  await images;
  let pending: Promise<void>;
  do { pending = saving; await pending; } while (pending !== saving);
  if (saveFailed) {
    transitioning = false;
    controls();
    message('保存できていない編集内容があります。「編集内容を退避して最新版を開く」で退避してください。', true);
    return false;
  }
  return true;
}

async function extract(tabId: number, target: Note, version: number) {
  if (target === note) el('article-status').textContent = '記事を取得中…';
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['extractor.js'] });
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      return (globalThis as unknown as { MarginClipExtractor: { extractCurrentPage: () => Article } }).MarginClipExtractor.extractCurrentPage();
    } });
    const article = results[0]?.result as Article | undefined;
    if (version !== generation || target !== note) return;
    if (!article || pageKey(article.url) !== target.key) throw new Error('ページが移動しました。記事を再取得してください。');
    if (!article.markdown) throw new Error('本文が見つかりませんでした。');
    target.article = article;
    target.title = article.title;
    el('page-title').textContent = article.title;
    el('article-status').textContent = `${article.fallback ? '本文領域から取得' : '記事取得済み'} · ${article.markdown.length.toLocaleString('ja-JP')} 文字`;
    if (article.fallback) message('記事を特定できなかったため、ページの本文領域から取得しました。保存後の記事のMarkdownをご確認ください。');
    if (target.revision || target.markdown) queueSave(target);
  } catch (error) {
    if (version !== generation || target !== note) return;
    el('article-status').textContent = target.article ? '再取得失敗 · 前回の本文を保持' : '本文を取得できません';
    message(`記事の取得に失敗しました。メモは利用できます。${errorText(error)}`, true);
  }
}

async function syncActive(force = false) {
  if (!following && !force) return;
  const tabs = await chrome.tabs.query({ active: true, windowId });
  const tab = tabs[0];
  const key = pageKey(tab?.url ?? '');
  if (!force && key && key === note?.key && tab?.id === currentTabId) return;
  if (!await leaveNote()) return;
  const version = ++generation;
  following = true;
  currentTabId = tab?.id;
  message('');
  if (!key || tab?.id === undefined) {
    transitioning = false;
    editor?.destroy(); editor = undefined; note = undefined;
    el('editor').replaceChildren();
    el('page-title').textContent = 'Webページを開いてください';
    el<HTMLAnchorElement>('page-url').removeAttribute('href');
    el('page-url').textContent = '';
    el('article-status').textContent = 'HTTP / HTTPS のページに対応';
    el('word-count').textContent = '0 文字';
    el('page-mode').textContent = 'CURRENT PAGE';
    el('follow').hidden = true;
    saveStatus('');
    message('Chromeの設定画面・新しいタブ・Webストア・PDFビューアでは記事を取得できません。通常のWebページでご利用ください。');
    controls();
    return;
  }
  const stored = await getNote(key);
  showNote(stored ?? newNote(tab.url!, tab.title || '無題のページ'));
  if (!stored?.article || force) extraction = extract(tab.id, note!, version);
}

function navigate(task: () => Promise<void>) {
  navigation = navigation.then(task).catch(error => {
    transitioning = false;
    editor?.setEditable(!saveFailed, false);
    controls();
    message(`ページを開けませんでした: ${errorText(error)}`, true);
  });
}

async function renderLibrary() {
  libraryNotes = await listNotes();
  el('note-count').textContent = String(libraryNotes.length);
  filterLibrary();
}

function filterLibrary() {
  const search = el<HTMLInputElement>('search').value.trim().toLocaleLowerCase();
  const list = el('note-list');
  list.replaceChildren();
  for (const item of libraryNotes.filter(item => `${item.title}\n${item.url}\n${item.markdown}`.toLocaleLowerCase().includes(search))) {
    const button = document.createElement('button');
    button.className = 'library-note';
    const title = document.createElement('span'); title.className = 'library-title'; title.textContent = item.title;
    const url = document.createElement('span'); url.className = 'library-url'; url.textContent = `${new URL(item.url).hostname} · ${new Date(item.updatedAt).toLocaleDateString('ja-JP')}`;
    button.append(title, url);
    button.addEventListener('click', () => navigate(async () => {
      if (!await leaveNote()) return;
      const latest = await getNote(item.key);
      if (!latest) return;
      following = false;
      generation++;
      showNote(latest);
      message('保存済みメモを表示しています。ページ移動に追従するには「閲覧中のページへ戻る」を押してください。');
      el('library').hidden = true;
      el('library-toggle').setAttribute('aria-expanded', 'false');
    }));
    list.append(button);
  }
  if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'library-empty'; empty.textContent = search ? '該当するメモがありません。' : 'メモを書くと、ここに保存されます。'; list.append(empty); }
}

el('library-toggle').addEventListener('click', () => {
  const library = el('library'); library.hidden = !library.hidden;
  el('library-toggle').setAttribute('aria-expanded', String(!library.hidden));
  if (!library.hidden) void saving.then(renderLibrary).catch(error => message(errorText(error), true));
});
el('search').addEventListener('input', filterLibrary);
el('follow').addEventListener('click', () => navigate(() => syncActive(true)));
refreshButton.addEventListener('click', () => {
  if (!note || currentTabId === undefined) return;
  message('');
  extraction = extract(currentTabId, note, ++generation);
});
el('help-toggle').addEventListener('click', () => { el('help').hidden = !el('help').hidden; el('help-toggle').setAttribute('aria-expanded', String(!el('help').hidden)); });

const dialog = el<HTMLDialogElement>('link-dialog');
const linkInput = el<HTMLInputElement>('link-input');
el('toolbar').addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); });
el('toolbar').addEventListener('click', event => {
  const command = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.command;
  if (!editor || saveFailed || transitioning) return;
  const chain = editor.chain().focus();
  switch (command) {
    case 'heading': chain.toggleHeading({ level: 2 }).run(); break;
    case 'bold': chain.toggleBold().run(); break;
    case 'italic': chain.toggleItalic().run(); break;
    case 'bulletList': chain.toggleBulletList().run(); break;
    case 'orderedList': chain.toggleOrderedList().run(); break;
    case 'blockquote': chain.toggleBlockquote().run(); break;
    case 'codeBlock': chain.toggleCodeBlock().run(); break;
    case 'undo': chain.undo().run(); break;
    case 'redo': chain.redo().run(); break;
    case 'image': imageInput.click(); break;
    case 'link': linkInput.value = editor.getAttributes('link').href || ''; el('link-error').textContent = ''; dialog.showModal(); linkInput.focus(); break;
  }
  updateToolbar(editor);
});
dialog.querySelector('form')!.addEventListener('submit', event => {
  const submitter = (event as SubmitEvent).submitter as HTMLButtonElement;
  if (submitter?.value !== 'apply') return;
  if (!/^https?:\/\//i.test(linkInput.value)) { event.preventDefault(); el('link-error').textContent = 'http:// または https:// のURLを入力してください。'; return; }
  const href = linkInput.value;
  if (editor?.state.selection.empty && !editor.isActive('link')) editor?.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
  else editor?.chain().focus().extendMarkRange('link').setLink({ href }).run();
});
el('link-remove').addEventListener('click', () => { editor?.chain().focus().extendMarkRange('link').unsetLink().run(); dialog.close(); });
imageInput.addEventListener('change', () => { addImages([...(imageInput.files ?? [])]); imageInput.value = ''; });

exportButton.addEventListener('click', async () => {
  if (!note || exporting) return;
  const target = note;
  exporting = true; controls(); exportButton.textContent = '画像とMarkdownをまとめています…';
  try {
    await images; await saving; await extraction;
    const snapshot = structuredClone(target);
    const archive = await createArchive(snapshot);
    await downloadBlob(new Blob([new Uint8Array(archive.bytes)], { type: 'application/zip' }), archive.filename);
    message(archive.warnings.length ? `ZIPの保存を開始しました。注意事項: ${archive.warnings.join(' / ')}` : 'ZIPの保存を開始しました。展開すると、記事・メモ・画像をまとめて使えます。');
  } catch (error) { message(`保存に失敗しました: ${errorText(error)}。${saveFailed ? '保存できていない編集内容を退避してください。' : 'メモはこのブラウザに保持されています。'}`, true); }
  finally { exporting = false; exportButton.textContent = '↓ 記事とメモを保存（ZIP）'; controls(); }
});

el('backup').addEventListener('click', async () => {
  try {
    await images; await saving;
    const notes = await listNotes();
    // Include the in-memory recovery copy if a disk write failed.
    if (saveFailed && note) { const index = notes.findIndex(item => item.key === note!.key); if (index < 0) notes.push(note); else notes[index] = note; }
    await downloadBlob(new Blob([backupJson(notes)], { type: 'application/json' }), `MarginClip-backup-${new Date().toISOString().slice(0, 10)}.json`);
    message(`${notes.length}件のメモのバックアップ保存を開始しました。`);
  } catch (error) { message(`バックアップに失敗しました: ${errorText(error)}`, true); }
});
el('restore').addEventListener('click', () => el<HTMLInputElement>('restore-file').click());
el('restore-file').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('restore-file');
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('バックアップは100MB以下にしてください。');
    const notes = parseBackup(await file.text());
    await saving;
    const count = await restoreNotes(notes);
    await renderLibrary();
    message(`${count}件を復元しました。既存のURLのメモは保持しました。保存済みメモ一覧から開けます。`);
  } catch (error) { message(`復元できませんでした: ${errorText(error)}`, true); }
});
el('recover').addEventListener('click', async () => {
  if (!note) return;
  try {
    await images; await saving;
    const snapshot = structuredClone(note);
    // Keep a separate URL key so recovery can be restored alongside the latest note.
    const recoveryUrl = new URL(snapshot.url);
    recoveryUrl.searchParams.set('marginclip-recovery', crypto.randomUUID());
    const copy = { ...snapshot, key: pageKey(recoveryUrl.href)!, url: recoveryUrl.href, title: `${snapshot.title}（退避）`, revision: 0, article: null };
    await downloadBlob(new Blob([backupJson([copy])], { type: 'application/json' }), 'MarginClip-recovery.json');
    let retained = false;
    try { await putNote(copy, 0); retained = true; } catch { /* The downloaded JSON remains available if local storage fails. */ }
    const latest = await getNote(snapshot.key);
    showNote(latest ?? newNote(snapshot.url, snapshot.title));
    message(`編集内容のJSON保存を開始し、最新版を開きました。${retained ? '退避メモは保存済みメモ一覧からも開けます。' : 'ローカルの退避には失敗しました。ダウンロードしたJSONを保管してください。'}`);
  } catch (error) { message(`退避できませんでした: ${errorText(error)}。このパネルを閉じずに本文をコピーしてください。`, true); }
});

async function initialize() {
  if (!globalThis.chrome?.tabs || !chrome.scripting) throw new Error('ビルドしたdistフォルダをChrome拡張として読み込んでください。');
  windowId = (await chrome.windows.getCurrent()).id!;
  chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) navigate(() => syncActive()); });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (following && (info.url || info.status === 'complete') && (tabId === currentTabId || info.url)) navigate(async () => {
      const previousKey = note?.key;
      await syncActive();
      if (info.status === 'complete' && note && note.key === previousKey && tabId === currentTabId && !note.article) extraction = extract(tabId, note, ++generation);
    });
  });
  await syncActive();
}
void initialize().catch(error => { message(errorText(error), true); el('page-title').textContent = 'MarginClipを開けませんでした'; });
