/*
 * playwright.config.js — 端到端（E2E）测试配置
 * --------------------------------------------------------------------------
 * 单测（node --test）覆盖纯逻辑与 HTML 文本契约；这里补的是「真实浏览器里跑一遍」：
 * 首屏渲染、模式/Tab 切换、增删改、筛选、图表初始化、弹窗、暗色切换、持久化。
 *
 * 两条硬约束（E2E 的定位所决定）：
 *   1. 不访问外网。CDN（tailwind / echarts / flatpickr / 字体 / 汇率）与 localStorage
 *      数据在测试里全部 stub，测试只验证应用自身行为，不受 CDN 可用性影响。
 *      详见 e2e/fixtures.js 的注释。
 *   2. 只测本项目自己的页面。绝不把真实站点写进测试。
 */
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);

module.exports = defineConfig({
  // e2e/ 目录与单测的 test/ 分开：这里只拾取 *.spec.js，
  // e2e/ 下不放 *.test.js（那是 node --test 的命名约定，见 test/e2e-server.test.js）
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  // workers=2 为实测拐点：1→2 约快 40%，2→4 不再下降（主题巡检用例本身是串行长尾）。
  // 本地与 CI（ubuntu-latest 4 核）都安全：每个 worker 是独立浏览器进程，约 300MB。
  // 串行跑完约 31s，并行约 20s；失败排查时可用 --workers=1 复现。
  fullyParallel: false,
  workers: 2,
  // 单测已经把契约钉死，E2E 只在 CI 上跑，失败即失败，不做重试掩盖
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  timeout: 30 * 1000,
  expect: { timeout: 7000 },
  outputDir: './e2e-results',
  use: {
    // 相对路径（page.goto('index.html')）会拼在 baseURL 上，即本服务器的 http 地址；
    // 不用 file://：localStorage 在 file origin 下不可靠，且 route 拦截语义会漂（见 e2e/server.js 头注）
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 用 Node 起一个零依赖静态服务器；不用 `npx serve` 之类，避免再拉一个包
    command: `node ${JSON.stringify(require('path').join(__dirname, 'e2e', 'server.js'))} ${PORT}`,
    // 健康检查指向一个只有本项目服务器才会提供的内容，而不是任意 200 页面：
    // reuseExistingServer 只看端口是否响应，若 4173 被别的服务占用（本地常见），
    // 会静默把测试连到那个服务上，症状是一堆难以理解的失败。
    url: `http://127.0.0.1:${PORT}/__e2e_health__`,
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
