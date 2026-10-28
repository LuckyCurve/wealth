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
  // 用例之间互不依赖（每条用例自带「播种存档 + 新页面」），所以按**用例**并行：
  // 按文件串行时最大的那个 spec 会独占一个 worker，成为整轮的墙钟下限。
  // 拐点在 6~8 之间，再往上不再变快——单条用例争抢 CPU 时自己会膨胀。
  // 耗时数字不写在这里（会烂一次，见 LESSONS「文档别缓存可变数字」）：要复现就
  //   npx playwright test --workers=1   # 排查
  //   PLAYWRIGHT_JSON_OUTPUT_NAME=e2e-results/pw.json npx playwright test --reporter=json
  // 然后按 duration 排序（定位慢用例的唯一可靠方式）。
  // CI（ubuntu-latest 4 核）给 4。
  fullyParallel: true,
  workers: process.env.CI ? 4 : 6,
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
    // trace 默认只在 CI 上录：本地录它会让整轮慢三成左右，而本地失败时截图 + 断言信息
    // 通常已够——需要 DOM 快照就单跑那个 spec：
    //   npx playwright test e2e/app.spec.js -g '用例名' --trace retain-on-failure
    trace: process.env.CI ? 'retain-on-failure' : 'off',
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
