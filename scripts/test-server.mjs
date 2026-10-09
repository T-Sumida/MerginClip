import { createServer } from 'node:http';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
createServer((request, response) => {
  if (request.url === '/image.png') { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(pixel); return; }
  if (request.url === '/blocked.png') { response.writeHead(403); response.end('forbidden'); return; }
  const name = request.url?.startsWith('/article-b') ? 'B' : 'A';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="ja"><head><title>読書の記事 ${name}</title><meta name="author" content="テスト著者"><meta property="article:published_time" content="2026-10-09"></head><body><nav>サイトのメニュー</nav><article><h1>読書の記事 ${name}</h1><p>${'ページを読みながら思考を書き留めることで、記事の理解が深まります。'.repeat(40)}</p><h2>大切なポイント</h2><p>これは <strong>本文</strong> です。<a href="/reference">参考資料</a>もご覧ください。</p><img src="/image.png" alt="記事の図"><p>${'この続きには読書メモの使い方を書いています。'.repeat(20)}</p></article><footer>ページのフッター</footer></body></html>`);
}).listen(4178, '127.0.0.1', () => console.log('MarginClip test fixture: http://127.0.0.1:4178'));
