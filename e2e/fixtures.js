/*
 * e2e/fixtures.js — E2E 装置：网络替身（stubExternal）、播种（seed）、入口（test 扩展 / gotoAssets / visitAllTabs）。
 * 样式框架（Tailwind）默认真实加载：布局要按用户看到的真身验，不能用空壳替身自欺。
 * 汇率、图表库、日期库、字体仍用替身：它们要么是动态数据、要么是 canvas 像素、要么体积大且与本次断言无关。
 */
const { test: base, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const LS_KEY = 'wealth-manager-data';
const INDEX_URL = 'index.html';

// Tailwind 用 CDN 的**同一份构建**，只在第一次拉取，之后缓存在 e2e/.cache。
// 为什么不每次直连：303 条用例并行时 CDN 会限流/超时，页面悄悄少一套工具类，
// 断言就变成看运气。缓存的是真身，不是 window.tailwind = {} 的空壳。
let tailwindSource;
async function getTailwindSource() {
  if (tailwindSource) return tailwindSource;
  const file = path.join(__dirname, '.cache', 'tailwind-cdn.js');
  try {
    tailwindSource = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const res = await fetch('https://cdn.tailwindcss.com');
    if (!res.ok) throw new Error(`拉取 Tailwind CDN 失败：${res.status}（首次运行需要联网）`);
    tailwindSource = await res.text();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, tailwindSource);
  }
  return tailwindSource;
}

const EMPTY_STATE = {
  categories: [],
  assets: [],
  snapshots: [],
  expenseCategories: [],
  expenses: [],
  rates: { CNY: 1, HKD: 0.92, USD: 7.24, fetchedAt: null },
  expenseExpectation: 0,
  netWorthTarget: 0,
  incomeSafetyFactor: 100,
  runwayTags: [], runwayExpectation: 0,
  // 提醒默认关：跟真实日期走的话，每个月末那几天整套用例会集体被弹窗拦住
  snapshotReminder: { window: 'off', days: 5 },
  snapshotReminderLastPrompted: null,
  backup: { autoFreq: 'off', lastBackup: null, lastAutoDownload: null },
  // 既有断言写的都是中文文案；默认英文与切换由 i18n.spec.js 自己验
  lang: 'zh',
};

const sampleState = () => ({
  ...EMPTY_STATE,
  categories: [
    { id: 'currency', name: '货币类型', builtin: true, tags: ['CNY', 'HKD', 'USD'] },
    { id: 'cat-type', name: '资产类型', builtin: false, tags: ['活期现金', '权益基金'] },
    { id: 'cat-risk', name: '风险等级', builtin: false, tags: ['低风险', '高风险'] },
  ],
  assets: [
    { id: 'a-cash', name: '招商银行活期', amount: 50000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': '活期现金', 'cat-risk': '低风险' }, expectedRateMin: 0.25, expectedRateMax: 0.35, cashRatio: 100 },
    { id: 'a-fund', name: '沪深300指数', amount: 80000, currency: 'CNY', tags: { currency: 'CNY', 'cat-type': '权益基金', 'cat-risk': '高风险' }, expectedRateMin: 5, expectedRateMax: 8, cashRatio: 20 },
    { id: 'a-hk', name: '汇丰香港储蓄', amount: 50000, currency: 'HKD', tags: { currency: 'HKD', 'cat-type': '活期现金', 'cat-risk': '低风险' }, expectedRateMin: 0.1, expectedRateMax: 0.2, cashRatio: 100 },
  ],
  expenseCategories: [
    { id: 'ec-pay', name: '支付方式', builtin: false, tags: ['微信', '支付宝'] },
    { id: 'ec-type', name: '消费类型', builtin: false, tags: ['餐饮', '住房'] },
  ],
  expenses: [
    { id: 'e-1', date: '2026-01-05', amount: 88.5, note: '午餐', tags: { 'ec-pay': '微信', 'ec-type': '餐饮' } },
    { id: 'e-2', date: '2026-01-20', amount: 3200, note: '房租', tags: { 'ec-pay': '支付宝', 'ec-type': '住房' } },
    { id: 'e-3', date: '2026-02-03', amount: 42, note: '咖啡', tags: { 'ec-pay': '微信', 'ec-type': '餐饮' } },
  ],
  expenseExpectation: 5000,
});

/**
 * 给「与断言无关的外部服务」装替身。必须在首次 goto 之前调用。
 * Tailwind **不在这里拦**：它由页面真实加载，E2E 才会按真身排版（页头塌成两行
 * 就是空壳替身漏掉的）。这里只替汇率、图表库、日期库与字体。
 *
 * @param {object} [rates] 覆盖汇率 { hkd, usd }（默认 0.92 / 7.24）
 */
async function stubExternal(page, rates) {
  const r = { hkd: 0.92, usd: 7.24, ...(rates || {}) };

  await page.route('**/currency-api@latest/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ date: '2026-01-01', cny: { hkd: r.hkd, usd: r.usd } }),
    })
  );

  // ECharts 替身：真实库是 canvas 渲染 + 异步布局，E2E 里断言像素既慢又脆。
  // 这里记录 init/setOption/on/resize/dispose 的调用，够断言「图表已初始化/已重绘/点击已接线」。
  // 替身也**建模尺寸**（图 = 容器的 clientWidth/clientHeight，隐藏容器是 0），因为「尺寸是不是还等于
  // 容器」只能从这里读；真库在隐藏容器上 resize 会把尺寸压成一个最小值（实测 100px 宽）而不是 0，
  // 但两者的症状同一条：尺寸 ≠ 容器，且 setOption 修不回来。
  await page.route('**/echarts*.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `
        window.__echartsCalls = { init: [], setOption: [], clear: [], on: [], dispatch: [], resize: 0, dispose: 0, instances: {} };
        function FakeChart(dom) {
          this._dom = dom;
          this._w = dom ? dom.clientWidth : 0;
          this._h = dom ? dom.clientHeight : 0;
          this._handlers = {};
          window.__echartsCalls.init.push(dom && dom.id);
          if (dom && dom.id) window.__echartsCalls.instances[dom.id] = this;
        }
        FakeChart.prototype.setOption = function (opt, notMerge) {
          window.__echartsCalls.setOption.push({ id: this._dom && this._dom.id, notMerge: !!notMerge, seriesCount: (opt && opt.series || []).length });
          // 记录动画参数：图表动画是不是「进了节奏系统」只能从这里看。
          // 替身不建 canvas、也不跑动画，但它能证明页面**送了**什么给库——
          // 这正是这条契约要验的（真库的默认值是 1000ms/cubicInOut，页面不传就等于沿用它）。
          window.__echartsCalls.lastAnimation = {
            animation: opt && opt.animation,
            animationDuration: opt && opt.animationDuration,
            animationEasing: opt && opt.animationEasing,
          };
          // 记录旭日图实际喂进去的数据节点名（顶层）。这是「图本身下没下钻」唯一可观察的证据：
          // 下钻 = 只喂选中那一个分类，返回 = 又喂回全量。不记录就只能验清单、验不到图。
          const series = (opt && opt.series) || [];
          series.forEach(function (s) {
            if (s && s.type === 'sunburst') {
              window.__echartsCalls.sunburstData = (s.data || []).map(function (n) { return n && n.name; });
            }
          });
        };
        FakeChart.prototype.on = function (evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); window.__echartsCalls.on.push({ id: this._dom && this._dom.id, evt: evt }); };
        FakeChart.prototype.off = function () {};
        FakeChart.prototype.getDom = function () { return this._dom; };
        FakeChart.prototype.getWidth = function () { return this._w || 0; };
        FakeChart.prototype.getHeight = function () { return this._h || 0; };
        FakeChart.prototype.resize = function () {
          this._w = this._dom ? this._dom.clientWidth : 0;
          this._h = this._dom ? this._dom.clientHeight : 0;
          window.__echartsCalls.resize++;
        };
        FakeChart.prototype.clear = function () { window.__echartsCalls.clear.push(this._dom && this._dom.id); };
        FakeChart.prototype.dispose = function () { window.__echartsCalls.dispose++; };
        FakeChart.prototype.getOption = function () { return {}; };
        FakeChart.prototype.dispatchAction = function (a) {
          // 记录 + 触发 click 监听：前者供「高亮/下钻联动」类断言，后者保留原有下钻用法
          window.__echartsCalls.dispatch.push({ id: this._dom && this._dom.id, action: a });
          (this._handlers.click || []).forEach(function (fn) { fn(a); });
        };
        window.echarts = {
          init: function (dom) { return new FakeChart(dom); },
          getInstanceByDom: function () { return null; },
          registerTheme: function () {},
        };
      `,
    })
  );

  // Tailwind：CDN 同一份构建，本地缓存后喂给页面（真身排版，不受 CDN 限流影响）
  await page.route('**/cdn.tailwindcss.com**', async (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: await getTailwindSource() })
  );
  await page.route('**/flatpickr**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* flatpickr stub */' })
  );

  await page.route('**/fonts.googleapis.cn/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/fonts.gstatic.cn/**', (route) => route.abort());
}

/**
 * 播种 localStorage。**只在第一次导航时生效**（once 标记）。
 *
 * 为什么必须加 once：addInitScript 在**每次**导航（含 reload）都会重跑。若不加标记，
 * reload 会把存档重置回种子值 —— 于是「刷新后数据不变」这类持久化用例永远绿：
 * 它验证的是种子又被写了一遍，而不是应用的存档/读档。这个假通过很难被发现，
 * 因为用例名和断言看起来都对。
 *
 * @param {object|null} state 存档内容；null 表示完全无存档（真正的全新用户，界面落到默认英文）
 */
async function seed(page, state) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (sessionStorage.getItem('__e2e_seeded__')) return;
        sessionStorage.setItem('__e2e_seeded__', '1');
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) {
      }
    },
    [LS_KEY, state === null ? null : JSON.stringify(state)]
  );
}

/**
 * 展开消费明细（消费页的表格默认收起，收起时行高与列宽都是 0）：
 * 需要点行内按钮、或量列宽的用例先调它，否则会遇到「元素在但不可点」。
 */
async function openExpenseTable(page) {
  const bar = page.locator('#expense-table-toggle');
  if ((await bar.getAttribute('aria-expanded')) === 'true') return;
  await bar.click();
  await expect(bar).toHaveAttribute('aria-expanded', 'true');
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const d = document.getElementById('masthead-date');
    return !!d && d.textContent && d.textContent.trim() !== '—';
  });
}

/**
 * 读应用内存里的 state（而非 localStorage 原文）。
 * 迁移用例必须读它：migrateState() 只修内存态，加载路径不会回写 localStorage，
 * 读原文拿到的是迁移前的脏数据（见「旧版 expectedRate 迁移」用例）。
 */
const readAppState = (page) => page.evaluate(() => state);

const test = base.extend({
  blankPage: async ({ page }, use) => {
    await disableMotion(page);
    await stubExternal(page);
    await seed(page, { lang: 'zh' });
    await page.goto(INDEX_URL);
    await waitReady(page);
    await use(page);
  },

  appPage: async ({ page }, use) => {
    await disableMotion(page);
    await stubExternal(page);
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
    await use(page);
  },
});

async function disableMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function gotoAssets(page, tab) {
  // 幂等：已在资产模式就别再走一次门（门上本来就有「已在里面就失效」这道闸）
  if (!(await page.locator('#tabs-assets').isVisible())) {
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#asset-gate-modal')).toBeVisible();
    const phrase = await page.locator('#asset-gate-phrase').textContent();
    await page.locator('#asset-gate-input').fill(String(phrase).trim());
    await page.locator('#asset-gate-ok').click();
    await expect(page.locator('#tabs-assets')).toBeVisible();
  }
  if (tab) await page.locator(`#tabs-assets .tab-btn[data-tab="${tab}"]`).click();
}

/**
 * 走遍所有可见视图，让「懒渲染」的内容都进 DOM。
 * 主题色一致性必须覆盖全部 Tab：分类管理/图表/历史/收益/趋势里的 pill、徽章、
 * 空态只在各自 Tab 首次进入时才渲染（switchTab 里的 setTimeout 重绘）。
 *
 * 禁止 sleep 等待：switchTab 的 display 翻转是同步的，用面板可见断言即可到位；
 * 固定等待会让每个主题用例凭空多吃 2s——Theme spec 是全套最慢的，这里是主战场。
 */
async function visitAllTabs(page) {
  // 一次往返完成「点这枚 Tab + 断言它的面板翻上来」：面板翻转是同步的（见 switchTab），
  // 所以判断可以在同一个 evaluate 里做完。为什么不用 locator.click()：那要走一遍
  // actionability（可见/稳定/可接收事件）+ 一次 expect 轮询，实测每枚 Tab 约 53ms，
  // 九枚加上模式切换近 1s——而巡检要的只是「内容都渲染进 DOM」，真实点击路径由
  // app.spec.js 的导航用例覆盖（那里点的是用户真的会点的东西）。
  const showPanel = async (bar, tab) => {
    const shown = await page.evaluate(
      ([b, t]) => {
        const btn = document.querySelector(`${b} .tab-btn[data-tab="${t}"]`);
        if (!btn) return 'missing';
        btn.click();
        const panel = document.getElementById('tab-' + t);
        return panel && panel.style.display !== 'none' ? 'ok' : 'hidden';
      },
      [bar, tab]
    );
    expect(shown, `${bar} → ${tab} 的面板没翻上来`).toBe('ok');
  };
  await gotoAssets(page);
  for (const t of ['assets', 'categories', 'chart', 'history', 'income']) await showPanel('#tabs-assets', t);
  await page.locator('#mode-expenses').click();
  for (const t of ['expenses', 'expense-categories', 'expense-chart', 'expense-trend']) await showPanel('#tabs-expenses', t);
  await showPanel('#tabs-expenses', 'expenses');
  await page.locator('#tab-expenses button:has-text("记录消费")').click();
  await expect(page.locator('#expense-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#expense-modal')).toBeHidden();
  // 换算器挂在页头（不进资产侧）：列表与编辑两屏都进主题巡检
  await page.evaluate(() => { openYieldModal(); });
  await expect(page.locator('#yield-modal')).toBeVisible();
  await page.evaluate(() => yieldNewItem());
  await expect(page.locator('#yield-name')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#yield-modal')).toBeHidden();
  // 便条是 2.5s 自动退场的瞬时元素：能否被扫到取决于时机（不确定性 = 假阴/假阳）。
  // 扫描前主动触发三种语义色，把「碰巧在」变成「一定在」，顺带把便条配色纳入巡检。
  // 注意先清空：页面启动时必弹一条汇率便条（fetchRates 无条件触发），不清掉的话
  // toHaveCount(3) 会数到 4 —— 去 sleep 提速后 visitAllTabs < 2.8s，汇率便条还没退场。
  await page.evaluate(() => {
    document.getElementById('toast-area').innerHTML = '';
    toast('主题巡检·成功', 'success');
    toast('主题巡检·错误', 'error');
    toast('主题巡检·信息', 'info');
  });
  await expect(page.locator('#toast-area .toast')).toHaveCount(3);
}

async function collectOffThemeColors(page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    // 用浏览器自己把 hex/hsl/rgba 归一成 rgb()/rgba()，避免手写转换与计算值对不上
    const canon = (v) => {
      probe.style.color = '';
      probe.style.color = v;
      return probe.style.color ? getComputedStyle(probe).color : null;
    };

    const allowed = new Set();
    const cs = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.classList.contains('dark');
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // 跨域样式表读不到
      for (const r of rules) {
        if (!r.selectorText) continue;
        const sel = r.selectorText.trim();
        if (!/^:root(\.dark)?$/.test(sel)) continue;
        if (sel.includes('dark') !== isDark) continue; // 只取当前模式那一套
        for (const p of r.style) {
          if (!p.startsWith('--')) continue;
          const c = canon(cs.getPropertyValue(p).trim());
          if (c) allowed.add(c);
        }
      }
    }
    const addPill = (fn, cats) => cats.forEach((cat) => {
      (cat.tags || []).forEach((tag) => {
        const p = fn(cat.id, tag);
        [p.bg, p.fg, p.border].forEach((x) => { const c = canon(x); if (c) allowed.add(c); });
      });
    });
    addPill(catColor, state.categories);
    addPill(expenseCatColor, state.expenseCategories);
    color.CATEGORY_PALETTE.forEach((p) => {
      const c = canon(p.base); if (c) allowed.add(c);
      const l = canon(p.label); if (l) allowed.add(l); // 内环字色也是主题色板的一部分
      p.shades.forEach((s) => { const cc = canon(s); if (cc) allowed.add(cc); });
    });

    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      const st = getComputedStyle(el);
      // SVG 不画 CSS 边框；Tailwind preflight 默认的 border-color 会挂在 symbol/use 上，
      // 那是框架缺省值，不是页面用色。只查 SVG 的 color（fill/currentColor 用它）。
      const svg = el instanceof SVGElement;
      const props = svg
        ? ['color']
        : ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'borderRightColor', 'borderBottomColor'];
      const borderWidth = { borderTopColor: 'borderTopWidth', borderLeftColor: 'borderLeftWidth', borderRightColor: 'borderRightWidth', borderBottomColor: 'borderBottomWidth' };
      props
        .forEach((prop) => {
          // 没有描边就不算页面用色：Tailwind preflight 会给所有元素一个默认 border-color
          // (#e5e7eb)，但 border-width 是 0 时它根本没画出来。
          if (borderWidth[prop] && parseFloat(st[borderWidth[prop]]) === 0) return;
          const v = st[prop];
          if (!v || /^rgba\(0, 0, 0, 0\)$/.test(v)) return; // 透明 = 未设色
          if (allowed.has(v)) return;
          offenders.push({
            color: v, prop,
            where: el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          });
        });
    });
    probe.remove();
    return { allowedN: allowed.size, offenders };
  });
}

/**
 * 图表尺寸：读「容器尺寸」与「图自己的尺寸」。
 * --------------------------------------------------------------------------
 * ECharts 替身按容器尺寸建模（见 stubExternal），故两边的比较能在无头里做。
 * 不变量只有一条：**图可见时，它的尺寸必须等于容器的尺寸**——
 * 历史上它被破坏过两次（只在 window resize 时统一 resize、以及隐藏时 resize 会把图压小
 * 且 setOption 修不回来），故 chart-resize.spec.js 用它。
 */
const chartSize = (page, id) =>
  page.evaluate((domId) => {
    const el = document.getElementById(domId);
    const calls = window.__echartsCalls;
    const inst = calls && calls.instances ? calls.instances[domId] : null;
    return { container: [el.clientWidth, el.clientHeight], chart: inst ? [inst.getWidth(), inst.getHeight()] : null };
  }, id);

const waitChart = (page, id) =>
  expect.poll(() => chartSize(page, id).then((s) => !!s.chart), { message: `${id} 应已初始化` }).toBe(true);

const expectChartFit = (page, id, label) =>
  expect
    .poll(
      async () => {
        const s = await chartSize(page, id);
        if (!s.chart) return '图还没初始化';
        if (!s.container[0]) return '容器不可见';
        return s.chart[0] === s.container[0] && s.chart[1] === s.container[1]
          ? 'ok'
          : `图 ${JSON.stringify(s.chart)} ≠ 容器 ${JSON.stringify(s.container)}`;
      },
      { message: `${label}：${id} 的尺寸必须等于容器` }
    )
    .toBe('ok');

/**
 * 浏览器 UA 默认色：元素压根没设样式时浏览器给的兜底值。
 * 它们是「漏设样式」的症状，不是写死色值；由 KNOWN_HARDCODED 之外单独判定，
 * 避免把浏览器行为当成应用的主题违规。
 */
const UA_DEFAULT_COLORS = new Set([
  'rgb(0, 0, 0)',        // 默认 border-color / color
  'rgb(240, 240, 240)',  // <button> 默认背景
  'rgb(128, 128, 128)',  // <hr> 默认色
  'rgb(255, 255, 255)',
]);

/**
 * 取**渲染后的真实像素**（不是计算样式）。
 * --------------------------------------------------------------------------
 * 为什么需要它：材质这类改动的验收标准就是「看着对不对」，而「class 写对了但被覆盖 /
 * 被后来的一层盖住」在计算样式里看不出来（那正是 consistency.spec.js 存在的理由）。
 * 截图交给**浏览器自己的解码器**（Image + canvas），免得手写 PNG 解码器；
 * 传入与读回的都是 CSS 像素（截图是设备像素，故内部按 devicePixelRatio 换算）。
 * 坐标以视口为参照（getBoundingClientRect 即视口坐标），调用方不要中途滚动页面。
 */
async function samplePixels(page, points) {
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ([b64, pts, scale]) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('截图解码失败'));
        i.src = 'data:image/png;base64,' + b64;
      });
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return pts.map(([x, y]) => {
        const d = ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] };
      });
    },
    [png, points, dpr]
  );
}

/** 相对亮度：与 AA 巡检同一套公式（那份在浏览器里内联，无法直接引用）——
 *  两处口径必须一致，否则「更亮/更暗」的判据会与可读性巡检对不上 */
const pixelLum = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

module.exports = {
  test, expect, stubExternal, seed, waitReady, disableMotion, readAppState,
  visitAllTabs, gotoAssets, collectOffThemeColors, UA_DEFAULT_COLORS,
  sampleState, EMPTY_STATE, LS_KEY, INDEX_URL,
  samplePixels, pixelLum, chartSize, waitChart, expectChartFit, openExpenseTable,
};
