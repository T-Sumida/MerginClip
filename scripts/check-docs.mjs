import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';

const root = resolve('.');
const ignored = new Set(['.git', 'node_modules', 'dist', 'release', 'test-results', 'playwright-report', '.test-profiles']);
const documents = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !ignored.has(entry.name)) await collect(path);
    else if (entry.isFile() && entry.name.endsWith('.md')) documents.push(path);
  }
}
await collect(root);
const failures = [];
function withoutCodeSpans(content) {
  const delimiters = Array.from(content.matchAll(/`+/g));
  let result = '', cursor = 0;
  for (let i = 0; i < delimiters.length; i++) {
    const opening = delimiters[i];
    const closingIndex = delimiters.findIndex((candidate, index) => index > i && candidate[0].length === opening[0].length);
    if (closingIndex < 0) continue;
    result += content.slice(cursor, opening.index) + ' ';
    const closing = delimiters[closingIndex];
    cursor = closing.index + closing[0].length;
    i = closingIndex;
  }
  return result + content.slice(cursor);
}
for (const document of documents) {
  const content = withoutCodeSpans((await readFile(document, 'utf8'))
    .replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gm, ''));
  const destinations = [
    ...Array.from(content.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g), match => match[1] || match[2]),
    ...Array.from(content.matchAll(/\b(?:src|href)="([^"]+)"/g), match => match[1]),
  ];
  for (const destination of destinations) {
    if (/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(destination)) continue;
    const path = decodeURIComponent(destination.split(/[?#]/)[0]);
    if (!path) continue;
    const target = resolve(dirname(document), path);
    const local = relative(root, target);
    const inside = local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
    const exists = inside && await stat(target).then(value => value.isFile()).catch(() => false);
    if (!exists) failures.push(`${relative(root, document)}: ${destination}`);
  }
}
if (failures.length) {
  console.error(`ドキュメントの参照先が見つかりません:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else console.log(`${documents.length}件のMarkdownドキュメントのファイル参照を確認しました。`);
