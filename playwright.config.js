const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js', // e2e/ 只放 spec：*.test.js 是 node --test 的命名
  // 用例互不依赖（各自播种 + 新页面）：按文件串行时最慢的 spec 就是整轮的墙钟下限
  fullyParallel: true,
  workers: process.env.CI ? 4 : 6,
  retries: 0, // 契约已由单测钉死，失败就是失败
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  timeout: 30 * 1000,
  expect: { timeout: 7000 },
  outputDir: './e2e-results',
  use: {
    // 不用 file://：localStorage 在 file origin 下不可靠
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: process.env.CI ? 'retain-on-failure' : 'off', // 本地录 trace 会让整轮慢三成
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${JSON.stringify(require('path').join(__dirname, 'e2e', 'server.js'))} ${PORT}`,
    // 健康检查要验明正身：reuseExistingServer 只看端口，被别的服务占用时会静默连错
    url: `http://127.0.0.1:${PORT}/__e2e_health__`,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
