/*
 * e2e/server.test.js — 静态服务器的边界单测
 * --------------------------------------------------------------------------
 * server.js 是 E2E 的地基：它一崩，后面所有用例都会以 ECONNREFUSED 的形式成片挂掉，
 * 而真正的报错（未捕获异常）被埋在最前面，极难定位。所以它的边界要单独钉住：
 *   - 畸形 URL 不能杀死进程（会让整轮 E2E 以误导性的方式失败）
 *   - 目录穿越必须被拒（测试服务器也别开成任意文件读取）
 *
 * 跑在 node --test 下：用 http 起真实服务，不 mock。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'e2e', 'server.js');

/** 起一个临时服务，返回 { port, get(urlPath), close } */
async function startServer() {
  const child = spawn('node', [SERVER, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('服务器启动超时')), 5000);
    child.stdout.on('data', (d) => {
      // server.js 监听后会打印 e2e static server: http://127.0.0.1:PORT/
      const m = String(d).match(/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('服务器提前退出 code=' + code)); });
  });

  const get = (urlPath) =>
    new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }).on('error', (e) => resolve({ error: e.code }));
    });

  return {
    port,
    get,
    alive: () => child.exitCode === null,
    close: () => child.kill(),
  };
}

describe('E2E 静态服务器', () => {
  test('端口 0 时自动分配（避免固定端口与本地服务冲突）', async () => {
    const s = await startServer();
    assert.ok(s.port > 0, '应分配到实际端口');
    s.close();
  });

  test('畸形 URL 不杀死进程（后续请求仍可用）', async () => {
    const s = await startServer();
    // 单个 '%' 会让 decodeURIComponent 抛 URIError；未捕获会让进程退出
    const bad = await s.get('/%');
    assert.strictEqual(bad.status, 400, '畸形 URL 应返回 400 而不是崩掉');
    assert.ok(s.alive(), '服务器必须仍然存活');

    const ok = await s.get('/index.html');
    assert.strictEqual(ok.status, 200, '畸形请求之后正常请求仍要能用');
    s.close();
  });

  test('目录穿越被拒绝', async () => {
    const s = await startServer();
    for (const p of ['/../package.json', '/..%2f..%2fpackage.json', '/e2e/../../package.json']) {
      const r = await s.get(p);
      assert.ok(r.status === 403 || r.status === 404, `${p} 应被拒绝，实际 ${r.status}`);
    }
    s.close();
  });

  test('正常文件返回 200 且禁用缓存', async () => {
    const s = await startServer();
    const r = await s.get('/index.html');
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.strictEqual(r.headers['cache-control'], 'no-store', '必须禁缓存，否则测试读到旧文件');
    s.close();
  });

  test('不存在的文件返回 404 而非崩溃', async () => {
    const s = await startServer();
    const r = await s.get('/no-such-file.html');
    assert.strictEqual(r.status, 404);
    assert.ok(s.alive());
    s.close();
  });
});
