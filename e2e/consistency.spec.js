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
const { test, expect, visitAllTabs } = require('./fixtures');

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
    await page.locator('#mode-assets').click();
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
    await page.locator('#mode-assets').click();
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

test.describe('版式一致性：真实数据下的读数层级', () => {
  test('收益摘要与对比弹窗的主读数同字号（同一个 .hero-figure）', async ({ appPage: page }) => {
    await page.locator('#mode-assets').click();
    await page.locator('#tabs-assets .tab-btn[data-tab="income"]').click();
    await expect(page.locator('#income-summary')).toBeVisible();
    await once(await uniqStyles(page, '.hero-figure', ['fontSize', 'fontWeight']));
  });

  test('分类卡片标题与校验面板分组标题各成一档（不再逐处内联字号）', async ({ appPage: page }) => {
    await page.locator('#mode-assets').click();
    await page.locator('#tabs-assets .tab-btn[data-tab="categories"]').click();
    await once(await uniqStyles(page, '.card-title', ['fontSize', 'fontWeight']));

    // .card-title-sm 只在「数据校验」面板里出现：抹掉一条消费的标签把它召出来
    await page.evaluate(() => {
      state.expenses[0].tags = {};
      renderExpenses();
      openTagCheck();
    });
    await expect(page.locator('#tagcheck-modal')).toBeVisible();
    await once(await uniqStyles(page, '#tagcheck-modal .card-title-sm', ['fontSize', 'fontWeight']));
  });
});
