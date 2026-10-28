/*
 * e2e/modal-scroll.spec.js — 弹窗打开时，背后的账页必须「冻住」
 * --------------------------------------------------------------------------
 * 用户原话：「我把鼠标放在背景下依然可以滚动外面已经模糊的背景，这个不应该」。
 *
 * 为什么这不是小事：遮罩已经用 blur 把背景推远（「隔着磨砂玻璃」），可滚轮一动，
 * 那层模糊的账页就在下面滑走——**视觉上说着「停下来了」，交互上却还在动**。
 * 同一份「冻结」承诺在触摸、键盘、Tab 上也都该成立（手指拖背景 / PgDn / Tab 到背景按钮），
 * 少一条就是「手机上还能滚、鼠标用户不能」这类只在某些设备上出现的行为。
 *
 * 判据全部读运行时几何（scrollY / 元素可见），不读实现：
 *   - 滚轮、方向键、PageDown 之后 window.scrollY 不变；
 *   - 触摸拖拽（真实触摸事件）之后 scrollY 不变；
 *   - 打开期间 document.body 不可滚（overflow 由「哪层开着」派生，不是随手 setStyle）；
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

// 滚动量要小到 toolbar 仍在视口内：Playwright 点按钮前会把它 scrollIntoView，
// 滚动过头的话这一次点击自己就把页面拉回顶部——测的就不是「锁没锁」了
const SCROLL_TO = 120;

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

/** 打开消费表单（入口不经任何门槛），并把页面滚到中间 */
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
    // 弹窗正文自己仍可滚（大表格弹窗要用）——冻结的只有背景
    await expect(page.locator('#expense-modal')).toBeVisible();
  });

  test('键盘滚动键不滚背景（PgDn / 方向键 / 空格）', async ({ appPage: page }) => {
    await openExpenseModalScrollable(page);
    const before = await scrollY(page);
    for (const key of ['PageDown', 'ArrowDown', 'Space', 'End']) await page.keyboard.press(key);
    expect(await scrollY(page)).toBe(before);
  });

  test('触摸拖拽不滚背景（手机上顺手一拖也不该动）', async ({ browser }) => {
    // 独立触摸上下文：fixtures 的 page 是桌面设备，触摸路径得亲自跑
    const { stubCdn, seed, waitReady, sampleState, INDEX_URL, disableMotion } = require('./fixtures');
    const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 800 }, isMobile: true });
    const page = await ctx.newPage();
    await disableMotion(page);
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);
    await openExpenseModalScrollable(page);

    const before = await scrollY(page);
    // 真实触摸拖拽：Touchscreen 只有 tap，用 CDP 合成一次滑动。
    // 不用 tap——点在遮罩空白处本身就是「关弹窗」的手势，那会把锁解开，测的就不是锁了
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 200 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: 400 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#expense-modal'), '拖拽不该关掉弹窗').toBeVisible();
    expect(await scrollY(page)).toBe(before);
    await ctx.close();
  });

  test('打开期间 body 不可滚；全部关掉后恢复，且滚动位置不跳', async ({ appPage: page }) => {
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(50);
    const before = await scrollY(page);

    const bodyOverflow = () => page.evaluate(() => getComputedStyle(document.body).overflowY);
    expect(await bodyOverflow()).not.toBe('hidden');

    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    expect(await bodyOverflow(), '弹窗开着时 body 不得可滚').toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    expect(await bodyOverflow(), '全关后必须恢复可滚').not.toBe('hidden');
    expect(await scrollY(page), '关闭时不得把滚动位置归零（那是另一种「跳」）').toBe(before);
    // 恢复后真的能滚
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scrollY(page)).toBeGreaterThan(before);
  });

  test('叠层：关掉上层（确认框）后背景仍然冻结，下层弹窗还开着', async ({ appPage: page }) => {
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    await gotoAssets(page, 'categories');
    // 编辑「资产类型」→ 移除仍有引用的标签 → 弹确认框（叠在分类弹窗之上）
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await page.fill('#cat-tags', '活期现金');
    await page.locator('#category-modal button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('hidden');

    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#category-modal'), '下层弹窗还开着').toBeVisible();
    const before = await scrollY(page);
    await page.mouse.move(20, 20);
    await page.mouse.wheel(0, 400);
    expect(await scrollY(page), '下层还开着时背景仍须冻结（不能随上层的关闭一并解冻）').toBe(before);

    await page.keyboard.press('Escape');
    await expect(page.locator('#category-modal')).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden');
  });

  test('打开时页面本身不跳位（滚动条消失不得让内容横移）', async ({ appPage: page }) => {
    // 隐藏 overflow 会让经典滚动条消失，内容整块右移 ~8px：这是「锁滚动」最常见的副作用
    await makeScrollable(page);
    await page.evaluate((y) => window.scrollTo(0, y), SCROLL_TO);
    const x = () => page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().left));
    const before = await x();
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    expect(await x(), '锁滚动不能用 padding 补：main 的左边界不得移动').toBe(before);
  });

  test('弹窗正文自己仍可滚，且滚到头不会把滚轮传给背景', async ({ appPage: page }) => {
    // 用内容最长的设置弹窗：小视口下正文必然溢出
    await page.setViewportSize({ width: 900, height: 380 });
    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    const box = page.locator('#settings-modal .modal-content');
    expect(await box.evaluate((c) => getComputedStyle(c).overflowY)).toBe('auto');
    expect(
      await box.evaluate((c) => ({ sh: c.scrollHeight, ch: c.clientHeight })),
      '小视口下弹窗正文应自身可滚'
    ).toMatchObject({ sh: expect.any(Number), ch: expect.any(Number) });
    expect(await box.evaluate((c) => c.scrollHeight > c.clientHeight + 1)).toBe(true);
    expect(await box.evaluate((c) => getComputedStyle(c).overscrollBehaviorY)).toBe('contain');
    // 正文滚到底之后继续滚：背景仍不动（overscroll-behavior 把链式滚动截住）
    const before = await scrollY(page);
    await box.hover();
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 600);
    expect(await scrollY(page)).toBe(before);
  });
});

/*
 * 同一份「冻结」承诺的另一半：背景不只不该滚，也不该可交互。
 * 现状是指针被遮罩挡住、Tab 被焦点陷阱拦住——但读屏器的虚拟光标与程序化点击仍能进背景，
 * `aria-modal="true"` 于是只是句声明。用 inert 把它变成事实（声明式，一条规则覆盖全部入口）。
 */
test.describe('弹窗打开时背景不可交互', () => {
  // 「是否被 inert 挡住」= 自己或任一祖先带 inert（inert 会向下继承；只读元素自身的
  // .inert 会把「父级 header 被冻结、按钮在 header 里」误判成没冻结）
  const inertOf = (page, sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      return !!(el && (el.inert || el.closest('[inert]')));
    }, sel);

  test('背景被 inert，弹窗本身与便条容器不受影响；关闭后全部解除', async ({ appPage: page }) => {
    expect(await inertOf(page, '#mode-expenses')).toBe(false);
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();

    expect(await inertOf(page, '#mode-expenses'), '页头模式按钮应不可交互').toBe(true);
    expect(await inertOf(page, '#tabs-expenses'), '子 Tab 栏应不可交互').toBe(true);
    expect(await inertOf(page, 'main'), '正文应不可交互').toBe(true);
    expect(await inertOf(page, '#expense-modal'), '弹窗自己当然不能 inert').toBe(false);
    // 便条是全局知会（弹窗里操作也会弹），必须保持可读
    expect(await inertOf(page, '#toast-area')).toBe(false);

    await page.keyboard.press('Escape');
    await expect(page.locator('#expense-modal')).toBeHidden();
    expect(await inertOf(page, '#mode-expenses'), '全部关掉后必须解除').toBe(false);
    expect(await inertOf(page, 'main')).toBe(false);
  });

  test('叠层：下层弹窗不 inert（关掉上层后焦点要还回它），背景仍 inert', async ({ appPage: page }) => {
    await gotoAssets(page, 'categories');
    await page.locator('#categories-list .card', { hasText: '资产类型' }).getByRole('button', { name: '编辑' }).click();
    await page.fill('#cat-tags', '活期现金');
    await page.locator('#category-modal button[type="submit"]').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();

    expect(await inertOf(page, '#confirm-modal')).toBe(false);
    expect(await inertOf(page, '#category-modal'), '被叠住的那层还要接住返回焦点，不能 inert').toBe(false);
    expect(await inertOf(page, 'main')).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    expect(await inertOf(page, '#category-modal')).toBe(false);
    expect(await inertOf(page, 'main'), '下层还开着，背景仍须 inert').toBe(true);
  });

  test('背景元素进不了焦点与无障碍树（inert 的实质，不是「遮罩挡住了」）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    // 指针被遮罩挡住、Tab 被陷阱拦住，两条路都不依赖 inert；inert 买到的是另外两样：
    // ① 背景元素不可聚焦（读屏器的虚拟光标与 focus() 都到此为止）
    // ② 背景从无障碍树里摘出去（`aria-modal` 的承诺终于成真）
    const probe = await page.evaluate(() => {
      const btn = document.getElementById('mode-assets');
      btn.focus();
      return {
        focused: document.activeElement === btn,
        inA11yTree: btn.closest('[inert]') === null,
        ariaHiddenByInert: getComputedStyle(btn).pointerEvents,
      };
    });
    expect(probe.focused, 'inert 的按钮不得被 focus()').toBe(false);
    expect(probe.inA11yTree, '背景元素仍在无障碍树里（inert 没生效）').toBe(false);
  });
});

/*
 * 反向护栏：冻住背景不等于冻住「弹窗的延伸」。
 * 实测踩到的：flatpickr 的日历由库自己挂到 body 下，被一并 inert 掉——弹窗开着时日期选不了。
 * 同类还有便条（弹窗里操作也会弹）与被搬家的 ? 气泡（fixed 挂在 body 下）。
 * 判据写在 isActiveLayer 里（按文档流位置，不按元素清单），这里逐条钉住它认得的三类。
 */
test.describe('背景冻结不误伤「当前弹窗的延伸」', () => {
  test('弹窗里的日期选择器仍可选日期（日历挂在 body 下也不算背景）', async ({ page }) => {
    // flatpickr 在 fixtures 里是空壳，这里要**真的库**（日历由库自己挂到 body 下，正是被判据漏掉的那类层）。
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
    const { stubCdn, seed, waitReady, sampleState, disableMotion, INDEX_URL } = require('./fixtures');
    await disableMotion(page);
    await stubCdn(page);
    // route 后注册者优先：具体替身必须压在 stubCdn 的兜底之上
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
    const inert = await page.evaluate(() => !!document.querySelector('.flatpickr-calendar')?.closest('[inert]'));
    expect(inert, '日期日历不得被冻结（它是弹窗的延伸）').toBe(false);
    await cal.click();
    await expect(page.locator('#expense-date')).not.toHaveValue('');
  });

  test('弹窗里弹的便条不受影响（全局知会，弹窗里面也要看得见）', async ({ appPage: page }) => {
    await page.locator('#tab-expenses button:has-text("记录消费")').click();
    await expect(page.locator('#expense-modal')).toBeVisible();
    const inert = await page.evaluate(() => {
      const area = document.getElementById('toast-area');
      return !!(area.inert || area.closest('[inert]'));
    });
    expect(inert).toBe(false);
  });
});
