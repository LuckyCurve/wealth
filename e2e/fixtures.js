/*
 * e2e/fixtures.js — E2E 的公共装置（test 扩展 + 网络 stub + 数据播种）
 * --------------------------------------------------------------------------
 * 三件事，都是为了「测试只验证应用自身行为」：
 *
 * 1. stubCdn(page) —— 拦掉所有外部请求。
 *    页面依赖 5 个 CDN：tailwind、echarts、flatpickr(css+js+l10n)、Google 字体、汇率 API。
 *    真实网络下任何一个抖动都会让 E2E 变红，而我们要测的不是 CDN。这里给出最小可用替身：
 *      - 汇率 API 返回固定的 { cny: { hkd, usd } }（1 CNY = X 外币），页面自己取倒数；
 *      - echarts 替身记录 init/setOption/on 调用，让「图表是否被正确初始化、点击下钻是否接线」
 *        这类断言不依赖真实 canvas 渲染；
 *      - tailwind / flatpickr / 字体 返回空壳（页面对它们做了 typeof 守卫，见 index.html）。
 *
 * 2. seed(page, state) —— 直接往 localStorage 写 AppState，再导航（只在首次导航生效）。
 *    比「点表单建数据」快得多，也让每个用例的起点是确定的。
 *    字段走 migrateState() 兼容，故只写业务字段即可（见 EMPTY_STATE / sampleState）。
 *
 * 3. exported test —— 预置 ready（已 stub + 已播种 + 已等首屏就绪）；
 *    另有主题色巡检（collectOffThemeColors）与全 Tab 遍历（visitAllTabs）供 theme.spec.js 用。
 */
const { test: base, expect } = require('@playwright/test');

const LS_KEY = 'wealth-manager-data';
const INDEX_URL = 'index.html';

/**
 * 空存档；seed 时按需覆盖。字段集与 logic.js freshAppState() 一致，
 * 但 rates 给的是「已折算好的」非 1 缓存值（freshAppState 是 1:1），
 * 供「拉取失败沿用缓存」类用例直接断言数值——口径与 state.rates 同向：1 外币 = X CNY。
 */
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
  backup: { autoFreq: 'off', lastBackup: null, lastAutoDownload: null },
};

/**
 * 一份够用的示例数据：2 个资产分类（+内置货币）、3 笔资产、2 个消费分类、2 个月共 3 笔消费。
 * 汇率固定（stubCdn 默认 1 HKD = 0.92 CNY / 1 USD = 7.24 CNY），折算结果可预期。
 */
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
 * 拦截所有外部请求。必须在首次 goto 之前调用。
 * 只放行同源（127.0.0.1）的 index.html / logic.js 等。
 *
 * 注意 route 的匹配次序：Playwright 里**后注册的 route 优先命中**，所以兜底
 * （拦掉一切外网）必须先注册，具体 CDN 的替身后注册才能覆盖它。
 *
 * @param {object} [rates] 覆盖汇率 { hkd, usd }（默认 0.92 / 7.24）
 */
async function stubCdn(page, rates) {
  const r = { hkd: 0.92, usd: 7.24, ...(rates || {}) };
  // 兜底：一切非本机请求一律空响应，测试绝不依赖外网
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 200, body: '' }));

  // 汇率 API：固定值，页面按「1 CNY = X 外币」取倒数 => HKD→CNY = 1/hkd
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
        window.__echartsCalls = { init: [], setOption: [], on: [], dispatch: [], resize: 0, dispose: 0, instances: {} };
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

  // Tailwind / flatpickr：空壳。页面对两者都做了存在性守卫（typeof flatpickr !== 'undefined'），
  // Tailwind 只影响观感不影响行为，故给一个能接受 config 赋值的空对象即可。
  await page.route('**/cdn.tailwindcss.com**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind = {};' })
  );
  await page.route('**/flatpickr**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* flatpickr stub */' })
  );

  // 字体：CSS 给空样式、字体文件直接断（页面不依赖它们才渲染）
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
 * @param {object|null} state 存档内容；null 表示清空（全新用户）
 */
async function seed(page, state) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        // 已播种过就不再覆盖：保留应用在上一轮导航中写入的存档
        if (sessionStorage.getItem('__e2e_seeded__')) return;
        sessionStorage.setItem('__e2e_seeded__', '1');
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch (e) {
        /* 隐私模式下 localStorage 不可写：忽略，页面会退化为内存态 */
      }
    },
    [LS_KEY, state === null ? null : JSON.stringify(state)]
  );
}

/** 首屏就绪信号：DOMContentLoaded 里 renderAll() 完成后 masthead 日期已填充 */
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
  /**
   * 全新用户：无存档，CDN 全 stub，首屏已就绪。
   */
  blankPage: async ({ page }, use) => {
    await disableMotion(page);
    await stubCdn(page);
    await seed(page, null);
    await page.goto(INDEX_URL);
    await waitReady(page);
    await use(page);
  },

  /**
   * 有数据用户：sampleState() 播种，CDN 全 stub，首屏已就绪。
   */
  appPage: async ({ page }, use) => {
    await disableMotion(page);
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
    await use(page);
  },
});

/**
 * 关掉动效后再导航：masthead 净资产是 650ms 计数动画（renderMasthead 逐帧 rAF），
 * 断言数字文本时会被它拖到轮询超时。不是「等动画结束」，而是让页面直接跳过动画
 * （prefers-reduced-motion 分支同步赋值）——省掉每个用例的等待。
 */
async function disableMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

/**
 * 进入资产模式（E2E 的单一入口，两个 spec 共用）。
 * 资产入口有长按门槛（见 index.html 的长按门槛一处），这里走**键盘激活**：
 * 合成的 click 的 detail 为 0，直通确认框——既不必等满按住时长（logic.js 的 MODE_PRESS_MS），
 * 也顺带护住「不用鼠标的人不该被挡在门外」这条路径。
 * 长按手势本身由 app.spec.js 的专测用真实鼠标/触摸覆盖。
 *
 * @param {string} [tab] 进入后再切到的资产子 Tab（默认停在「资产管理」）
 */
async function gotoAssets(page, tab) {
  // 幂等：已在资产模式就别再走一次门（第二次长按确认框不会出现——门上本来就有「已在里面就失效」这道闸）
  if (!(await page.locator('#tabs-assets').isVisible())) {
    await page.locator('#mode-assets').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.locator('#confirm-ok-btn').click();
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
  const showPanel = async (bar, tab) => {
    await page.locator(`${bar} .tab-btn[data-tab="${tab}"]`).click();
    // 面板翻转同步发生：直接断言，不 sleep
    await expect(page.locator(`#tab-${tab}`)).toBeVisible();
  };
  await gotoAssets(page);
  for (const t of ['assets', 'categories', 'chart', 'history', 'income']) await showPanel('#tabs-assets', t);
  await page.locator('#mode-expenses').click();
  for (const t of ['expenses', 'expense-categories', 'expense-chart', 'expense-trend']) await showPanel('#tabs-expenses', t);
  // 消费弹窗（chips / 按钮）：需先把面板切回 expenses（遍历结束时停在 expense-trend 上）
  await showPanel('#tabs-expenses', 'expenses');
  await page.locator('#tab-expenses button:has-text("记录消费")').click();
  await expect(page.locator('#expense-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#expense-modal')).toBeHidden();
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

/**
 * 收集当前 DOM 里所有「不来自主题」的计算色。
 *
 * 允许集 = 当前主题的 CSS 变量（:root / :root.dark，按当前模式取一套）
 *          ∪ 分类 pill 调色板（按真实分类×标签逐个求值，暗色分支另算）
 *          ∪ 图表调色板 CATEGORY_PALETTE
 * 不在允许集里的即为「写死色值」或「漏设样式的 UA 默认值」。
 *
 * 返回 { allowedN, offenders: [{ color, where }] }。
 */
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
    CATEGORY_PALETTE.forEach((p) => {
      const c = canon(p.base); if (c) allowed.add(c);
      const l = canon(p.label); if (l) allowed.add(l); // 内环字色也是主题色板的一部分
      p.shades.forEach((s) => { const cc = canon(s); if (cc) allowed.add(cc); });
    });

    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      const st = getComputedStyle(el);
      ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'borderRightColor', 'borderBottomColor']
        .forEach((prop) => {
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
 * ECharts 替身按容器尺寸建模（见 stubCdn），故两边的比较能在无头里做。
 * 不变量只有一条：**图可见时，它的尺寸必须等于容器的尺寸**——
 * 历史上它被破坏过两次（只在 window resize 时统一 resize、以及隐藏时 resize 会把图压小
 * 且 setOption 修不回来），故 chart-resize.spec.js 用它。
 */
const chartSize = (page, id) =>
  page.evaluate((domId) => {
    const el = document.getElementById(domId);
    const inst = (window.__echartsCalls.instances || {})[domId];
    return { container: [el.clientWidth, el.clientHeight], chart: inst ? [inst.getWidth(), inst.getHeight()] : null };
  }, id);

/** 等某张图被初始化出来（切 Tab 渲染有刻意延时） */
const waitChart = (page, id) =>
  expect.poll(() => chartSize(page, id).then((s) => !!s.chart), { message: `${id} 应已初始化` }).toBe(true);

/** 等它对齐（尺寸同步由 ResizeObserver 驱动，异步到下一帧）；失败时把两个尺寸都打出来 */
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
  test, expect, stubCdn, seed, waitReady, disableMotion, readAppState,
  visitAllTabs, gotoAssets, collectOffThemeColors, UA_DEFAULT_COLORS,
  sampleState, EMPTY_STATE, LS_KEY, INDEX_URL,
  samplePixels, pixelLum, chartSize, waitChart, expectChartFit,
};
