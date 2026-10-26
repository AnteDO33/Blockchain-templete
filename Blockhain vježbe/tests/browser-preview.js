// QA-only server. The production server never exposes this simulated provider.
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/wallet.js', ['wallet.js', 'text/javascript']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/mock-provider.js', ['tests/mock-provider.js', 'text/javascript']],
]);
http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      const html = await readFile(new URL('index.html', root), 'utf8');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html.replace('<script src="/app.js"', '<script src="/mock-provider.js" type="module"></script><script src="/app.js"'));
      return;
    }
    const route = routes.get(pathname);
    if (!route) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8` });
    response.end(await readFile(new URL(route[0], root)));
  } catch { response.writeHead(500).end(); }
}).listen(5174, '127.0.0.1', () => console.log('QA only (simulated wallet): http://localhost:5174'));
