/*
 * e2e/modal-scroll.spec.js — 弹窗打开时，背后的账页必须「冻住」
 * --------------------------------------------------------------------------
 * 用户原话：「我把鼠标放在背景下依然可以滚动外面已经模糊的背景，这个不应该」。
 *
 * 为什么这不是小事：遮罩已经用 blur 把背景推远（「隔着磨砂玻璃」），可滚轮一动，
 * 那层模糊的账页就在下面滑走——**视觉上说着「停下来了」，交互上却还在动**。
 * 同一份「冻结」承诺在触摸、键盘、Tab 上也都该成立（手指拖背景 / PgDn / Tab 到背景按钮）。
 *
 * 现在这条承诺由原生 <dialog>.showModal() 兑现：背景 inert + 顶层挡在前面 +
 * dialog:modal / dialog::backdrop 上的 overscroll-behavior 收住滚动链——不再有
 * html.modal-open 的 overflow:hidden（那会吃掉根滚动条、给整页带来横向位移）。
 *
 * 判据全部读运行时几何（scrollY / 元素可见 / 焦点落点），不读实现：
 *   - 滚轮、方向键、PageDown 之后 window.scrollY 不变；
 *   - 触摸拖拽（真实触摸事件）之后 scrollY 不变；
 *   - 背景元素 focus() 不进去（inert 的实质）；
 *   - 叠层（确认框压住分类弹窗）关掉上层后，背景仍冻结；全关后恢复可滚且**不跳位**。
 */
const { test, expect, gotoAssets } = require('./fixtures');

/** 让页面本身就够长：滚动才有意义（数据少时整页撑不满视口，滚不动是假绿） */
const makeScrollable = (page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = '__scroll_probe__';
    probe.style.height = '3000px';
    document.querySelector('main').appendChild(probe);
  });

const SCROLL_TO = 120;

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

async function openExpenseModalScrollable(page) {
  await makeScrollable(page);
  await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
  await expect.poll(() => scrollY(page)).toBeGreaterThan(50);
  await page.locator('#tab-expenses button:has-text("记录消费")').click();
  await expect(page.locator('#expense-modal')).toBeVisible();
}

test.describe('弹窗打开时背景不可滚', () => {
  test('滚轮不滚背景（鼠标停在遮罩上）', async ({ appPage: page }) => {
    await openExpenseModalScrollable(page);
    const before = await scrollY(page);
    await page.mouse.move(20, 20); // 遮罩左上角，远离弹窗正文
    for (let i = 0; i < 5; i += 1) await page.mouse.wheel(0, 400);
    expect(await scrollY(page)).toBe(before);
    await expect(page.locator('#expense-modal')).toBeVisible();
  });

  test('键盘滚动键不滚背景（PgDn / 方向键 / 空格）', async ({ appPage: page }) => {
    await openExpenseModalScrollable(page);
    const before = await scrollY(page);
    for (const key of ['PageDown', 'ArrowDown', 'Space', 'End']) await page.keyboard.press(key);
    expect(await scrollY(page)).toBe(before);
  });

  test('触摸拖拽不滚背景（手机上顺手一拖也不该动）', async ({ browser }) => {
    const { stubExternal, seed, waitReady, sampleState, INDEX_URL, disableMotion } = require('./fixtures');
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 800 }, isMobile: true });
    const page = await ctx.newPage();
    await disableMotion(page);
    await stubExternal(page);
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
    await openExpenseModalScrollable(page);

    const before = await scrollY(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 200 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#expense-modal'), '拖拽不该关掉弹窗').toBeVisible();
    expect(await scrollY(page)).toBe(before);
    await ctx.close();
  });

  test('打开不锁 html/body 的 overflow；全关后滚动位置不跳', async ({ appPage: page }) => {
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(50);
    const before = await scrollY(page);

    const overflowOf = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).overflowY, sel);
    expect(await overflowOf('body')).not.toBe('hidden');

    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    // 平台的口径：不锁 overflow（锁了会吃掉根滚动条、整页横移），靠遮罩与 overscroll 收住
    expect(await overflowOf('html'), 'html 不得被 overflow:hidden 锁住').not.toBe('hidden');
    expect(await overflowOf('body'), 'body 不得被 overflow:hidden 锁住').not.toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    expect(await scrollY(page), '关闭时不得把滚动位置归零（那是另一种「跳」）').toBe(before);
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
  });

  test('叠层：关掉上层（确认框）后背景仍然冻结，下层弹窗还开着', async ({ appPage: page }) => {
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    await gotoAssets(page, 'categories');
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await page.fill('#cat-tags', '活期现金');
    await page.locator('#category-modal button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#category-modal'), '下层弹窗还开着').toBeVisible();
    const before = await scrollY(page);
    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 400);
    expect(await scrollY(page), '下层还开着时背景仍须冻结（不能随上层的关闭一并解冻）').toBe(before);

    await page.keyboard.press('Escape');
    await expect(page.locator('#category-modal')).toBeHidden();
  });

  test('打开时页面本身不跳位（滚动条不得出现或消失）', async ({ appPage: page }) => {
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    const x = () => page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().left));
    const width = () => page.evaluate(() => document.documentElement.clientWidth);
    const before = await x();
    const beforeWidth = await width();
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    expect(await x(), 'main 的左边界不得移动').toBe(before);
    expect(await width(), '视口可用宽度不得变化（滚动条不该被吃掉）').toBe(beforeWidth);
  });

  test('弹窗正文自己仍可滚，且滚到头不会把滚轮传给背景', async ({ appPage: page }) => {
    await page.setViewportSize({ width: 900, height: 380 });
    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    const box = page.locator('#settings-modal');
    expect(await box.evaluate((c) => getComputedStyle(c).overflowY)).toBe('auto');
    expect(
      await box.evaluate((c) => ({ sh: c.scrollHeight, ch: c.clientHeight })),
      '小视口下弹窗正文应自身可滚'
    ).toMatchObject({ sh: expect.any(Number), ch: expect.any(Number) });
    expect(await box.evaluate((c) => c.scrollHeight > c.clientHeight + 1)).toBe(true);
    expect(await box.evaluate((c) => getComputedStyle(c).overscrollBehaviorY)).toBe('contain');
    const before = await scrollY(page);
    await box.hover();
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 600);
    expect(await scrollY(page)).toBe(before);
  });
});

/*
 * 同一份「冻结」承诺的另一半：背景不只不该滚，也不该可交互。
 * 现在这条由平台的模态给（showModal 让背景 inert），页面不再逐元素切 inert：
 * 判据是「焦点进不去背景」「背景从无障碍树里摘出去」，而不是读某个属性。
 */
test.describe('弹窗打开时背景不可交互', () => {
  test('背景元素进不了焦点与无障碍树（inert 的实质，不是「遮罩挡住了」）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    const probe = await page.evaluate(() => {
      const btn = document.getElementById('mode-assets');
      btn.focus();
      const tree = document.getElementById('expense-modal').closest('dialog');
      return {
        focused: document.activeElement === btn,
        inDialog: !!tree && tree.contains(document.activeElement),
        // 背景整块被平台挡在模态之外：无障碍树里查不到页头的模式按钮
        headerInA11yTree: !!document.querySelector('.app-header:not([aria-hidden])') && !btn.inert,
      };
    });
    expect(probe.focused, '模态开着时背景按钮不得被 focus() 抢走焦点').toBe(false);
    expect(probe.inDialog, '焦点必须仍在弹窗里').toBe(true);
  });

  test('页面不再逐元素切 inert（那套已被平台的模态取代）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    const inertFlags = await page.evaluate(() =>
      [...document.body.children].map((el) => el.inert === true).filter(Boolean).length);
    expect(inertFlags, '页面不得再自己给背景元素加 inert（平台已整块挡住）').toBe(0);
  });

  test('弹窗里弹的便条看得见（容器跟着顶层走）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await page.evaluate(() => toast('弹窗里的提示', 'error'));
    const toastEl = page.locator('#toast-area .toast', { hasText: '弹窗里的提示' });
    await expect(toastEl).toBeVisible();
    // 真的在顶层：命中测试要能拿到便条自己（挂在 body 下会被遮罩压住、点不到也看不清）
    const hit = await toastEl.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(at && el.contains(at));
    });
    expect(hit, '便条必须在遮罩之上（原生弹窗把 body 下的东西全挡在下面）').toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    // close 事件是队列任务（不是同步派发），故这里要 poll 一下
    await expect
      .poll(async () => page.evaluate(() => document.getElementById('toast-area').parentElement.tagName))
      .toBe('BODY');
  });
});

/*
 * 反向护栏：冻住背景不等于冻住「弹窗的延伸」。
 * 实测踩到的：flatpickr 的日历由库自己挂到 body 下 —— 原生弹窗把它挡在模态之外，
 * 日期选不了。故它必须挂进那层 dialog（见 app-ui.js/app-assets.js 的 pickerInDialog）。
 */
test.describe('背景冻结不误伤「当前弹窗的延伸」', () => {
  test('弹窗里的日期选择器仍可选日期（日历挂进那层 dialog）', async ({ page }) => {
    // flatpickr 在 fixtures 里是空壳，这里要**真的库**（日历由库自己挂，正是会被挡住的那类层）。
    // 但不能放行外网：cdn.jsdelivr 那 300KB 是每轮 3~4s，且断网即红——
    // 改为从 devDependency `flatpickr` 读同一份 dist（版本钉在 package-lock，离线可跑）。
    const fs = require('fs');
    const path = require('path');
    const FP = path.dirname(require.resolve('flatpickr/package.json'));
    const flatpickrRoutes = {
      js: fs.readFileSync(path.join(FP, 'dist/flatpickr.js'), 'utf8'),
      css: fs.readFileSync(path.join(FP, 'dist/flatpickr.min.css'), 'utf8'),
      zh: fs.readFileSync(path.join(FP, 'dist/l10n/zh.js'), 'utf8'),
    };
    const { stubExternal, seed, waitReady, sampleState, disableMotion, INDEX_URL } = require('./fixtures');
    await disableMotion(page);
    await stubExternal(page);
    // route 后注册者优先：具体替身必须压在 stubExternal 的兜底之上
    await page.route('**/flatpickr**', (route) => {
      const url = route.request().url();
      if (url.endsWith('.css')) return route.fulfill({ status: 200, contentType: 'text/css', body: flatpickrRoutes.css });
      if (url.includes('/l10n/zh')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: flatpickrRoutes.zh });
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: flatpickrRoutes.js });
    });
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    await page.locator('#expense-date').click();
    const cal = page.locator('.flatpickr-calendar .flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)').nth(9);
    await expect(cal).toBeVisible();
    // 日历必须挂进弹窗（挂 body 下会被模态挡住：点不到也看不见）
    expect(await page.evaluate(() => document.querySelector('.flatpickr-calendar').parentElement.id)).toBe('expense-modal');
    // 而且位置要真的贴在日期框下方（库写的是文档坐标，挂进 dialog 后要减掉滚动量）
    await expect
      .poll(async () => page.evaluate(() => {
        const c = document.querySelector('.flatpickr-calendar').getBoundingClientRect();
        const i = document.getElementById('expense-date').getBoundingClientRect();
        return Math.round(c.top - i.bottom);
      }))
      .toBeLessThanOrEqual(4);
    await cal.click();
    await expect(page.locator('#expense-date')).not.toHaveValue('');
  });
});
