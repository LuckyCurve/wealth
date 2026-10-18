/*
 * e2e/glass-material.spec.js — 卡片材质：液态玻璃「看得出是玻璃」的可测特征
 * --------------------------------------------------------------------------
 * 用户原话是「特效看着比较廉价」。廉价感来自三件**可量**的事，故这里逐条量：
 *   ① 底不够透——染色太实就与纸面只剩一条边的差别，材质消失，退回白板。
 *   ② 形状**没有受光方向**——四边一圈等亮，玻璃也是一块有描边的白板。
 *   ③ 背后是**纯色**——透光材质没有东西可透，blur 变成一笔没有观感的开销。
 * 另加一条护栏（开发中真实踩到的）：桌光在**页头下沿**会露出一道台阶（页头底色为过 AA
 * 巡检必须是不透明纯色），看着就是一条淡淡的横边。
 *
 * 关键判据读的是**渲染后的像素**（fixtures.samplePixels：截图交给浏览器自己解码），
 * 不是声明也不是计算样式——「写对了 class 但被覆盖 / 被后来的一层盖住」只有像素能看见，
 * 而这正是本次改动（材质）唯一能出问题的地方。数值口径：亮度取 AA 巡检同一套公式。
 *
 * 取样点都在**边中点**而非四角：卡片圆角 10px，落在弧线上的取样会读到描边的抗锯齿，
 * 得到与材质无关的假读数（本文件开发时就踩过一次）。
 */
const { test, expect, sampleState, seed, stubCdn, waitReady, disableMotion, samplePixels, pixelLum } = require('./fixtures');

/** 页面里最宽的那张卡片（表格卡），并给出它四条边中点的取样坐标 */
const cardEdges = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.card')].filter((c) => c.getBoundingClientRect().width > 900).pop();
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const insets = cs.boxShadow
      .split(/,(?![^(]*\))/)
      .filter((s) => /inset/.test(s))
      .map((s) => {
        const nums = (s.match(/-?[\d.]+px/g) || []).map(parseFloat);
        const c = (s.match(/rgba?\([^)]+\)/) || [''])[0];
        const p = (c.match(/[\d.]+/g) || []).map(Number);
        const col = p.length ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null;
        return { dx: nums[0], dy: nums[1], color: col };
      });
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      // 不透明底（rgb 形式没有第四个分量）要报成 alpha=1，否则断言会以 undefined 的形式莫名失败
      fillAlpha: (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || []).map(Number)[3] ?? 1,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      insets,
    };
  });

/** 顶/底边中点往里 1px 的亮度（受光边与背光边的实测对比） */
async function edgeLum(page, info) {
  const { x, y, w, h } = info.rect;
  const mid = x + w / 2;
  const [top, bottom] = await samplePixels(page, [[mid, y + 1], [mid, y + h - 2]]);
  return { top: pixelLum(top), bottom: pixelLum(bottom) };
}

const open = async (page) => {
  await disableMotion(page);
  await stubCdn(page);
  await seed(page, sampleState());
  await page.goto('index.html');
  await waitReady(page);
};

/** 切到暗色（入口唯一在设置弹窗里，与其余 spec 一致） */
const setDark = async (page) => {
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('#theme-seg-dark').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveClass(/dark/);
};

test.describe('卡片材质：液态玻璃的可测特征', () => {
  test('底透光过半：染色过实就与纸面只剩一条边的差别', async ({ page }) => {
    await open(page);
    const m = await cardEdges(page);
    expect(m.fillAlpha, '卡片底色必须透明（纸面与桌光要能透上来）').toBeGreaterThan(0);
    expect(m.fillAlpha, `底色不透明度 ${m.fillAlpha}：透光不过半时纸色透不上来`).toBeLessThanOrEqual(0.42);
    expect(m.backdropFilter, '背光模糊是玻璃的核心').toMatch(/blur\(/);
  });

  test('渲染后确有受光方向：顶边比底边亮（两套主题都要）', async ({ page }) => {
    await open(page);
    // 改前实测：顶 0.976 / 底 0.972（差 0.004，即「一圈等亮」），两套主题都是这个数
    await open(page);
    for (const theme of ['亮色', '暗色']) {
      if (theme === '暗色') await setDark(page);
      const info = await cardEdges(page);
      const { top, bottom } = await edgeLum(page, info);
      expect(top - bottom, `【${theme}】顶边 ${top.toFixed(3)} vs 底边 ${bottom.toFixed(3)}：看不到受光方向`).toBeGreaterThan(0.02);
      // 声明侧的同一条约束（像素过了但源码被改成别的写法时，这里能说出是哪一条）
      const bright = info.insets.filter((s) => s.color && s.color.a > 0 && s.color.r + s.color.g + s.color.b > 3 * 200);
      const dark = info.insets.filter((s) => s.color && s.color.a > 0 && s.color.r + s.color.g + s.color.b < 3 * 200);
      expect(bright.length, `【${theme}】要有一枚亮的 inset（受光）`).toBeGreaterThan(0);
      expect(dark.length, `【${theme}】要有一枚暗的 inset（背光）`).toBeGreaterThan(0);
      expect(bright.some((s) => s.dy >= 0), `【${theme}】受光落在顶面/左上（dy ≥ 0）`).toBe(true);
      expect(dark.some((s) => s.dy <= 0), `【${theme}】背光落在底面/右下（dy ≤ 0）`).toBe(true);
    }
  });

  test('玻璃要有可感的厚度：两角柔光的明暗差达到可感知量级（两套主题）', async ({ page }) => {
    // 用户反馈「太浅淡」。原先 sheen/shade 的柔光被压在 ±8px/13px、alpha 0.34/0.10，
    // 渲染后卡内左上 vs 右下的亮度差只有 ~0.01（亮色）——等于没有。
    // 「厚度」的可测特征：卡内受光角（左上）与背光角（右下）存在可感知的亮度坡度。
    // 取样点在**内边距带**（25% 宽、10px 高内），不进正文——柔光爬进正文会被 AA 巡检跳过。
    await open(page);
    for (const theme of ['亮色', '暗色']) {
      if (theme === '暗色') await setDark(page);
      const info = await cardEdges(page);
      const { x, y, w, h } = info.rect;
      const pts = [
        [Math.round(x + w * 0.22), Math.round(y + 10)],         // 受光角
        [Math.round(x + w * 0.78), Math.round(y + h - 10)],     // 背光角
      ];
      const [tl, br] = await samplePixels(page, pts);
      const d = pixelLum(tl) - pixelLum(br);
      expect(d, `【${theme}】卡内两角的明暗坡度 ${pixelLum(tl).toFixed(3)} → ${pixelLum(br).toFixed(3)} 不可感知（玻璃没有厚度感）`).toBeGreaterThan(0.04);
    }
  });

  test('blur 确实在「揉」背后的纹理：桌面的纹理起伏 > 卡内（折射的证据）', async ({ page }) => {
    // 玻璃的核心观感是它**改变**了背后的东西。桌光是大尺度渐变，blur 对它几乎无作用；
    // blur 真正改变的是**纸纹**（60px 周期的高频纹理）：桌面上的纹理还在起伏，
    // 卡内的同一纹理被 blur 揉平。可测特征：跨纸纹取样的亮度极差（max−min）
    // 桌面 > 卡内（纸纹进了玻璃就被揉掉）。
    await open(page);
    // 亮色：桌面纸纹（高频）应被卡内 blur 揉平——卡内同段的纹理起伏 < 桌面。
    // 暗色不适用：暗色卡内的高频来自玻璃自身的 sheen/rim 材质（那是想要的厚度感，
    // 不是纸纹），「卡内纹理更小」在暗色下物理意义相反，故暗色不进这条。
    const info = await cardEdges(page);
    const { x, y, w, h } = info.rect;
    const yMid = Math.round(y + h / 2);
    // 同一行上取 4 点（覆盖 ≥1 个纸纹周期 60px）：卡内一段 + 桌面一段
    const inside = [4, 20, 36, 52].map((dx) => [Math.round(x + dx), yMid]);
    const outside = [30, 46, 62, 78].map((dx) => [Math.round(x - dx), yMid]);
    const pin = await samplePixels(page, inside);
    const pout = await samplePixels(page, outside);
    const lum = (a) => a.map((p) => pixelLum(p));
    const spread = (a) => Math.max(...a) - Math.min(...a);
    const inSpread = spread(lum(pin));
    const outSpread = spread(lum(pout));
    expect(outSpread, `桌面纸纹的起伏（${outSpread.toFixed(4)}）应可测`).toBeGreaterThan(0.002);
    expect(inSpread, `卡内纸纹起伏 ${inSpread.toFixed(4)} 应明显小于桌面 ${outSpread.toFixed(4)}（blur 揉平了它）`).toBeLessThan(outSpread);
  });

  test('桌面上有一层静态光照（透光材质才有东西可透），且唯一「活」的光仍是台灯', async ({ page }) => {
    await open(page);
    const desk = await page.evaluate(() => {
      const d = getComputedStyle(document.body, '::after');
      return { bg: d.backgroundImage, position: d.position, zIndex: d.zIndex, pointerEvents: d.pointerEvents };
    });
    expect(desk.position, '桌面光照是铺满视口的固定层，不跟着滚动跑').toBe('fixed');
    expect(desk.pointerEvents).toBe('none');
    expect(Number(desk.zIndex), '要落在纸纹之后（纸是铺在桌上的）').toBeLessThan(-1);
    expect(desk.bg, '桌面光照要有明暗层次，不能是空的').toMatch(/gradient\(/);
    expect(desk.bg, '桌面光照不得跟指针走（那就成了第二盏灯）').not.toMatch(/lamp/);
    // 不只是「声明了」：真的渲染出明暗（左上受光 → 右下退光）
    const [tl, br] = await samplePixels(page, [[16, 200], [page.viewportSize().width - 16, page.viewportSize().height - 20]]);
    expect(pixelLum(tl) - pixelLum(br), `桌面看不出退光：左上 ${pixelLum(tl).toFixed(3)} vs 右下 ${pixelLum(br).toFixed(3)}`)
      .toBeGreaterThan(0.02);
  });

  test('页头下沿不得露出桌光的台阶（页头底色为 AA 巡检必须是不透明纯色）', async ({ page }) => {
    await open(page);
    const bottom = await page.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().bottom);
    const xs = [40, 640, 1130];
    const pts = [];
    xs.forEach((x) => pts.push([x, bottom - 2], [x, bottom + 2]));
    const px = await samplePixels(page, pts);
    xs.forEach((x, i) => {
      const [above, below] = px.slice(i * 2, i * 2 + 2);
      // 桌光在页头底下露出台阶时，那里会横着一条「淡淡的边」——实测改前右端 4/255
      expect(Math.abs(below.r - above.r), `页头下沿 x=${x} 处有 ${below.r - above.r}/255 的台阶`).toBeLessThanOrEqual(2);
    });
  });

  test('弹窗遮罩：磨砂够深、色走 --scrim，正文保持不透明底（表单可读性）', async ({ page }) => {
    // 遮罩是弹窗与整个账本材质语言的衔接处：原先写死 rgba(13,11,8,0.5)
    //（主题巡检清理清单里长期挂着一行），现走变量、亮暗各自成套；
    // 磨砂半径 4px 时背后标题与数字仍隐约可辨，会抢弹窗正文的注意力。
    // 正文底必须不透明：半透明会把表单文字压在糊开的深色上，可读性先垮。
    await open(page);
    const m = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.modal-overlay'));
      const content = getComputedStyle(document.querySelector('.modal-content'));
      const blur = ((cs.backdropFilter || cs.webkitBackdropFilter || '').match(/blur\(([\d.]+)px\)/) || [])[1];
      const probe = document.createElement('span');
      document.body.appendChild(probe);
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--scrim').trim();
      const scrimVar = getComputedStyle(probe).color;
      probe.remove();
      const parts = (content.backgroundColor.match(/[\d.]+/g) || []).map(Number);
      return { blur: blur ? parseFloat(blur) : 0, scrim: cs.backgroundColor, scrimVar, contentAlpha: parts[3] ?? 1 };
    });
    expect(m.blur, `遮罩磨砂只有 ${m.blur}px：背后的纸面会直接透出来`).toBeGreaterThanOrEqual(8);
    expect(m.scrimVar, '--scrim 必须在 :root 定义（遮罩颜色单一来源）').toBeTruthy();
    expect(m.scrim, '遮罩色必须从 --scrim 来（不再写死）').toBe(m.scrimVar);
    expect(m.contentAlpha, '弹窗正文底必须不透明（半透明会压掉表单文字的可读性）').toBe(1);
  });
});
