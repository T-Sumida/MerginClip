import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, readFile, readdir, copyFile } from 'node:fs/promises';
import { zlibSync } from 'fflate';

const project = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
if (project.version !== manifest.version) throw new Error('package.jsonとmanifest.jsonのversionを揃えてください。');

await viteBuild({ build: { outDir: 'dist', target: 'chrome116', rolldownOptions: { input: 'sidepanel.html', output: { codeSplitting: { groups: [{ name: 'editor', test: /node_modules\/@tiptap|node_modules\/prosemirror/ }] } } } } });
await esbuild({ entryPoints: ['src/background.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', target: 'chrome116', minify: true });
await esbuild({ entryPoints: ['src/extractor.ts'], outfile: 'dist/extractor.js', bundle: true, format: 'iife', globalName: 'MarginClipExtractor', target: 'chrome116', minify: true });

// Original code-generated PNG mark, no remote asset or runtime dependency.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([size, payload, crc]);
}
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const rows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const paper = px > .25 && px < .75 && py > .18 && py < .82;
    const line = paper && px > .36 && px < .66 && ((py > .34 && py < .39) || (py > .48 && py < .53) || (py > .62 && py < .67));
    const offset = y * (1 + size * 4) + 1 + x * 4;
    rows.set(line ? [57, 111, 89, 255] : paper ? [246, 245, 235, 255] : [57, 111, 89, 255], offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`dist/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', Buffer.from(zlibSync(rows))), chunk('IEND', Buffer.alloc(0))]));
}
console.log('Chromeに読み込める拡張を dist/ に生成しました。');

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['MarginClip — Third-party software notices\n\nThe following runtime packages are bundled in this extension.'];
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path || metadata.dev) continue;
  const pkg = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  const licenseFiles = (await readdir(path)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  notices.push(`\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || metadata.license || 'See package'}\n`);
  for (const license of licenseFiles) notices.push(await readFile(`${path}/${license}`, 'utf8'));
  if (!licenseFiles.length) notices.push(`Package: https://www.npmjs.com/package/${pkg.name}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
await copyFile('LICENSE', 'dist/LICENSE');
