import { test, expect, chromium, type BrowserContext, type Page, type CDPSession } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

let context: BrowserContext;
let panel: Page;
let article: Page;
let extensionId: string;
const errors: string[] = [];
let commandId = 0;

function markdownFile(files: Record<string, Uint8Array>, kind: 'note' | 'article'): Uint8Array {
  const path = Object.keys(files).find(path => path.endsWith(`_${kind}.md`));
  expect(path).toMatch(/^\d{8}_\d{6}_.+_(note|article)\.md$/);
  return files[path!];
}

function nativeCommand(session: CDPSession, targetSession: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { session.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Native panel command timed out: ${method}`)); }, 10000);
    const listener = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== targetSession) return;
      const result = JSON.parse(event.message);
      if (result.id !== id) return;
      clearTimeout(timeout); session.off('Target.receivedMessageFromTarget', listener);
      result.error ? reject(new Error(result.error.message)) : resolve(result.result);
    };
    session.on('Target.receivedMessageFromTarget', listener);
    void session.send('Target.sendMessageToTarget', { sessionId: targetSession, message: JSON.stringify({ id, method, params }) }).catch(error => { clearTimeout(timeout); session.off('Target.receivedMessageFromTarget', listener); reject(error); });
  });
}

async function activate(page: Page) {
  await panel.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(tab => tab.url === url);
    if (!tab?.id) throw new Error(`Missing tab: ${url}`);
    await chrome.tabs.update(tab.id, { active: true });
  }, page.url());
}

async function pasteMarkdown(page: Page, text: string) {
  await page.locator('.tiptap').focus();
  await page.evaluate(value => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', value);
    document.querySelector('.tiptap')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
}

test.beforeAll(async () => {
  const extensionPath = resolve('dist');
  const chromePath = process.env.MARGINCLIP_CHROME_PATH || (process.platform === 'win32' ? [
    `${process.env.ProgramFiles}/Google/Chrome/Application/chrome.exe`,
    `${process.env['ProgramFiles(x86)']}/Google/Chrome/Application/chrome.exe`,
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  ].find(existsSync) : undefined);
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    executablePath: chromePath,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', ...(chromePath ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`])],
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  if (chromePath) {
    const session = await context.browser()!.newBrowserCDPSession();
    await session.send('Extensions.loadUnpacked', { path: extensionPath });
    await session.detach();
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  expect(await worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).toEqual({ openPanelOnActionClick: true });
  article = await context.newPage();
  await article.goto('http://127.0.0.1:4178/article-a');
  const browserSession = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const articleTarget = targetInfos.find(target => target.url === article.url())!;
  await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: articleTarget.targetId });
  // Chrome's native side panel is not exposed as a Playwright Page. Verify its
  // actual extension context, then run editor interactions in the same extension origin.
  await expect.poll(() => worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length)).toBe(1);
  const targets = (await browserSession.send('Target.getTargets')).targetInfos;
  const nativePanel = targets.find(target => target.type === 'page' && target.url === `chrome-extension://${extensionId}/sidepanel.html`)!;
  expect(nativePanel).toBeTruthy();
  const nativeSession = await browserSession.send('Target.attachToTarget', { targetId: nativePanel.targetId, flatten: false });
  await expect.poll(async () => (await nativeCommand(browserSession, nativeSession.sessionId, 'Runtime.evaluate', { expression: "document.getElementById('page-title')?.textContent", returnByValue: true })).result.value).toBe('読書の記事 A');
  await expect.poll(async () => (await nativeCommand(browserSession, nativeSession.sessionId, 'Runtime.evaluate', { expression: "document.getElementById('article-status')?.textContent", returnByValue: true })).result.value).toContain('記事取得済み');
  await browserSession.send('Target.detachFromTarget', { sessionId: nativeSession.sessionId });
  await browserSession.send('Target.closeTarget', { targetId: nativePanel.targetId });
  await browserSession.detach();
  panel = await context.newPage();
  panel.on('pageerror', error => errors.push(error.message));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await activate(article);
  expect(panel.url()).toBe(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.setViewportSize({ width: 390, height: 900 });
  await expect(panel.locator('#page-title')).toHaveText('読書の記事 A');
  await expect(panel.locator('#article-status')).toContainText('記事取得済み');
});

test.afterAll(async () => { await context?.close(); });
test.describe.configure({ mode: 'serial' });

test('renders Markdown, supports typed shortcuts and preserves image paste on reload', async () => {
  await pasteMarkdown(panel, '# 読書メモ\n\n**重要な発見**\n\n- あとで調べる\n\n> 記事からの引用\n\n```js\nconst note = true;\n```\n\n[参考](https://example.com)');
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
  await expect(panel.locator('.tiptap strong')).toHaveText('重要な発見');
  await expect(panel.locator('.tiptap blockquote')).toContainText('記事からの引用');
  await expect(panel.locator('.tiptap pre')).toContainText('const note = true;');
  await expect(panel.locator('#save-status')).toHaveText('✓ 保存済み');
  await panel.locator('.tiptap').press('Control+End');
  await panel.locator('.tiptap').press('Enter');
  await panel.locator('.tiptap').pressSequentially('## ');
  await panel.locator('.tiptap').pressSequentially('入力で見出し');
  await expect(panel.locator('.tiptap h2')).toHaveText('入力で見出し');
  await panel.evaluate(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), char => char.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], '貼り付け.png', { type: 'image/png' }));
    document.querySelector('.tiptap')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expect(panel.locator('.tiptap img')).toHaveCount(1);
  await expect(panel.locator('#save-status')).toHaveText('✓ 保存済み');
  await panel.reload();
  await activate(article);
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
  await expect(panel.locator('.tiptap img')).toHaveCount(1);
  await expect(panel.locator('.tiptap img')).toHaveJSProperty('naturalWidth', 1);
  await panel.screenshot({ path: 'test-results/panel-light.png', fullPage: true });
});

test('switches between pages, preserves hash identity, and isolates undo history', async () => {
  await article.goto('http://127.0.0.1:4178/article-b');
  await expect(panel.locator('#page-title')).toHaveText('読書の記事 B');
  await expect(panel.locator('.tiptap')).toHaveText('');
  await pasteMarkdown(panel, 'ページB専用のメモ');
  await expect(panel.locator('#save-status')).toHaveText('✓ 保存済み');
  await article.goto('http://127.0.0.1:4178/article-a#section');
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
  await expect(panel.locator('[data-command="undo"]')).toBeDisabled();
  await article.goto('http://127.0.0.1:4178/article-a?version=2');
  await expect(panel.locator('.tiptap')).toHaveText('');
  await article.goto('http://127.0.0.1:4178/article-a');
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
});

test('downloads an archive with article image URLs and local note images', async () => {
  const downloadPromise = panel.waitForEvent('download');
  await panel.locator('#export').click();
  const download = await downloadPromise;
  // Playwright redirects Downloads API files to UUID paths. Verify the actual ZIP payload.
  const path = await download.path();
  const archive = unzipSync(new Uint8Array(await readFile(path!)));
  expect(strFromU8(markdownFile(archive, 'article'))).toContain('author: "テスト著者"');
  expect(strFromU8(markdownFile(archive, 'article'))).toContain('published_at: "2026-10-09"');
  expect(strFromU8(markdownFile(archive, 'note'))).toContain('# 読書メモ');
  expect(strFromU8(markdownFile(archive, 'note'))).not.toContain('data:image');
  expect(strFromU8(markdownFile(archive, 'article'))).toContain('![記事の図](<http://127.0.0.1:4178/image.png>)');
  expect(strFromU8(markdownFile(archive, 'article'))).not.toContain('assets/');
  expect(Object.keys(archive).filter(path => path.startsWith('assets/'))).toHaveLength(1);
  expect(Object.keys(archive).sort()).toEqual(expect.arrayContaining([expect.stringMatching(/^\d{8}_\d{6}_読書の記事 A_article\.md$/), expect.stringMatching(/^\d{8}_\d{6}_読書の記事 A_note\.md$/), 'assets/image-001.png']));
  expect(Object.keys(archive)).toHaveLength(3);
});

test('opens saved notes without following navigation and supports backup and merge restore', async () => {
  await panel.locator('#library-toggle').click();
  await expect(panel.locator('#note-count')).toHaveText('2');
  await panel.locator('#search').fill('ページB専用');
  await panel.locator('.library-note').click();
  await expect(panel.locator('.tiptap')).toContainText('ページB専用のメモ');
  await expect(panel.locator('#page-mode')).toHaveText('SAVED NOTE');
  await article.goto('http://127.0.0.1:4178/article-a?another=1');
  await expect(panel.locator('.tiptap')).toContainText('ページB専用のメモ');
  await panel.locator('#follow').click();
  await expect(panel.locator('.tiptap')).toHaveText('');
  await article.goto('http://127.0.0.1:4178/article-a');
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
  await panel.locator('#library-toggle').click();
  const downloadPromise = panel.waitForEvent('download');
  await panel.locator('#backup').click();
  const backup = await downloadPromise;
  const path = await backup.path();
  const json = JSON.parse(await readFile(path!, 'utf8'));
  expect(json.notes).toHaveLength(2);
  await panel.locator('#restore-file').setInputFiles(path!);
  await expect(panel.locator('#message')).toContainText('0件を復元しました');
  const recovered = structuredClone(json.notes[0]);
  recovered.key = 'http://127.0.0.1:4178/restored';
  recovered.url = recovered.key;
  recovered.title = 'バックアップから復元したメモ';
  if (recovered.article) recovered.article.url = recovered.url;
  await panel.locator('#restore-file').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...json, notes: [recovered] })) });
  await expect(panel.locator('#message')).toContainText('1件を復元しました');
  await panel.locator('#search').fill('バックアップから復元');
  await expect(panel.locator('.library-note')).toHaveCount(1);
  await panel.locator('.library-note').click();
  await expect(panel.locator('#page-title')).toHaveText(recovered.title);
  await panel.locator('#follow').click();
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.screenshot({ path: 'test-results/panel-dark.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('handles restricted browser pages while retaining existing notes', async () => {
  await article.goto('chrome://settings');
  await expect(panel.locator('#page-title')).toHaveText('Webページを開いてください');
  await expect(panel.locator('#export')).toBeDisabled();
  await article.goto('http://127.0.0.1:4178/article-a');
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
});

test('tracks real tab activation and keeps the current window independent', async () => {
  const otherArticle = await context.newPage();
  await otherArticle.goto('http://127.0.0.1:4178/article-b');
  await activate(otherArticle);
  await expect(panel.locator('.tiptap')).toContainText('ページB専用のメモ');
  await activate(article);
  await expect(panel.locator('.tiptap h1')).toHaveText('読書メモ');
  await otherArticle.close();
});

test('prevents stale writes from another window and retains a recoverable copy', async () => {
  const secondPanelPromise = context.waitForEvent('page');
  const secondWindow = await panel.evaluate(url => chrome.windows.create({ url, type: 'normal' }), panel.url());
  expect(secondWindow?.id).toBeDefined();
  const secondWindowId = secondWindow!.id!;
  const secondPanel = await secondPanelPromise;
  await secondPanel.waitForLoadState();
  const secondArticlePromise = context.waitForEvent('page');
  await panel.evaluate(async windowId => chrome.tabs.create({ windowId, url: 'http://127.0.0.1:4178/article-a', active: true }), secondWindowId);
  const secondArticle = await secondArticlePromise;
  await secondArticle.waitForLoadState();
  await expect(secondPanel.locator('.tiptap h1')).toHaveText('読書メモ');
  await expect(panel.locator('#page-title')).toHaveText('読書の記事 A');
  await panel.locator('.tiptap').press('Control+End');
  await panel.locator('.tiptap').press('Enter');
  await pasteMarkdown(panel, '最初のウィンドウで更新');
  await expect(panel.locator('#save-status')).toHaveText('✓ 保存済み');
  await secondPanel.locator('.tiptap').press('Control+End');
  await pasteMarkdown(secondPanel, '競合したウィンドウの内容');
  await expect(secondPanel.locator('#save-status')).toHaveText('保存できません');
  await expect(secondPanel.locator('#conflict-actions')).toBeVisible();
  await expect(secondPanel.locator('.tiptap')).toHaveAttribute('contenteditable', 'false');
  const recoveryDownload = secondPanel.waitForEvent('download');
  await secondPanel.locator('#recover').click();
  const download = await recoveryDownload;
  const recovery = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(recovery.notes[0].markdown).toContain('競合したウィンドウの内容');
  expect(recovery.notes[0].url).toContain('marginclip-recovery=');
  await expect(secondPanel.locator('.tiptap')).toContainText('最初のウィンドウで更新');
  await expect(secondPanel.locator('.tiptap')).not.toContainText('競合したウィンドウの内容');
  await panel.reload();
  await activate(article);
  await expect(panel.locator('.tiptap')).toContainText('最初のウィンドウで更新');
  await panel.evaluate(id => chrome.windows.remove(id), secondWindowId);
  expect(errors).toEqual([]);
});

test('exports large image files under the real Manifest V3 content security policy', async () => {
  await article.goto('http://127.0.0.1:4178/article-a?large-image=1');
  await expect(panel.locator('.tiptap')).toHaveText('');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const largePng = Buffer.concat([png, Buffer.alloc(600000)]);
  await panel.locator('#image-file').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: largePng });
  await expect(panel.locator('.tiptap img')).toHaveCount(1);
  await expect(panel.locator('#save-status')).toHaveText('✓ 保存済み');
  const downloadPromise = panel.waitForEvent('download');
  await panel.locator('#export').click();
  const download = await downloadPromise;
  const archive = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  expect(archive['assets/image-001.png'].length).toBe(largePng.length);
  expect(strFromU8(markdownFile(archive, 'note'))).toContain('assets/image-001.png');
  expect(errors).toEqual([]);
});
