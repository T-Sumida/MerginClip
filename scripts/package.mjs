import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const files = {};
const project = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (project.version !== manifest.version) throw new Error('package.jsonとビルド済みmanifest.jsonのversionが一致しません。再ビルドしてください。');
const version = manifest.version;
if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error('配布バージョンが不正です。');
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files[`MarginClip/${relative('dist', path).replaceAll('\\', '/')}`] = new Uint8Array(await readFile(path));
  }
}
await collect('dist');
files['インストール方法.txt'] = strToU8(`MarginClip ${version}\n\n1. ZIP全体を展開します。\n2. Google Chromeで chrome://extensions を開きます。\n3. 右上の「デベロッパーモード」をONにします。\n4. 「パッケージ化されていない拡張機能を読み込む」で、manifest.jsonが入ったMarginClipフォルダを選びます。\n5. 拡張機能一覧からMarginClipをピン留めし、Webページ上でアイコンをクリックします。\n\nChrome ${manifest.minimum_chrome_version}以降に対応。フォルダは削除・移動せず保持してください。メモはこのChromeプロファイル内に保存されます。削除や再インストールの前に全メモをバックアップしてください。\n\n詳細はdocs/installation.md、使い方はdocs/user-guide.md、権限と通信はdocs/privacy.mdを参照してください。MITライセンスと依存ライブラリのライセンスはMarginClipフォルダにあります。\n`);
const guides = ['installation.md', 'user-guide.md', 'privacy.md'];
for (const guide of guides) {
  const content = await readFile(`docs/${guide}`, 'utf8');
  // Keep bundled guide links local; link other project documents to the release tag.
  const distributed = content.replace(/\]\(([^\s)]+)\)/g, (match, target) => {
    if (/^(?:[a-z][\w+.-]*:|#)/i.test(target)) return match;
    const [path] = target.split('#');
    if (guides.includes(path)) return match;
    const repositoryPath = posix.normalize(posix.join('docs', target));
    return `](https://github.com/T-Sumida/MerginClip/blob/v${version}/${repositoryPath})`;
  });
  files[`docs/${guide}`] = strToU8(distributed);
}
await mkdir('release', { recursive: true });
const output = `release/MarginClip-${version}.zip`;
await writeFile(output, zipSync(files, { level: 6 }));
console.log(`${output} を生成しました。`);
