/*
 * e2e/server.js — E2E 用的零依赖静态服务器
 * --------------------------------------------------------------------------
 * 为什么不用 file:// 直接打开：
 *   - localStorage 在 file:// 下的行为各浏览器不一致（Chrome 下 origin 为 "null"，
 *     存档不可靠），而本应用的核心就是 localStorage 持久化；
 *   - 汇率 fetch 的跨域限制在 file:// 下也不同，route stub 的语义会漂。
 * 起一个只服务本目录的 http 服务，行为与「部署到静态托管」一致，也便于 route 拦截。
 *
 * 只被 playwright.config.js 的 webServer 调用；不参与 `node --test`。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    // decodeURIComponent 对畸形转义（'/x%zz'、单独的 '%'）会抛 URIError。
    // 它必须在 try 里：抛出后不走 res，进程会因未捕获异常退出（server 是单实例），
    // 后续所有请求 ECONNREFUSED —— 表现为「一批用例莫名全挂」而非一个清晰的失败。
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad Request');
    return;
  }
  // 健康检查探针：只有本服务器会返回它。Playwright 的 webServer.url 用它判断
  // 「服务已就绪且确实是我们的」，避免端口被别的服务占用时静默连错。
  if (urlPath === '/__e2e_health__') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok');
    return;
  }

  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(ROOT, rel);

  // 防目录穿越：解析后的真实路径必须仍在项目根目录内
  // 用 path.relative 判断，避免 C:\a\bc 被 C:\a\b 的前缀比较误判为合法
  const rel2 = path.relative(ROOT, filePath);
  if (rel2.startsWith('..') || path.isAbsolute(rel2)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // 测试要看到最新改动，禁掉一切缓存
      'Cache-Control': 'no-store',
    }).end(buf);
  });
});

const listener = server.listen(PORT, '127.0.0.1', () => {
  // 打印实际端口：传 0 时由 OS 分配，必须用 address().port 而非入参，
  // 否则调用方（含单测）拿不到真实端口
  const actual = listener.address().port;
  process.stdout.write(`e2e static server: http://127.0.0.1:${actual}/\n`);
});
