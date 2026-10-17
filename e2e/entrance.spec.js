/*
 * entrance.spec.js — 开屏（落纸入场）
 * --------------------------------------------------------------------------
 * 用户要「开屏或其他特效，提升页面质感」。做的是**非阻塞**入场：页面落到纸上，
 * 两拍——三段纸面依次落定，然后台灯升起来。
 *
 * 量的是「入场不伤人」的四件事：动效关掉时内容立刻是最终态、开着动效时真的在过渡且收敛到可见、
 * 页面不得因此空白、**隐藏容器里的纸面不会卡在起始帧**（后者是实测踩出来的：用 @keyframes 时，
 * 另一个模式的 Tab 栏不在渲染中，动画不跑而 fill 把 from 帧留着，那块会一直是隐形的——
 * 改成两态 transition 才不会卡）。
 *
 * 不量动画中间帧：拿时序当断言必然脆。量的是**声明**与**结束态**。
 */
const { test, expect, stubCdn, seed, waitReady, sampleState } = require('./fixtures');

/** 三条纸面：页头 / 子 Tab 栏（两个模式各一条）/ 正文 */
const BANDS = ['.app-header-inner', '.tab-bar', 'main.content-column'];

const bandState = (page) =>
  page.evaluate((sels) => {
    const out = [];
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el, i) => {
        const cs = getComputedStyle(el);
        out.push({
          sel: `${s}[${i}]`,
          opacity: cs.opacity,
          transform: cs.transform,
          prop: cs.transitionProperty,
          duration: cs.transitionDuration,
          delay: parseFloat(cs.transitionDelay),
        });
      });
    }
    return out;
  }, BANDS);

test.describe('开屏：落纸入场', () => {
  test('动效关掉时：入场立刻停在最终态（内容可见、不动）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    await expect(page.locator('html')).toHaveClass(/\bready\b/);
    for (const b of await bandState(page)) {
      expect(b.opacity, `${b.sel} 应立刻完全可见`).toBe('1');
      expect(b.transform, `${b.sel} 应不带位移`).toBe('none');
    }
  });

  test('开着动效时：三条纸面都声明了过渡、依次错开，并收敛到最终态', async ({ page }) => {
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    const bands = await bandState(page);
    // 每次打开浏览器都是同一条时间线（错开靠 delay，不靠脚本排队）
    // 取样顺序：页头 → 两条 Tab 栏（两个模式各一条，同一段纸面故同延迟）→ 正文
    expect(bands.map((b) => b.delay)).toEqual([0, 0.06, 0.06, 0.12]);
    for (const b of bands) {
      expect(b.prop, `${b.sel} 应过渡 opacity/transform`).toContain('opacity');
      expect(b.duration, `${b.sel} 的有过渡时长`).not.toBe('0s');
    }
    await expect
      .poll(async () => (await bandState(page)).every((b) => b.opacity === '1' && b.transform === 'none'))
      .toBe(true);
  });

  test('隐藏容器里的纸面不会卡在起始帧（另一个模式的 Tab 栏也要到最终值）', async ({ page }) => {
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    // 资产模式的 Tab 栏此刻是 display:none —— 计算值必须是 1（一旦切过去就能看见）
    const hidden = await page.evaluate(() => {
      const el = document.querySelector('#tabs-assets .tab-bar');
      return { rendered: el.getBoundingClientRect().width > 0, opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform };
    });
    expect(hidden.rendered, '这条断言的前提是它此刻确实不在渲染中').toBe(false);
    expect(hidden.opacity, '不渲染的纸面也必须落到最终值（否则切过去是隐形的）').toBe('1');
    expect(hidden.transform).toBe('none');
  });

  test('台灯升起（第二拍）：未落定时压着，落定后随指针亮起来', async ({ page }) => {
    await stubCdn(page);
    await seed(page, sampleState());
    await page.goto('index.html');
    await waitReady(page);
    // 灯是否点着由指针决定（lampEnabled）：先把指针移进窗口，它才该亮
    await page.mouse.move(420, 320);
    await expect
      .poll(async () => page.evaluate(() => getComputedStyle(document.querySelector('.lamp-layer')).opacity))
      .toBe('1');
    // 未落定那一态里它必须被压住（否则开屏第二拍就不存在了）
    const rule = await page.evaluate(() => {
      const sheets = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } });
      return sheets.map((r) => r.cssText).find((t) => t.includes('booting:not(.ready) .lamp-layer')) || '';
    });
    expect(rule, '未落定态要按住台灯').toContain('opacity: 0');
  });

  test('看门狗：脚本没跑到就绪那一步也会自己放行（页面不得空白）', async ({ page }) => {
    await stubCdn(page);
    await seed(page, sampleState());
    // 阻断应用脚本：只加 booting、永远等不到 ready
    await page.route('**/logic.js', (r) => r.abort());
    await page.goto('index.html');
    await expect(page.locator('html')).toHaveClass(/\bbooting\b/);
    await expect.poll(async () => page.evaluate(() => document.documentElement.className), { timeout: 4000 })
      .toContain('ready');
  });
});
