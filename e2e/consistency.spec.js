/*
 * e2e/consistency.spec.js — 版式一致性巡检
 * --------------------------------------------------------------------------
 * AGENTS.md 的版式约定：「同类结构共用同一套 class（章节头 / 表格 / 按钮 / 弹窗页脚 /
 * 字段标签 / 下拉框），页面不内联重复样式」。单测（test/ui-wiring.test.js）守的是
 * 「HTML 文本里有没有内联样式」；这里守的是另一半——**同类元素在真实浏览器里算出来的
 * 样式是否真的一致**（写对了 class 但 CSS 被覆盖、或漏挂 class，单测看不出来）。
 *
 * 判据统一为「同类元素的计算样式集合大小 == 1」，集合里直接打印越界值，失败信息可读。
 * 与主题巡检（theme.spec.js）同思路：不写死期望值，从页面自身求值。
 */
const { test, expect, visitAllTabs, gotoAssets, sampleState, seed, waitReady, stubCdn, samplePixels, INDEX_URL } = require('./fixtures');

/**
 * 本文件要按「指定存档」打开页面（fixtures 只导出工厂，组合放在这里）。
 * seed 只在首次导航生效，故每次 openWith 都用新 page，不会互相污染。
 */
async function openWith(page, state) {
  await stubCdn(page);
  await seed(page, state);
  await page.goto('index.html');
  await waitReady(page);
}

// 进入资产侧的入口统一用 fixtures.gotoAssets（长按门槛的键盘通道），
// 原先 app.spec / consistency.spec 各写一份同样的动作，改门槛时两边都要改
const gotoAssetsTab = (page, tab) => gotoAssets(page, tab === 'assets' ? undefined : tab);

/** 收集当前 DOM 里同类元素的指定计算样式，返回去重后的列表（>1 即为不一致） */
const uniqStyles = (page, selector, props) =>
  page.evaluate(
    ([sel, list]) => {
      const cs = (el, p) => getComputedStyle(el)[p];
      return [
        ...new Set(
          [...document.querySelectorAll(sel)].map((el) => list.map((p) => cs(el, p)).join(' | '))
        ),
      ];
    },
    [selector, props]
  );

const once = (styles) => expect(styles, `同类元素样式不一致：\n  ${styles.join('\n  ')}`).toHaveLength(1);

test.describe('版式一致性', () => {
  test('章节头 / 表头 / 字段标签 / 下拉框：同类元素计算样式完全一致', async ({ appPage: page }) => {
    await visitAllTabs(page);

    // 章节头：布局（flex + 两端对齐 + 换行 + 下间距）
    await once(await uniqStyles(page, '.section-head', ['display', 'justifyContent', 'alignItems', 'gap', 'flexWrap', 'marginBottom']));
    // 表头：字号/字重/底色（原先每处内联 text-xs font-medium + color）
    await once(await uniqStyles(page, '.list-head', ['fontSize', 'fontWeight', 'color']));
    // 下拉框：宽度只此一处
    await once(await uniqStyles(page, '.select-field', ['minWidth']));
    // 次要文字：唯一 muted 出口
    await once(await uniqStyles(page, '.muted', ['color']));
    // 加粗读数：字重只此一处
    await once(await uniqStyles(page, '.readout-strong', ['fontWeight']));
    // 文字色角色：金色读数 / 正向收益各自唯一
    await once(await uniqStyles(page, '.ink-accent', ['color']));
    await once(await uniqStyles(page, '.ink-up', ['color']));
    await once(await uniqStyles(page, '.text-value', ['color', 'opacity']));
  });

  test('同一行的表单控件与按钮等高（Tailwind preflight 不得吃掉内边距）', async ({ page }) => {
    // 盲区回归：E2E 里 Tailwind 是空壳（window.tailwind = {}），preflight 从不注入，
    // 于是「CDN 真身把 input/select 的 padding 抹成 0」在测试里永远看不见——用户实测
    // 搜索框 23px、下拉框 22px，紧挨着的金色按钮 39px，一行里三种高度。
    // 这里**替身复刻那一条真实规则**（只复刻会伤到规格的那部分，不引真实 CDN），
    // 判据是「同一行内等高」而不是写死像素值。
    await stubCdn(page);
    await page.route('**/cdn.tailwindcss.com**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.tailwind = {};',
      })
    );
    // preflight 的注入面：<style> 由 CDN 在运行时插到页头末尾。规则照抄 Tailwind 的原文
    // （逐条声明，不是 font 简写——简写会连 font-variant 一起重置，量出来的高度与真身不同）。
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = 'button,input,optgroup,select,textarea{font-family:inherit;'
          + 'font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;'
          + 'font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}';
        document.head.appendChild(s);
      });
    });
    await seed(page, sampleState());
    await page.goto(INDEX_URL);
    await waitReady(page);

    // 判据用**内边距与描边**而不是像素高度：stub 下字体不加载，按钮与输入框的字形度量
    // 天然差 1–2px（真机里也只差 0–1px），拿高度当判据会得到与缺陷无关的噪声。
    // 缺陷本身是「内边距整片变成 0」——量它，既精确又与字体无关。
    const boxes = await page.evaluate(() =>
      ['#expense-search', '#expense-month-filter', '#expense-tag-filter', '#tab-expenses .btn-gold']
        .map((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { sel, pt: cs.paddingTop, pb: cs.paddingBottom, bt: cs.borderTopWidth };
        })
    );
    expect(boxes.every(Boolean), '四个控件都应可见').toBe(true);
    for (const b of boxes) {
      expect(b.pt, `${b.sel} 的上内边距被覆盖了（Tailwind preflight 的 padding:0 抢到了）`).toBe('8px');
      expect(b.pb, `${b.sel} 的下内边距被覆盖了`).toBe('8px');
      expect(b.bt, `${b.sel} 的描边被覆盖了`).toBe('1px');
    }
  });

  test('原生控件的外观由页面接管：无 UA 箭头 / 无 UA spinner / 聚焦不改形', async ({ appPage: page }) => {
    // 三处缺陷同源：把「长什么样」留给了浏览器，而浏览器画的东西不认主题、不认对齐。
    // ① select 的箭头由浏览器画在右侧，页面拿不到它的位置——实测文字距左 18.5px、
    //    箭头距右 4px，左右永远对不齐（用户原话「左右都不对齐」）。
    // ② number 输入的上下箭头是 UA 画的，hover/聚焦才出现，一出现就是灰块，与暖色纸面脱节。
    // ③ 全局 :focus-visible 上写了 border-radius: 4px，聚焦时把控件的 6px 圆角改掉——
    //    焦点一来形状就跳一下，这是最不该有的那种「细节」。
    await visitAllTabs(page);

    const bad = await page.evaluate(() => {
      const out = [];
      // ① select 必须是页面接管的外观：要么关掉原生外观（appearance:none + 自绘箭头），
      //    要么 opt-in base-select（弹层跟主题走，箭头仍自绘、::picker-icon 隐掉）。
      //    两种都算「页面接管」；判据不是写死某个值，否则换实现就得改测试。
      for (const el of document.querySelectorAll('select')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const cs = getComputedStyle(el);
        if (cs.appearance !== 'none' && cs.appearance !== 'base-select') {
          out.push(`select#${el.id} 仍是原生外观（${cs.appearance}，箭头由浏览器画）`);
        }
        if (cs.backgroundImage === 'none') out.push(`select#${el.id} 没有自绘箭头`);
      }
      // ② number 输入不能带 UA spinner
      for (const el of document.querySelectorAll('input[type=number]')) {
        if (getComputedStyle(el).appearance !== 'textfield') out.push(`input#${el.id} 仍带原生 spinner`);
      }
      // ③ 聚焦不得改变圆角（对比同一个元素聚焦前后）
      for (const el of document.querySelectorAll('input:not([type=range]):not([type=file]), select')) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const idle = getComputedStyle(el).borderRadius;
        el.focus();
        const focused = getComputedStyle(el).borderRadius;
        el.blur();
        if (idle !== focused) out.push(`${el.tagName.toLowerCase()}#${el.id} 聚焦时圆角 ${idle} → ${focused}`);
      }
      return out;
    });
    expect(bad, `控件外观仍交给浏览器：\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  test('暗色下自绘箭头仍在（主题覆盖不得用 background 简写吃掉它）', async ({ appPage: page }) => {
    // 实测漏网：`.dark input, .dark select { background: var(--bg-2) }` 这条简写会把
    // background-image 一并重置成 none，暗色下箭头凭空消失——亮色的用例全绿。
    // 判据只看「亮/暗两套都得有箭头」，色值本身由 theme 巡检的变量对应关系把守。
    const arrowOf = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('select')]
          .filter((el) => el.getBoundingClientRect().width)
          .filter((el) => getComputedStyle(el).backgroundImage === 'none')
          .map((el) => `select#${el.id}`)
      );
    expect(await arrowOf(), '亮色下有 select 没有自绘箭头').toEqual([]);
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await arrowOf(), '暗色下有 select 没有自绘箭头（多半是被 background 简写吃掉了）').toEqual([]);
  });

  test('下拉弹层跟主题走（弹层不是浏览器画的白面板）', async ({ appPage: page }) => {
    // 用户原话：「我看一下现在下拉框的配色，都是纯白色的，和主题一点不符合」。
    // 闭合态早就是 var(--card)，纯白只可能来自**弹层**——那张选项列表由浏览器/系统绘制。
    // 判据从页面自身求值：弹层的底色/描边/圆角必须等于当前主题的变量值，
    // 而不是写死 rgb(255,255,255)。
    // 弹层在 top-layer 里，getComputedStyle 读得到颜色但读不到布局
    // （返回 width:fit-content、top:0），故这里只查色与形，不碰尺寸。
    await visitAllTabs(page);

    const pickerOf = () =>
      page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const want = (v) => {
          const probe = document.createElement('span');
          document.body.appendChild(probe);
          probe.style.color = v;
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        };
        const out = [];
        const els = [...document.querySelectorAll('select')].filter((el) => el.getBoundingClientRect().width);
        if (!els.length) return ['没有任何可见 select（判据空跑，等于没检）'];
        for (const el of els) {
          const pk = getComputedStyle(el, '::picker(select)');
          if (pk.appearance !== 'base-select') {
            out.push(`select#${el.id} 的弹层仍是系统绘制（appearance=${pk.appearance}）`);
            continue;
          }
          const bg = pk.backgroundColor;
          const wantBg = want(css.getPropertyValue('--card').trim());
          if (bg !== wantBg) out.push(`select#${el.id} 弹层底色 ${bg} ≠ --card ${wantBg}`);
          const bd = pk.borderTopColor;
          const wantBd = want(css.getPropertyValue('--border').trim());
          if (bd !== wantBd) out.push(`select#${el.id} 弹层描边 ${bd} ≠ --border ${wantBd}`);
          if (pk.borderTopWidth === '0px') out.push(`select#${el.id} 弹层没有描边（会糊在纸面上）`);
          if (parseFloat(pk.borderTopLeftRadius) < 4) out.push(`select#${el.id} 弹层圆角 ${pk.borderTopLeftRadius} 太方`);
          // UA 会画第二枚箭头，页面已用自绘 --chevron——两枚并存就看得出「重复的箭头」
          if (getComputedStyle(el, '::picker-icon').display !== 'none') {
            out.push(`select#${el.id} 多了一枚 UA 箭头（::picker-icon 未隐）`);
          }
        }
        return out;
      });

    const light = await pickerOf();
    expect(light, `亮色下下拉弹层没跟主题：\n  ${light.join('\n  ')}`).toEqual([]);

    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/dark/);
    const dark = await pickerOf();
    expect(dark, `暗色下下拉弹层没跟主题：\n  ${dark.join('\n  ')}`).toEqual([]);
  });

  test('闭合态宽度不随选中项跳动（base-select 的补偿）', async ({ appPage: page }) => {
    // opt-in base-select 之后 select 不再按最长选项取宽，实测同一个下拉换选中项宽度
    // 在 160/186/214 之间跳（原生恒定 231）——表格上方的筛选条会跟着左右抖。
    // field-sizing / min-width:max-content / width:max-content 三种写法实测全无效，
    // 唯一稳的是把固有宽度量一次钉在 --sel-w 上。判据：逐个换选项，宽度必须恒定。
    //
    // **判据必须用长度跨过 min-width 的选项**：`.select-field` 有 min-width:160px，
    // 种子数据里的标签（「微信」「餐饮」）全都短于它，宽度恒为 160px——用它检这条，
    // 把钉宽整段删掉测试也照样绿（实测假绿过）。这里先往存档里塞三个长度相差很大的标签。
    await page.evaluate(() => {
      const tags = ['微信', '通勤交通与打车费报销单据', '水电燃气物业缴费账单追记一笔'];
      state.expenseCategories = [{ id: 'ec-long', name: '长度对照', builtin: false, tags }];
      state.expenses.forEach((e, i) => { e.tags = { 'ec-long': tags[i % tags.length] }; });
      renderAll();
    });
    await visitAllTabs(page);

    const sel = page.locator('#expense-tag-filter');
    const widths = [];
    const n = await sel.locator('option').count();
    expect(n, '消费标签下拉要有多个选项才有得检').toBeGreaterThan(2);
    for (let i = 0; i < n; i++) {
      await sel.selectOption({ index: i });
      widths.push(await sel.evaluate((el) => Math.round(el.getBoundingClientRect().width)));
    }
    expect(new Set(widths).size, `标签下拉换选中项时宽度在跳：${widths.join(' / ')}`).toBe(1);
    // 也不能窄到把当前选项截断（最长的那个选中后也要放得下）
    const clipped = await sel.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, '钉住的宽度把选中项截断了').toBe(false);
    // 且不能只钉在 min-width 上（160px）——那样长标签会被截断，这条用例就白写了
    expect(widths[0], `宽度停在 min-width（${widths[0]}px）：钉宽没生效，长标签会被截断`).toBeGreaterThan(160);
  });

  test('同一行的表单控件等高（select 不得比 input 矮）', async ({ appPage: page }) => {
    // select 的 line-height 是 normal、input 是 21px，同一套 padding 下底边差 1px。
    // 单看各自都「有内边距」，并排才看得出没对齐——故判据是同一行的实测高度。
    await visitAllTabs(page);
    await page.evaluate(() => openAssetModal());
    await expect(page.locator('#asset-modal')).toBeVisible();

    // 只比高度：E2E 里 Tailwind 是空壳，两列网格不生效、控件纵向堆叠，比上边会得到
    // 与缺陷无关的巨大差值（实测 64px）。高度差才是 line-height 那条缺陷的判据。
    const rows = await page.evaluate(() =>
      [['#asset-amount', '#asset-currency']].map(([a, b]) => {
        const ra = document.querySelector(a).getBoundingClientRect();
        const rb = document.querySelector(b).getBoundingClientRect();
        return { a, b, ha: ra.height, hb: rb.height };
      })
    );
    for (const r of rows) {
      expect(Math.abs(r.ha - r.hb), `${r.a}(${r.ha}px) 与 ${r.b}(${r.hb}px) 不等高`).toBeLessThanOrEqual(0.5);
    }
  });

  test('表格：每张表的表头与数据行列宽一致（模板不是各写一遍）', async ({ appPage: page }) => {
    await visitAllTabs(page);
    // 种子数据里没有快照：直接写内存态补齐，再开对比弹窗（弹窗内两张表也要检）
    await page.evaluate(() => {
      const snap = (month, amount) => ({
        month, note: '', totalCNY: 0, currencyRates: { ...state.rates },
        assets: state.assets.map((a) => ({ ...a, amount })),
      });
      state.snapshots = [snap('2026-01', 1000), snap('2026-02', 2000)];
      renderHistoryTab();
    });
    await page.locator('#mode-expenses').click();
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.locator('#expense-trend-list .card').first().click();       // 月度消费明细（cols-expense-month）
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '对比两月' }).click();            // 消费对比（cols-compare）
    await expect(page.locator('#expense-compare-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await gotoAssets(page);
    await page.locator('#tabs-assets .tab-btn[data-tab="history"]').click();
    await page.getByRole('button', { name: '对比快照' }).click();            // 快照对比（cols-compare）
    await expect(page.locator('#compare-modal')).toBeVisible();

    /** 扫当前 DOM 里所有表头，比对它与首条数据行的列宽 */
    const tableChecks = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.list-head')].map((h) => {
          const parent = h.parentElement;
          const row = parent.querySelector('.asset-row:not(.list-head)')
            || (parent.nextElementSibling && parent.nextElementSibling.querySelector('.asset-row:not(.list-head)'));
          const cols = (el) => getComputedStyle(el).gridTemplateColumns;
          return { head: h.textContent.trim().slice(0, 10), same: !!row && cols(h) === cols(row),
            headCols: cols(h), rowCols: row ? cols(row) : '（无数据行）' };
        })
      );
    const checks = await tableChecks();
    await page.keyboard.press('Escape');
    // 两张「构成明细」表只能由图表色块下钻打开（弹窗正文互斥，逐个渲染逐个验）
    await page.evaluate(() => viewHistorySegment('2026-01', 'cat-type', '活期现金'));
    checks.push(...(await tableChecks()));
    await page.evaluate(() => viewExpenseSegment('2026-02', 'ec-type', '餐饮'));
    checks.push(...(await tableChecks()));

    // 六套列宽模板都要被表头实例覆盖到（漏一张表说明用例没覆盖到，不是通过）
    expect(checks.length).toBeGreaterThanOrEqual(7);
    for (const c of checks) {
      expect(c.same, `「${c.head}」表头与数据行列宽不一致：\n  表头 ${c.headCols}\n  数据行 ${c.rowCols}`).toBe(true);
    }
  });

  test('每张表的相邻单元格都留出真实间距（文本不得彼此贴合）', async ({ appPage: page }) => {
    // 回归：列表页的三张表（资产 / 消费 / 收益）当时**完全没有列间距**，而列宽按 fr 分配时
    // 单元格是紧贴的——「看着有空隙」只是因为内容短。实测：`50,000.00CNY`、`¥50,000.000-0%`，
    // 表头连成「金额货币」「金额 (CNY)预期年化」。巡检当时只比对列宽是否相等，量不到这件事。
    await visitAllTabs(page);
    await gotoAssets(page);
    /** 每张表：相邻文本单元格之间的间隙（用 Range 取真实字形边缘，不是盒模型） */
    const gaps = await page.evaluate(() => {
      const out = [];
      for (const head of document.querySelectorAll('.list-head')) {
        if (head.getBoundingClientRect().width === 0) continue;
        const parent = head.parentElement;
        const row = parent.querySelector('.asset-row:not(.list-head)')
          || (parent.nextElementSibling && parent.nextElementSibling.querySelector('.asset-row:not(.list-head)'));
        if (!row) continue;
        const cells = [...row.children].filter((c) => c.textContent.trim());
        for (let i = 1; i < cells.length; i++) {
          const prev = cells[i - 1], cur = cells[i];
          // 单元格自己的盒子可能带 flex 容器，取里面最右侧的文字节点
          const range = document.createRange();
          const textOf = (el) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let last = null, n;
            while ((n = walker.nextNode())) if (n.textContent.trim()) last = n;
            return last;
          };
          const firstText = textOf(cells[i]);
          const prevText = textOf(prev);
          if (!firstText || !prevText) continue;
          range.selectNodeContents(prevText.parentElement);
          const prevRight = Math.max(...[...range.getClientRects()].map((r) => r.right));
          range.selectNodeContents(firstText.parentElement);
          const curLeft = Math.min(...[...range.getClientRects()].map((r) => r.left));
          out.push({ head: head.textContent.trim().slice(0, 8), i, gap: Math.round(curLeft - prevRight) });
        }
      }
      return out;
    });
    expect(gaps.length, '应量到若干张表').toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.gap, `「${g.head}」第 ${g.i} 与上一列的文本间隙只有 ${g.gap}px（贴在一起了）`).toBeGreaterThanOrEqual(10);
    }
  });

  test('收益测算表：六列数字全部右对齐（与其它表同一套账本对齐）', async ({ appPage: page }) => {
    // 收益表原先只有「现金比例」一列挂了 tabular，其余五列既不对齐也不等宽；
    // 而它上面那张汇总卡是居中的——同一页里数字的横向规则各说各话。
    await gotoAssets(page, 'income');
    // 收益表由 renderIncomeTab 按「有设利率的资产」决定是否渲染；种子数据里有，但需显式触发一次
    await page.evaluate(() => renderIncomeTab());
    const cols = await page.evaluate(() => {
      const head = document.querySelector('#income-rows .list-head');
      const row = document.querySelector('#income-rows .asset-row:not(.list-head)');
      const out = [];
      for (let i = 1; i < row.children.length; i++) {
        out.push({
          i,
          head: head.children[i].textContent.trim().slice(0, 6),
          align: getComputedStyle(row.children[i]).textAlign,
          headAlign: getComputedStyle(head.children[i]).textAlign,
          tabular: getComputedStyle(row.children[i]).fontVariantNumeric,
        });
      }
      return out;
    });
    expect(cols.length).toBeGreaterThanOrEqual(6);
    for (const c of cols) {
      expect(c.align, `第 ${c.i} 列「${c.head}」必须右对齐`).toBe('right');
      expect(c.headAlign, `第 ${c.i} 列表头「${c.head}」也要右对齐`).toBe('right');
      expect(c.tabular, `第 ${c.i} 列「${c.head}」必须等宽数字`).toContain('tabular-nums');
    }
  });

  test('分布图与构成清单的间距不得过大（图纸留白 + gap 都要算）', async ({ appPage: page }) => {
    // 用户实测：左边的旭日图和右边的标签「离得也太远了」。
    // 视觉间隙 = 图纸内的留白（ECharts 圆外）+ grid gap。前者由 aspect-ratio 与
    // ECharts 的 radius 决定，这里量的是**真实像素**：清单左缘 − 圆的右缘。
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const gapPx = await page.evaluate(() => {
      const canvas = document.querySelector('#sunburst-chart');
      const legend = document.getElementById('chart-legend');
      if (!canvas || !legend) return null;
      const c = canvas.getBoundingClientRect();
      const l = legend.getBoundingClientRect();
      return Math.round(l.left - c.right);
    });
    expect(gapPx).not.toBeNull();
    expect(gapPx, `图纸右缘到清单左缘的实际间隙 ${gapPx}px 过大`).toBeLessThanOrEqual(72);
  });

  test('图纸与构成清单这一组在卡片里居中（不许只在右边空出一大片）', async ({ appPage: page }) => {
    // 用户实拍：左边一张 520 的图 + 一小列清单，整组靠左，右侧空出 ~300px；
    // 而卡面上方的合计是居中的——两者轴线不重合，卡片看着像没排完。
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const gaps = await page.evaluate(() => {
      const card = document.querySelector('#tab-chart .card');
      const canvas = document.querySelector('#sunburst-chart');
      const legend = document.getElementById('chart-legend');
      const cs = getComputedStyle(card);
      const c = card.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const l = legend.getBoundingClientRect();
      const innerLeft = c.left + parseFloat(cs.paddingLeft);
      const innerRight = c.right - parseFloat(cs.paddingRight);
      return { before: Math.round(cr.left - innerLeft), after: Math.round(innerRight - l.right) };
    });
    expect(
      Math.abs(gaps.before - gaps.after),
      `图纸前留白 ${gaps.before}px vs 清单后留白 ${gaps.after}px：整组没居中`
    ).toBeLessThanOrEqual(24);
  });

  test('构成清单的名称与金额必须贴近（名称格不得被 1fr 撑出大片空白）', async ({ appPage: page }) => {
    // 用户实测：清单列吃满剩余宽度，名称格被 1fr 撑到 454px 而文字只有 45px——
    // 「微信」与「¥42.00」之间隔着 400px 空白，没法一眼把标签名和占比对上。
    // 判据：**名称格宽度不得越过其文字宽度的 2.5 倍**（ellipsis 仍要工作，
    // 所以列不能是 max-content——但空白不得大到把两段信息拆散）。
    // 图纸列同步加大（440 → 520），右列吃满的空间自然变小。
    await gotoAssets(page, 'chart');
    await expect(page.locator('#chart-legend .chart-legend-row').first()).toBeVisible();
    const bad = await page.evaluate(() => {
      const out = [];
      for (const [chartId, legendId] of [['sunburst-chart', 'chart-legend'], ['expense-sunburst-chart', 'expense-chart-legend']]) {
        const rows = document.querySelectorAll(`#${legendId} .chart-legend-row`);
        if (!rows.length) continue;
        for (const row of rows) {
          const name = row.querySelector('.chart-legend-name');
          if (!name) continue;
          const range = document.createRange();
          range.selectNodeContents(name);
          const textW = range.getBoundingClientRect().width;
          const cellW = name.getBoundingClientRect().width;
          if (textW > 8 && cellW > textW * 2.5) {
            out.push(`#${legendId}「${name.textContent.trim().slice(0, 8)}」格宽 ${Math.round(cellW)}px 文字 ${Math.round(textW)}px`);
          }
        }
      }
      return out;
    });
    expect(bad, '名称格与文字之间的大片空白会把「名称—金额—占比」拆散：\n' + bad.join('\n')).toEqual([]);
  });

  test('所有表格：数值列一律右对齐，表头同步（含弹窗里的表）', async ({ appPage: page }) => {
    // 用户实测两轮才说清：「消费记录」页的表格有的列左对齐、有的右对齐。
    // 上一版巡检只扫了主列表（#assets-list / #income-rows），**把所有弹窗里的表都漏了**
    // ——「月度消费明细」「快照详情」「构成明细」这些表的金额格根本没挂 num，
    // 左边缘对齐、右边缘参差。故判据改为**遍历页面上所有 .asset-row 表**（含弹窗），
    // 不写死选择器清单——以后新增的表自动被覆盖。
    const scan = () => page.evaluate(() => {
      const out = [];
      const tables = new Set();
      for (const row of document.querySelectorAll('.asset-row')) {
        const t = row.parentElement;
        if (t) tables.add(t);
      }
      for (const table of tables) {
        const head = table.querySelector('.list-head');
        const rows = [...table.querySelectorAll('.asset-row')].filter((r) => !r.classList.contains('list-head'));
        if (!head || !rows.length) continue;
        for (let i = 0; i < rows[0].children.length; i++) {
          const cell = rows[0].children[i];
          const text = (cell.textContent || '').trim();
          if (!text) continue;
          // 「像数值」：以数字（或货币符号+数字）开头，且数字占绝对主体。
          // 不能写成「整格不含中文」——`0-0% · 现金 100%` 含「现金」二字会被漏掉；
          // 也不能只看「含数字」——备注里的「买 2 件」会被误判成数值列。
          // 日期不是「数值」：`2026-02-03` 以数字开头、数字占比也高，但它是最长且定长的
          // 标识文本，左对齐才对（右对齐的日期列看起来像被推出去）。故先排除日期形状。
          if (/^\d{4}-\d{2}-\d{2}$/.test(text)) continue;
          const stripped = text.replace(/[\s,]/g, '');
          const digits = (stripped.match(/\d/g) || []).length;
          const numeric = /^[¥$]?\s*-?\d/.test(text) && digits / Math.max(stripped.length, 1) >= 0.25;
          if (!numeric) continue;
          const hc = head.children[i];
          out.push({
            table: (table.id || table.className).slice(0, 24),
            col: i,
            head: hc ? hc.textContent.replace(/[▲▼]/g, '').trim().slice(0, 8) : '',
            text: text.slice(0, 22),
            align: getComputedStyle(cell).textAlign,
            headAlign: hc ? getComputedStyle(hc).textAlign : null,
          });
        }
      }
      return out;
    });

    const problems = [];
    const collect = async (rows) => {
      for (const c of rows) {
        if (c.align !== 'right') problems.push(`${c.table} 第${c.col}列「${c.head}」数据「${c.text}」是 ${c.align}`);
        if (c.headAlign !== 'right') problems.push(`${c.table} 第${c.col}列「${c.head}」表头是 ${c.headAlign}`);
      }
    };

    // 1) 主列表：资产 / 收益 / 消费
    await gotoAssets(page, 'assets');
    await collect(await scan());
    await gotoAssets(page, 'income');
    await page.evaluate(() => renderIncomeTab());
    await collect(await scan());
    await page.locator('#mode-expenses').click();
    // 模式切换是同步的：用可见性断言到位（原先 sleep 300ms 是盲等）
    await expect(page.locator('#tab-expenses')).toBeVisible();
    await collect(await scan());

    // 2) 弹窗里的表：月度消费明细 / 消费构成 / 快照详情 / 快照对比 / 消费两月对比。
    //    上一版只点了「月度消费明细」这一张，另外四张（金额列全没挂 num）从未被扫到——
    //    「遍历所有 .asset-row 表」的判据是对的，但没人把它们打开，绿灯是空的。
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    // 趋势清单由 switchTab 的延时重绘填充：等首行出现再点（click 自带自动等待，这里把意图写明）
    await expect(page.locator('#expense-trend-list .row-hit').first()).toBeVisible();
    await page.locator('#expense-trend-list .row-hit').first().click();
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    await collect(await scan());
    await page.keyboard.press('Escape');
    await expect(page.locator('#snapshot-modal')).toBeHidden();

    await page.evaluate(() => viewExpenseSegment('2026-02', 'ec-type', '餐饮'));
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    await collect(await scan());
    await page.keyboard.press('Escape');

    await page.evaluate(() => openExpenseCompareModal());
    await expect(page.locator('#expense-compare-modal')).toBeVisible();
    await collect(await scan());
    await page.keyboard.press('Escape');

    // 快照详情与快照对比需要两个月的快照（对比按钮在只有一个月时只弹便条）
    await gotoAssets(page, 'history');
    await page.evaluate(() => {
      state.snapshots = ['2026-01', '2026-02'].map((month, i) => ({
        month, note: '', totalCNY: 0, currencyRates: { ...state.rates },
        assets: state.assets.map((a) => ({ ...a, amount: a.amount * (i + 1) })),
        updatedAt: '2026-02-01T00:00:00.000Z',
      }));
      renderHistoryTab();
    });
    await page.evaluate(() => viewSnapshot('2026-02'));
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    await collect(await scan());
    await page.keyboard.press('Escape');

    await page.evaluate(() => openCompareModal());
    await expect(page.locator('#compare-modal')).toBeVisible();
    await collect(await scan());
    await page.keyboard.press('Escape');

    expect(problems, '表格里的数字必须右对齐（眼睛顺着右边缘扫，左对齐的柱子会打断这条线）：\n' + problems.join('\n')).toEqual([]);
  });

  test('列表行：标签列不得折行（折行会让整行高度跳变、左右两侧错开半行）', async ({ appPage: page }) => {
    // 回归：给宽表加列间距后，标签列被挤窄、两枚 pill 换行，整行高度从 19px 跳到 52px；
    // 紧跟着的下一行只有 19px，「编辑/删除」与「名称」就错开了半行。
    // 判据取「标签列高度 ≤ 一行 pill 的高度」：它比「所有行等高」稳（E2E 里 Tailwind 是空壳，
    // 行内边距本就不一致），又正好指向这次要守的那件事。
    await gotoAssets(page);
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#assets-rows .asset-row')];
      return rows.map((row) => {
        const cell = row.children[6];
        const pills = [...cell.children];
        const oneLine = pills.length ? Math.round(Math.max(...pills.map((p) => p.getBoundingClientRect().height))) : 0;
        return { cellH: Math.round(cell.getBoundingClientRect().height), oneLine, pills: pills.length };
      });
    });
    expect(m.length).toBeGreaterThan(1);
    for (const [i, r] of m.entries()) {
      expect(r.cellH, `第 ${i + 1} 行标签列高 ${r.cellH}px，超过单行 pill 的 ${r.oneLine}px（折行了）`)
        .toBeLessThanOrEqual(r.oneLine + 2);
    }
  });

  test('弹窗里的构成明细表：相邻单元格之间留出列间距（日期不贴金额）', async ({ appPage: page }) => {
    await visitAllTabs(page);
    // 资产侧金额拉长（×100）才能复现「金额与货币码贴在一起」——列宽按 fr 分配，
    // 内容一长就没有留白，这正是回归的场景
    await page.evaluate(() => {
      state.snapshots = [{
        month: '2026-01', note: '', totalCNY: 0, currencyRates: { ...state.rates },
        assets: state.assets.map((a) => ({ ...a, amount: a.amount * 100 })),
      }];
    });
    /** 相邻单元格的**文本**间距：量的不是格子边界，而是肉眼看到的两个内容的间隙 */
    const textGaps = () =>
      page.evaluate(() => {
        const range = document.createRange();
        const rect = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect(); };
        return [...document.querySelectorAll('#snapshot-detail-content .asset-row:not(.list-head)')].map((row) => {
          const rects = [...row.children].map(rect);
          return rects.slice(1).map((r, i) => r.left - rects[i].right);
        });
      });

    await page.locator('#mode-expenses').click();
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.evaluate(() => viewExpenseSegment('2026-02', 'ec-type', '餐饮'));
    const segment = await textGaps();
    await page.keyboard.press('Escape');
    await page.evaluate(() => viewExpenseMonth('2026-02'));
    const month = await textGaps();
    await page.keyboard.press('Escape');
    await gotoAssets(page);
    await page.evaluate(() => viewHistorySegment('2026-01', 'cat-type', '活期现金'));
    const history = await textGaps();
    await page.keyboard.press('Escape');
    // 快照详情曾是唯一没挂列宽模板的弹窗表：每列按内容自适应，金额与货币码贴在一起
    await page.evaluate(() => viewSnapshot('2026-01'));
    const snapshot = await textGaps();

    for (const [name, rows] of [['消费构成明细', segment], ['月度消费明细', month], ['资产构成明细', history], ['快照详情', snapshot]]) {
      expect(rows.length, `${name}：没有数据行，用例并未覆盖到`).toBeGreaterThan(0);
      for (const row of rows) {
        for (const gap of row) {
          expect(gap, `${name}：相邻单元格贴在一起（只剩 ${gap.toFixed(1)}px）`).toBeGreaterThanOrEqual(15);
        }
      }
    }
    // 日期栏定宽：日期串与列宽同量级，间距必须明显大于列间距本身，否则仍是「读成一串」
    for (const [name, rows] of [['消费构成明细', segment], ['月度消费明细', month]]) {
      for (const row of rows) {
        expect(row[0], `${name}：日期紧贴金额（只剩 ${row[0].toFixed(1)}px）`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  test('按钮档位：同一档位内 padding/字号一致；主按钮不再各自内联', async ({ appPage: page }) => {
    await visitAllTabs(page);
    await once(await uniqStyles(page, '.btn-sm', ['padding', 'fontSize']));
    await once(await uniqStyles(page, '.btn-xs', ['padding', 'fontSize']));
  });

  test('弹窗页脚与字段标签：同类弹窗结构一致', async ({ appPage: page }) => {
    // 打开一个普通弹窗（预期消费）与一个两端对齐弹窗（设置），各自成组比较
    await page.locator('#mode-expenses').click();
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.locator('#expense-expectation-btn').click();
    await expect(page.locator('#expectation-modal')).toBeVisible();
    const plain = await uniqStyles(page, '.modal-footer:not(.between)', ['display', 'justifyContent', 'gap', 'marginTop']);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    const between = await uniqStyles(page, '.modal-footer.between', ['display', 'justifyContent', 'gap', 'marginTop']);
    await page.keyboard.press('Escape');

    await once(plain);
    await once(between);
    // 两端对齐只改横向分布，垂直节奏（gap/margin-top）必须与普通页脚同源
    expect(between[0].split('|').slice(2).join('|')).toBe(plain[0].split('|').slice(2).join('|'));
  });

  test('弹窗正文（表单）字段标签一致：字号/字重/颜色/块级', async ({ appPage: page }) => {
    await gotoAssets(page);
    await page.locator('#tabs-assets .tab-btn[data-tab="assets"]').click();
    await page.locator('#tab-assets button:has-text("登记资产")').click();
    await expect(page.locator('#asset-modal')).toBeVisible();
    // 两种排法各自成组：普通字段（标签独一行）与 .tight（标签与右侧读数同排、下间距由父行承担）
    await once(await uniqStyles(page, '#asset-modal .field-label:not(.tight)', ['display', 'fontSize', 'fontWeight', 'color', 'marginBottom']));
    await once(await uniqStyles(page, '#asset-modal .field-label.tight', ['display', 'fontSize', 'fontWeight', 'color', 'marginBottom']));
    // 两种排法除了下间距外必须完全同源
    const plain = await uniqStyles(page, '#asset-modal .field-label:not(.tight)', ['display', 'fontSize', 'fontWeight', 'color']);
    const tight = await uniqStyles(page, '#asset-modal .field-label.tight', ['display', 'fontSize', 'fontWeight', 'color']);
    expect(tight[0]).toBe(plain[0]);
  });
});

/*
 * 可读性巡检：文字对比度达 AA。
 * --------------------------------------------------------------------------
 * 用户抱怨「有点看不清」不能只靠人眼——这里把每个可见文字的实际前景/背景算出来比对。
 * 背景取「最近的非透明祖先背景色」并逐层叠加（元素自身可能半透明，祖先也可能）；
 * 渐变底（.btn-gold / .seg-btn.active）无法还原真实背景色，跳过。
 *
 * 跳过是有代价的：页头曾用**内联** linear-gradient 做背景，于是页头里每一个元素
 * （标题、设置、模式按钮）都被判定为「在渐变上」而默默豁免——最显眼的几行字反而不在
 * 巡检范围内。故页头背景收回 CSS 变量类（.app-header），不再用渐变。
 * 巡检自查：若某次改动让被跳过的元素骤增，下面的「未覆盖到的元素数」会报出来。
 * KNOWN_DIMMED 是「有意淡出」的白名单：未设利率的收益行、日期选择器里的非本月日期——
 * 它们是状态提示而非待读内容，与主题巡检的 KNOWN_HARDCODED 同性质，只减不增。
 */
/*
 * 表单字段的可访问名巡检。
 * --------------------------------------------------------------------------
 * 缺陷：全站 18 处 `<label class="field-label">资产名称</label>` 与它的
 * `<input id="asset-name">` 只是**视觉相邻**——label 既没有 `for` 也不包裹 input，
 * 程序上毫无关联。真实浏览器实测可访问名：
 *
 *     asset-name     => textbox "如：招商银行活期"   ← 念的是 **placeholder**！
 *     asset-rate-min => spinbutton "最低"           ← 念的是 placeholder
 *     asset-currency => combobox（**没有名字**）
 *
 * 即读屏器念出的是「如：招商银行活期，编辑框」而不是「资产名称，编辑框」——用户
 * 听不到这个框是干什么的。且 placeholder 是**示例**（“如：…”），当作名字念更糟。
 *
 * 判据从页面自身求值（不写死字段清单）：凡可见的 input/select/textarea，
 * 其可访问名不得为空，也不得恰好等于 placeholder（那就等于用示例当名字）。
 */
test.describe('可访问性：表单字段必须有真正的名字（不是 placeholder）', () => {
  const opens = [
    ['资产弹窗', (page) => page.evaluate(() => openAssetModal()), '#asset-modal'],
    ['分类弹窗', (page) => page.evaluate(() => openCategoryModal('asset')), '#category-modal'],
    ['消费弹窗', (page) => page.evaluate(() => openExpenseModal()), '#expense-modal'],
    ['消费分类弹窗', (page) => page.evaluate(() => openCategoryModal('expense')), '#expense-category-modal'],
    ['读指标签弹窗', (page) => page.evaluate(() => openRunwayModal()), '#runway-modal'],
  ];

  test('每个可见表单控件都有可访问名，且不得拿 placeholder 当名字', async ({ appPage: page }) => {
    await gotoAssets(page, 'assets');
    const bad = [];
    for (const [label, open, modalSel] of opens) {
      await open(page);
      await expect(page.locator(modalSel)).toBeVisible(); // 开弹窗是同步的：可见性断言到位（不 sleep）
      const found = await page.evaluate(() => {
        const out = [];
        const visibles = [...document.querySelectorAll('.modal-overlay')]
          .filter((m) => m.style.display !== 'none');
        for (const modal of visibles) {
          for (const el of modal.querySelectorAll('input, select, textarea')) {
            if (el.type === 'hidden' || el.offsetParent === null) continue;
            // 可访问名：关联 label / aria-label / aria-labelledby
            let name = '';
            if (el.getAttribute('aria-label')) name = el.getAttribute('aria-label');
            else if (el.getAttribute('aria-labelledby')) {
              const l = document.getElementById(el.getAttribute('aria-labelledby'));
              name = l ? l.textContent.trim() : '';
            } else if (el.labels && el.labels.length) {
              name = [...el.labels].map((l) => l.textContent.trim()).join(' ').trim();
            }
            out.push({
              id: el.id || el.name || el.tagName,
              name,
              ph: el.getAttribute('placeholder') || '',
              // 关联 label 的**文本**：名字来自真 label 时，哪怕与 placeholder 同字也是正当的
              // （runway-expectation 的 label 就叫「月消费 (CNY)」，placeholder 也是它）。
              // 只有「名字不是从 label 来、而恰好等于 placeholder」才是「拿示例当名字」。
              fromLabel: !!(el.labels && el.labels.length) || !!el.getAttribute('aria-labelledby'),
            });
          }
        }
        return out;
      });
      for (const f of found) {
        if (!f.name) bad.push(`${label} · #${f.id}: 完全没有可访问名`);
        else if (f.ph && f.name === f.ph && !f.fromLabel) bad.push(`${label} · #${f.id}: 名字就是 placeholder「${f.ph}」`);
      }
      await page.keyboard.press('Escape');
      await expect(page.locator(modalSel)).toBeHidden();
    }
    expect(bad, '字段的可访问名必须说明这个框是干什么的：\n' + bad.join('\n')).toEqual([]);
  });
});

test.describe('可访问性：每个弹窗都要有名字（role=dialog 的另一半承诺）', () => {
  test('全站 dialog 的可访问名来自可见标题（aria-labelledby → 真标题元素）', async ({ appPage: page }) => {
    // role="dialog" + aria-modal 只说了「这是一层模态」，没说「这是哪一层」。
    // 15 个弹窗原先一个 aria-labelledby 都没有：读屏器打开后只念「对话框」，
    // 用户无从知道自己在「设置」还是「删除确认」。判据从页面自身求值，不写死弹窗清单。
    await gotoAssets(page, 'assets');
    const dialogs = await page.evaluate(() =>
      [...document.querySelectorAll('.modal-overlay[role="dialog"]')].map((d) => ({
        id: d.id,
        labelledby: d.getAttribute('aria-labelledby') || '',
        label: d.getAttribute('aria-label') || '',
      })));
    expect(dialogs.length).toBeGreaterThan(10);
    const bad = [];
    for (const d of dialogs) {
      if (d.labelledby) {
        const ok = await page.evaluate((id) => {
          const dlg = document.getElementById(id);
          const t = document.getElementById(dlg.getAttribute('aria-labelledby'));
          return !!t && t.closest('.modal-overlay') === dlg && (t.textContent || '').trim().length > 0;
        }, d.id);
        if (!ok) bad.push(`#${d.id}: aria-labelledby 指向的元素不存在、不在本弹窗内或没有文字`);
      } else if (!d.label) {
        bad.push(`#${d.id}: 既无 aria-labelledby 也无 aria-label`);
      }
    }
    expect(bad, '弹窗必须有可访问名（否则读屏器只说「对话框」）：' + bad.join(' / ')).toEqual([]);

    // 真的到达读屏器：打开设置弹窗，AX 树里的名字要是「设置」
    await page.getByRole('button', { name: '设置' }).click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    expect(await page.locator('#settings-modal').ariaSnapshot()).toContain('dialog "设置"');
    await page.keyboard.press('Escape');
  });
});

test.describe('可读性：文字对比度达 AA（亮/暗两套）', () => {
  const KNOWN_DIMMED = '.asset-row.is-unrated, .flatpickr-day.prevMonthDay, .flatpickr-day.nextMonthDay';

  const scan = (page, dimmed) =>
    page.evaluate((dimmedSel) => {
      const parse = (c) => {
        const m = (c || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const lum = (c) => {
        const s = hex(c).slice(1);
        const v = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
          .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const hasGradient = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const bi = getComputedStyle(n).backgroundImage;
          if (bi && bi !== 'none') return true;
        }
        return false;
      };
      // 渐变底上无法还原真实背景色（无法取到渐变上的实际取色点），只能跳过；
      // 但「跳过了多少」必须可见，否则整块区域会静默地离开巡检范围
      let skipped = 0;
      const bgOf = (el) => {
        let acc = null;
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (!c || c.a === 0) continue;
          acc = acc ? over(acc, c) : c;
          if (acc.a >= 0.999) return acc;
        }
        return acc || { r: 255, g: 255, b: 255, a: 1 };
      };
      const opOf = (el) => { let op = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= +getComputedStyle(n).opacity; return op; };

      const bad = [];
      document.querySelectorAll('*').forEach((el) => {
        const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();
        if (!text) return;
        if (el.closest(dimmedSel) || el.closest('[aria-hidden="true"]')) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const fg = parse(cs.color);
        if (!fg) return;
        if (hasGradient(el)) { skipped++; return; }
        const bg = bgOf(el);
        const eff = over({ ...fg, a: fg.a * opOf(el) }, bg);
        const fs = parseFloat(cs.fontSize);
        const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
        const need = large ? 3 : 4.5;
        const got = ratio(eff, bg);
        if (got < need) {
          bad.push(`${got.toFixed(2)}<${need} ${fs}px w${cs.fontWeight} ${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')} ${hex(fg)}@${opOf(el).toFixed(2)} on ${hex(bg)} 「${text.slice(0, 12)}」`);
        }
      });
      return { bad, skipped };
    }, dimmed);

  test('亮色与暗色下都无低对比文字', async ({ appPage: page }) => {
    await visitAllTabs(page);
    const light = await scan(page, KNOWN_DIMMED);
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('#theme-seg-dark').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveClass(/dark/);
    const dark = await scan(page, KNOWN_DIMMED);
    expect(light.bad, `亮色下这些文字对比度不足 AA：\n  ${light.bad.join('\n  ')}`).toEqual([]);
    expect(dark.bad, `暗色下这些文字对比度不足 AA：\n  ${dark.bad.join('\n  ')}`).toEqual([]);
  });

  test('渐变底豁免不得吞掉整块区域（页头曾在巡检范围外）', async ({ appPage: page }) => {
    await visitAllTabs(page);
    const { skipped } = await scan(page, KNOWN_DIMMED);
    // 实测：页头收回 CSS 后，全站只剩 .btn-gold 与 .seg-btn.active 两块渐变底，
    // 且它们各自只包着一个文字元素（按钮自身的文字）。
    // 若哪天又有一整块区域被渐变包住（页头曾如此），数字会立刻蹿上去。
    expect(skipped, '被渐变底豁免的文字元素过多，是否又有一整块区域退出了巡检？').toBeLessThanOrEqual(3);
  });
});

/*
 * 档位一致性：文字只两档字号 + 三档字重，同档元素在真实浏览器里算出来必须一模一样。
 * 漏挂档位类（或挂了又被别的规则覆盖）会在这里现形——单测只能看 HTML 文本。
 */
test.describe('版式一致性：排版档位在真实浏览器里唯一', () => {
  test('同档元素字号/字重唯一', async ({ appPage: page }) => {
    await visitAllTabs(page);
    await once(await uniqStyles(page, '.t-body', ['fontSize']));
    await once(await uniqStyles(page, '.t-micro', ['fontSize']));
    await once(await uniqStyles(page, '.t-medium', ['fontWeight']));
    await once(await uniqStyles(page, '.t-bold', ['fontWeight']));
    // 行内强调（strong/b）只在弹窗正文里出现：补两条快照把「构成明细」弹窗召出来，
    // 否则空数据下这个选择器匹配 0 个元素，once() 会因为空集合而误报
    await page.evaluate(() => {
      const snap = (month) => ({
        month, note: '', totalCNY: 0, currencyRates: { ...state.rates },
        assets: state.assets.map((a) => ({ ...a })),
      });
      state.snapshots = [snap('2026-01'), snap('2026-02')];
      renderHistoryTab();
      viewHistorySegment('2026-01', state.categories[1].id, state.categories[1].tags[0]);
    });
    await expect(page.locator('#snapshot-modal')).toBeVisible();
    // strong 与 b 是同一条规则的两个选择器，验证 strong 即验证该声明（b 只在校验面板出现）
    await once(await uniqStyles(page, 'strong', ['fontWeight']));
  });
});

/*
 * 平铺 chip 的「未选中态」跨分类一致。
 * --------------------------------------------------------------------------
 * 用户实测反馈：编辑消费弹窗里选标签时，第三个分类的 chip「特别浅」。根因不是对比度不达标
 * （实测都 ≥4.5:1），而是未选中态套了分类的饱和字色：同一支 picker 里棕/绿/黄绿三种字色
 * 并存，而暖色卡面上黄色系的亮度最低，肉眼就是「发白」。CSS 注释本意是「虚线空栏 = 待选，
 * 实心盖印 = 已选」——分类色只该出现在承载「已选」语义的那个状态上。
 */
/*
 * 分布图总数：切右上角筛选后，卡片上方要显示「当前这一筛」的合计。
 * 用户原话：「现在我可以看到经过右上角筛选后的各个部分，但是没有一个总数」。
 * 关键口径：随筛选联动（不能是全局值），且与旭日图扇区同源。
 */
test.describe('分布图总数：随筛选联动且与扇区同源', () => {
  test('资产分布：总数与 tooltip 分毋同口径（百分比能对得上）', async ({ appPage: page }) => {
    await gotoAssetsTab(page, 'chart');
    await expect(page.locator('#chart-total')).toBeVisible();

    // sampleState 三笔资产：CNY 50,000 + 80,000；HKD 50,000 → 50,000 / 0.92 = 54,347.83
    const ALL = '¥184,347.83';
    await page.selectOption('#chart-category-select', 'cat-type');
    await expect(page.locator('#chart-total')).toHaveText(ALL);
    // 与报头净资产同口径（该维度只含已归类资产时两者相等）
    await expect(page.locator('#masthead-whole')).toHaveText('184,347');

    // 未归类的资产：仍计入总数（否则扇区百分比之和对不上显示的合计 —— 单测曾因此漏过
    // 一版口径分裂），也计入净资产，于是两个数仍相等
    await page.evaluate(() => {
      state.assets.push({ id: 'a-x', name: '未归类', amount: 9999, currency: 'CNY', tags: {}, expectedRateMin: 0, expectedRateMax: 0, cashRatio: 100 });
      renderChart();
      renderMasthead(totalAssetsCNY());
    });
    await expect(page.locator('#chart-total'), '未归类资产也计入总数（与分毋同源）').toHaveText('¥194,346.83');
    await expect(page.locator('#masthead-whole')).toHaveText('194,346');
  });

  test('消费分布：切月份时总数跟着变，切维度不变', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-chart"]').click();
    await expect(page.locator('#expense-chart-total')).toBeVisible();

    // 月份下拉默认取最近月份（与消费列表页的「全部时间」不同，是既有行为）
    await expect(page.locator('#expense-chart-total')).toHaveText('¥42.00');

    // 全部时间：88.5 + 3200 + 42 = 3,330.50
    await page.selectOption('#expense-chart-month-select', '');
    await expect(page.locator('#expense-chart-total')).toHaveText('¥3,330.50');

    // 切到 2026-01：88.5 + 3200 = 3,288.50
    await page.selectOption('#expense-chart-month-select', '2026-01');
    await expect(page.locator('#expense-chart-total')).toHaveText('¥3,288.50');

    // 同月份切维度（消费类型）：维度只改分组方式，不改总数
    await page.selectOption('#expense-chart-category-select', 'ec-type');
    await expect(page.locator('#expense-chart-total')).toHaveText('¥3,288.50');
  });

  test('空态时不显示总数（避免留一个孤零数字）', async ({ page }) => {
    const s = sampleState();
    s.categories.push({ id: 'cat-empty', name: '空维度', builtin: false, tags: ['甲', '乙'] });
    await openWith(page, s);
    await gotoAssetsTab(page, 'chart');
    await page.selectOption('#chart-category-select', 'cat-empty');
    await expect(page.locator('#chart-empty')).toBeVisible();
    await expect(page.locator('#chart-total')).toBeHidden();
  });
});

test.describe('可读性：平铺 chip 未选中态跨分类一致', () => {
  test('所有未选中 chip 的字色/描边完全相同（含浅色系分类），且不随分类变', async ({ appPage: page }) => {
    // 三个分类分别取到调色板的 0/1/2 号基色：terracotta(棕) / sage green(绿) / amber honey(黄)
    // 黄系正是用户反馈「特别浅」的那一档
    await page.evaluate(() => {
      state.expenseCategories = [
        { id: 'ec1', name: '甲类', builtin: false, tags: ['甲一', '甲二'] },
        { id: 'ec2', name: '乙类', builtin: false, tags: ['乙一', '乙二'] },
        { id: 'ec3', name: '丙类', builtin: false, tags: ['丙一', '丙二'] },
      ];
      state.expenses = [{ id: 'e1', date: '2026-01-05', amount: 100, note: '午餐', tags: { ec1: '甲一', ec2: '乙一', ec3: '丙一' } }];
      renderExpenses();
      editExpense('e1');
    });
    await expect(page.locator('#expense-modal')).toBeVisible();

    const styles = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector('#expense-modal .modal-content')).backgroundColor;
      const read = (el) => {
        const cs = getComputedStyle(el);
        return `${cs.color}|${cs.backgroundColor}|${cs.borderTopColor}|${cs.borderTopStyle}`;
      };
      return [...document.querySelectorAll('#expense-tags-section .tag-choice[aria-pressed="false"]')]
        .map((el) => ({ text: el.textContent.trim(), style: read(el), card }));
    });

    expect(styles.length, '每个分类都应留下未选中 chip').toBeGreaterThanOrEqual(3);
    // 未选中态必须长得一模一样：字色/底色/描边三件套全部相同（底色即弹窗卡面）
    const uniq = [...new Set(styles.map((s) => s.style))];
    expect(uniq, `未选中 chip 样式不一致：\n  ${uniq.join('\n  ')}`).toHaveLength(1);
    // 且不得带分类色：字色不能是某个分类的饱和色（这里用 muted 兜底，与页面其它次要文字同源）
    expect(uniq[0]).toMatch(/^rgb\(/);
  });

  test('已选中 chip 才用分类色（实心盖印，选中态才有底色）', async ({ appPage: page }) => {
    await page.evaluate(() => {
      state.expenseCategories = [
        { id: 'ec1', name: '甲类', builtin: false, tags: ['甲一', '甲二'] },
        { id: 'ec2', name: '乙类', builtin: false, tags: ['乙一', '乙二'] },
      ];
      state.expenses = [{ id: 'e1', date: '2026-01-05', amount: 100, note: '午餐', tags: { ec1: '甲一', ec2: '乙一' } }];
      renderExpenses();
      editExpense('e1');
    });
    await expect(page.locator('#expense-modal')).toBeVisible();
    const selected = await page.evaluate(() =>
      [...document.querySelectorAll('#expense-tags-section .tag-choice[aria-pressed="true"]')].map((el) => {
        const cs = getComputedStyle(el);
        return { text: el.textContent.trim(), bg: cs.backgroundColor, style: cs.borderTopStyle };
      })
    );
    expect(selected.length).toBeGreaterThanOrEqual(2);
    for (const s of selected) {
      // 选中态有实心底色（盖印）与实线描边，与未选态的「虚线空栏」区分
      expect(s.bg, `「${s.text}」选中态应有分类底色`).not.toBe('rgba(0, 0, 0, 0)');
      expect(s.style, `「${s.text}」选中态应为实线`).toBe('solid');
    }
    // 两个分类的选中底色不同（分类色确实生效）
    expect(new Set(selected.map((s) => s.bg)).size).toBe(selected.length);
  });

  test('悬停已选中 chip 不抹掉分类色（只在已选态给反馈）', async ({ appPage: page }) => {
    await page.evaluate(() => {
      state.expenseCategories = [
        { id: 'ec1', name: '甲类', builtin: false, tags: ['甲一', '甲二'] },
        { id: 'ec2', name: '乙类', builtin: false, tags: ['乙一', '乙二'] },
      ];
      state.expenses = [{ id: 'e1', date: '2026-01-05', amount: 100, note: '午餐', tags: { ec1: '甲一', ec2: '乙一' } }];
      renderExpenses();
      editExpense('e1');
    });
    await expect(page.locator('#expense-modal')).toBeVisible();
    const read = () =>
      page.evaluate(() => {
        const el = document.querySelector('#expense-tags-section .tag-choice[aria-pressed="true"]');
        const cs = getComputedStyle(el);
        return `${cs.color}|${cs.backgroundColor}|${cs.borderTopColor}`;
      });
    const before = await read();
    await page.hover('#expense-tags-section .tag-choice[aria-pressed="true"]');
    await expect.poll(read).toBe(before);
  });

  test('已选 chip 的「盖印」边必须明显强于未选空栏（用户实测：选中了却看不出来）', async ({ appPage: page }) => {
    // 把三个分类都摆出来（调色板 0/1/2 号基色：棕/绿/黄），黄系正是最看不清的那档
    await page.evaluate(() => {
      state.expenseCategories = [
        { id: 'ec1', name: '甲类', builtin: false, tags: ['甲一', '甲二'] },
        { id: 'ec2', name: '乙类', builtin: false, tags: ['乙一', '乙二'] },
        { id: 'ec3', name: '丙类', builtin: false, tags: ['丙一', '丙二'] },
      ];
      state.expenses = [{ id: 'e1', date: '2026-01-05', amount: 100, note: '午餐', tags: { ec1: '甲一', ec2: '乙一', ec3: '丙一' } }];
      renderExpenses();
      editExpense('e1');
    });
    await expect(page.locator('#expense-modal')).toBeVisible();

    const rows = await page.evaluate(() => {
      const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const parse = (c) => { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2] }; };
      const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const card = parse(getComputedStyle(document.querySelector('#expense-modal .modal-content')).backgroundColor);
      return [...document.querySelectorAll('#expense-tags-section .tag-choice')].map((el) => {
        const cs = getComputedStyle(el);
        return {
          pressed: el.getAttribute('aria-pressed') === 'true',
          text: el.textContent.trim(),
          border: cs.borderTopStyle === 'dashed' ? parse(cs.borderTopColor) : null,
          // 非图形文字的对比度下限（WCAG 1.4.11）
          edge: ratio(parse(cs.borderTopColor), card),
        };
      });
    });

    const sel = rows.filter((r) => r.pressed);
    const unsel = rows.filter((r) => !r.pressed);
    expect(sel.length, '每个分类各有一个已选项').toBe(3);
    expect(unsel.length, '每个分类各有一个未选项').toBe(3);
    for (const s of sel) {
      // 已选态的边（盖印）必须强于任何未选空栏的边，且自身不低于非文字对比度下限 3:1
      const worstUnsel = Math.max(...unsel.map((u) => u.edge));
      expect(s.edge, `「${s.text}」已选边 ${s.edge.toFixed(2)} 必须强于未选空栏的 ${worstUnsel.toFixed(2)}`).toBeGreaterThan(worstUnsel);
      expect(s.edge, `「${s.text}」已选边仅 ${s.edge.toFixed(2)}:1，低于非文字元素 3:1 下限`).toBeGreaterThanOrEqual(3);
    }
  });
});

/*
 * 数字列的对齐：记账的习惯是**右对齐、小数点对齐**。
 * --------------------------------------------------------------------------
 * 用户看到的是「表格中间一大片空、右边挤成一团」——量下来是备注列 336px 装 28px 文本
 * （冗余 12 倍）、金额列只有 168px。但只改列宽不够：**所有数字列都左对齐**，
 * 于是 42.00 与 3,200.00 的小数点错开，读数时要一位一位数——这是账本里最费眼的一件事，
 * 与列宽无关。故这里守两件事：列宽按内容量给（不定长的两栏拿弹性），
 * 且金额这一列必须右对齐 + 等宽数字（tabular-nums）。
 *
 * **表头也必须在同一个数上对齐**：只改数据行的话，表头「金额」还留在左边，
 * 上下两行字各指一个方向，比全左对齐更难看（这次改完就出现了，故把两者绑在一起断言）。
 */
/*
 * 悬停气泡不得被盖住 / 被裁掉。
 * --------------------------------------------------------------------------
 * 用户实测：收益测算里「缺口」旁的 ? hover 后，气泡下半部分被下面那张表格卡片盖住。
 * 根因是卡片自身有 backdrop-filter → 自成层叠上下文，气泡的 z-index 只在卡片内有效。
 * 判据只能用**命中测试**（elementFromPoint）：这是唯一能回答「这块像素上到底是谁」的办法，
 * 计算样式与 z-index 都看不出层叠上下文的边界。
 */
test.describe('可读性：悬停气泡必须完整可见', () => {
  /**
   * 悬停 ? 图标。为什么要整段重试：switchTab 会给收益 Tab 排一个 100ms 的延迟重绘
   * （见 index.html switchTab），它把整块 innerHTML 换掉——悬停正好落在这个窗口里
   * 就「元素已脱离 DOM」（重复跑实测 12 次挂 4 次，CI 上必挂）。
   * 用 toPass 重试而不是 sleep 猜时机：睡短了仍会撞上，睡长了全套变慢
   * （E2E 禁止 waitForTimeout 的理由同此）。
   */
  const hoverMark = async (page, sel) => {
    await expect(async () => {
      await page.locator(sel).first().scrollIntoViewIfNeeded();
      await page.locator(sel).first().hover();
    }).toPass({ timeout: 10000 });
  };

  /** 悬停某个 tip，返回气泡矩形 + 其上是否被别的元素盖住 */
  const hoverTip = async (page, sel) => {
    await hoverMark(page, sel);
    // 气泡展示时会被搬到 body 下（绕开祖先的层叠上下文/裁剪），故按 id 找：
    // `aria-describedby` 指向的就是它，这也正是读屏器认的那条关联。
    await expect
      .poll(async () =>
        page.evaluate((s) => {
          const mark = document.querySelector(s);
          const id = mark && mark.getAttribute('aria-describedby');
          const b = id && document.getElementById(id);
          return b ? getComputedStyle(b).visibility : 'none';
        }, sel)
      )
      .toBe('visible');
    return page.evaluate((s) => {
      const mark = document.querySelector(s);
      const id = mark.getAttribute('aria-describedby');
      const bubble = document.getElementById(id);
      const r = bubble.getBoundingClientRect();
      // 沿气泡的四个角与下边缘中点做命中测试：任何一处落在气泡外＝被盖住或被裁掉
      const pts = [
        [r.left + 4, r.top + 4],
        [r.right - 4, r.top + 4],
        [r.left + r.width / 2, r.bottom - 4],
        [r.right - 4, r.bottom - 4],
      ];
      return {
        rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
        vw: innerWidth, vh: innerHeight,
        // 气泡底色（钉的是 --card-2，见 CSS）与四个采样点：稍后按像素核对
        bg: getComputedStyle(bubble).backgroundColor,
        pts: [
          { x: Math.round(r.left + 6), y: Math.round(r.top + 6) },
          { x: Math.round(r.right - 6), y: Math.round(r.top + 6) },
          { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 6) },
          { x: Math.round(r.right - 6), y: Math.round(r.bottom - 6) },
        ],
      };
    }, sel);
  };

  test('收益测算：「缺口」旁的气泡不被下方表格卡片盖住', async ({ appPage: page }) => {
    await gotoAssets(page, 'income');
    await page.evaluate(() => renderIncomeTab());
    const m = await hoverTip(page, '#income-summary .tip-mark');
    expect(m.rect.t).toBeGreaterThanOrEqual(0);
    expect(m.rect.l).toBeGreaterThanOrEqual(0);
    expect(m.rect.r, '气泡越出视口右缘').toBeLessThanOrEqual(m.vw);
    expect(m.rect.b, '气泡越出视口下缘').toBeLessThanOrEqual(m.vh);
    // 判据只看像素：气泡是 pointer-events:none（它不该吃指针），命中测试永远穿过它，
    // 故「有没有被盖住」只能问渲染结果——采样点必须真的是气泡的底色。
    const px = await samplePixels(page, m.pts.map((p) => [p.x, p.y]));
    const want = m.bg.match(/[\d.]+/g).map(Number);
    for (const [i, c] of px.entries()) {
      const d = Math.abs(c.r - want[0]) + Math.abs(c.g - want[1]) + Math.abs(c.b - want[2]);
      expect(d, `(${m.pts[i].x},${m.pts[i].y}) 处不是气泡底色 rgb(${want.slice(0, 3)})，实际 rgb(${c.r},${c.g},${c.b})——被盖住了`)
        .toBeLessThan(12);
    }
  });

  test('重绘之后不得留下两份同 id 的气泡（它会一直显示，且 getElementById 结果不定）', async ({ appPage: page }) => {
    // 气泡展示时被搬到 body 下；卡片一重绘又会生成一份同 id 的，两份同时存在就出双份。
    await gotoAssets(page, 'income');
    await page.evaluate(() => renderIncomeTab());
    const tip = page.locator('#income-summary .tip-mark');
    // 同上：这次 hover 也要熬过 switchTab 那次延迟重绘
    await expect(async () => { await tip.hover(); }).toPass({ timeout: 10000 });
    await expect.poll(async () => page.locator('#cov-shortfall-tip').count()).toBe(1);
    // 触发重绘（改安全边际 = 重算读数 = 重建那段 HTML）
    await page.evaluate(() => { state.incomeSafetyFactor = 80; renderIncomeTab(); });
    await expect.poll(async () => page.locator('#cov-shortfall-tip').count(), {
      message: '重绘后应仍只有一个气泡（遗留的那份必须被丢掉）',
    }).toBe(1);
  });

  test('弹窗内的气泡不被 scroll 容器裁掉（标签与月消费弹窗）', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expense-trend"]').click();
    await page.evaluate(() => openRunwayModal());
    await expect(page.locator('#runway-modal')).toBeVisible();
    const m = await hoverTip(page, '#runway-modal .tip-mark');
    expect(m.rect.b, '气泡越出视口下缘（弹窗正文会裁掉它）').toBeLessThanOrEqual(m.vh);
    const px = await samplePixels(page, m.pts.map((p) => [p.x, p.y]));
    const want = m.bg.match(/[\d.]+/g).map(Number);
    for (const [i, c] of px.entries()) {
      const d = Math.abs(c.r - want[0]) + Math.abs(c.g - want[1]) + Math.abs(c.b - want[2]);
      expect(d, `(${m.pts[i].x},${m.pts[i].y}) 处不是气泡底色——弹窗正文把它裁了或盖了`).toBeLessThan(12);
    }
  });
});

test.describe('版式一致性：数字列右对齐（账本对齐小数点）', () => {
  /** 某张表里第 idx 列：表头与数据行的对齐方式、列宽、数字排布 */
  const col = (page, listSel, idx) =>
    page.evaluate(([sel, i]) => {
      const head = document.querySelector(`${sel} .list-head`);
      const rows = [...document.querySelectorAll(`${sel} .asset-row`)].filter((r) => !r.classList.contains('list-head'));
      if (!rows.length || !head) return null;
      const cell = rows[0].children[i];
      const cs = getComputedStyle(cell);
      const hcs = getComputedStyle(head.children[i]);
      return {
        width: Math.round(cell.getBoundingClientRect().width),
        headWidth: Math.round(head.children[i].getBoundingClientRect().width),
        textAlign: cs.textAlign,
        headAlign: hcs.textAlign,
        tabular: cs.fontVariantNumeric,
      };
    }, [listSel, idx]);

  test('消费列表：金额列表头与数据行都右对齐、等宽数字、列宽相等', async ({ appPage: page }) => {
    await page.locator('#tabs-expenses .tab-btn[data-tab="expenses"]').click();
    const amount = await col(page, '#expenses-list', 1);
    expect(amount, '消费列表应有数据行').not.toBeNull();
    expect(amount.textAlign, '金额列必须右对齐（左对齐时 42.00 与 3,200.00 的小数点错开）').toBe('right');
    expect(amount.headAlign, '表头「金额」也要右对齐（否则上下两行字各指一个方向）').toBe('right');
    expect(amount.tabular, '金额列必须 tabular-nums，否则每一位数字宽度不同').toContain('tabular-nums');
    expect(amount.width, '表头与数据行必须同宽').toBe(amount.headWidth);
    // 定宽列：金额要装得下五位数（3,200.00 实测约 66px，另留出千分位与更大的数）
    expect(amount.width, `金额列 ${amount.width}px 太窄`).toBeGreaterThanOrEqual(100);
  });

  test('资产列表：金额与金额(CNY) 两列都右对齐（同一张表里两列数字不能一左一右）', async ({ appPage: page }) => {
    await gotoAssets(page);
    const idx = await page.evaluate(() =>
      [...document.querySelectorAll('#assets-list .list-head > div')].findIndex((d) => d.textContent.includes('金额 (CNY)')));
    expect(idx, '表头里应有「金额 (CNY)」列').toBeGreaterThan(0);
    // 金额列紧邻其左（中间隔着「货币」列：它是代码不是数字，保持左对齐）
    const idxAmount = await page.evaluate(() =>
      [...document.querySelectorAll('#assets-list .list-head > div')].findIndex((d) => d.textContent.trim().startsWith('金额') && !d.textContent.includes('CNY')));
    expect(idxAmount).toBeGreaterThan(0);
    for (const i of [idxAmount, idx]) {
      const c = await col(page, '#assets-list', i);
      expect(c.textAlign, `第 ${i} 列（金额族）必须右对齐`).toBe('right');
      expect(c.headAlign, `第 ${i} 列表头必须与数据行同向`).toBe('right');
      expect(c.tabular).toContain('tabular-nums');
    }
  });
});
test.describe('版式一致性：真实数据下的读数层级', () => {
  test('收益摘要与对比弹窗的主读数同字号（同一个 .hero-figure）', async ({ appPage: page }) => {
    await gotoAssets(page);
    await page.locator('#tabs-assets .tab-btn[data-tab="income"]').click();
    await expect(page.locator('#income-summary')).toBeVisible();
    await once(await uniqStyles(page, '.hero-figure', ['fontSize', 'fontWeight']));
  });

  test('展示档互不坍缩：主读数 > 弹窗标题 > 区块标题 > 卡片标题', async ({ appPage: page }) => {
    // 「同字号一致」只保证同一类内部统一，挡不住两个角色被并成同一个 token ——
    // 曾把 .hero-figure 与 .modal-title 都指到 --fs-hero，卡片主读数从 32px 被压到 22px。
    // 这里钉死层级本身：读数必须最大，且逐档递减。
    await gotoAssets(page);
    await page.locator('#tabs-assets .tab-btn[data-tab="income"]').click();
    await expect(page.locator('#income-summary')).toBeVisible();
    // .card-title-sm 只在「数据校验」面板里出现（与旁边那个用例同一召出手法）
    await page.evaluate(() => {
      state.expenses[0].tags = {};
      renderExpenses();
      openTagCheck('expense');
    });
    await expect(page.locator('#tagcheck-modal')).toBeVisible();
    const px = async (sel) => parseFloat((await page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontSize)));
    const hero = await px('.hero-figure');
    const modal = await px('.modal-title');
    const section = await px('.section-head h2');
    const card = await px('.card-title');
    const cardSm = await px('#tagcheck-modal .card-title-sm');
    expect(hero, '主读数应是全站最大文字').toBeGreaterThan(modal);
    expect(modal, '弹窗标题 > 区块标题').toBeGreaterThan(section);
    expect(section, '区块标题 > 卡片标题').toBeGreaterThan(card);
    expect(card, '卡片标题 > 卡片小标题').toBeGreaterThan(cardSm);
    expect(cardSm, '卡片小标题 > 正文').toBeGreaterThan(14);
  });

  test('分类卡片标题与校验面板分组标题各成一档（不再逐处内联字号）', async ({ appPage: page }) => {
    await gotoAssets(page);
    await page.locator('#tabs-assets .tab-btn[data-tab="categories"]').click();
    await once(await uniqStyles(page, '.card-title', ['fontSize', 'fontWeight']));

    // .card-title-sm 只在「数据校验」面板里出现：抹掉一条消费的标签把它召出来
    await page.evaluate(() => {
      state.expenses[0].tags = {};
      renderExpenses();
      openTagCheck('expense');
    });
    await expect(page.locator('#tagcheck-modal')).toBeVisible();
    await once(await uniqStyles(page, '#tagcheck-modal .card-title-sm', ['fontSize', 'fontWeight']));
  });
});
