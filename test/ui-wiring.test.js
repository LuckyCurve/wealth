/*
 * ui-wiring.test.js — index.html UI 接线契约测试
 * --------------------------------------------------------------------------
 * 单文件 SPA 没有「组件引用」可查，HTML 的 onclick 属性就是接线本身。
 * 这里用零依赖的文本断言守住几条关键架构契约，防止后续改动时：
 *   - 旧入口回潮（如页头重新出现导入/导出、明暗快捷开关）
 *   - 同一设置出现两套互不同步的控件（如 io-modal 里再长出频率下拉）
 *   - 接线改名后漏改（onclick 指向已不存在的函数）
 * 与 logic.test.js 一样跑在 node --test 下，无需构建。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const count = (re) => (html.match(re) || []).length;
// 取某顶层函数的完整源码段（函数体不含顶格的 "}"，故非贪婪匹配到行首 "}" 即函数结尾）
const fnSource = (fn) => {
  const m = html.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
};
// 剥掉注释后的源码：断言「不得出现某文案」时，解释该约定的注释本身不算违规
const stripComments = (src) =>
  String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('UI 接线契约：设置是唯一入口', () => {
  test('页头只有「设置」按钮，无导入/导出与明暗快捷开关', () => {
    assert.strictEqual(count(/onclick="showSettings\(\)"/g), 1, 'showSettings 只应接在页头一处');
    assert.strictEqual(count(/dark-toggle/g), 0, '头部 ☀/☾ 快捷开关应保持移除');
    assert.ok(!html.includes('>导入 / 导出<'), '页头不应再有「导入 / 导出」按钮');
    // showImportExport 仅允许由设置弹窗底部的跨弹窗链接触发
    const callers = html.match(/onclick="[^"]*showImportExport\(\)[^"]*"/g) || [];
    assert.strictEqual(callers.length, 1, 'showImportExport 只能有一个触发点');
    assert.ok(callers[0].includes("closeModal('settings-modal')"), '该触发点应在设置弹窗内（先关设置再打开）');
  });

  test('主题切换只接 setTheme(false|true)，旧 toggleDark 不回潮', () => {
    assert.strictEqual(count(/onclick="setTheme\(false\)"/g), 1);
    assert.strictEqual(count(/onclick="setTheme\(true\)"/g), 1);
    assert.strictEqual(count(/\btoggleDark\b/g), 0);
    assert.match(html, /function setTheme\(dark\)/, 'setTheme 定义存在');
    assert.match(fnSource('setTheme'), /syncThemeSeg\(\)/, '切换后回显 seg 状态');
  });

  test('自动备份频率只在设置弹窗：每天/每周/关闭 各接线一次', () => {
    for (const v of ['daily', 'weekly', 'off']) {
      assert.strictEqual(
        count(new RegExp(`onclick="setBackupFreq\\('${v}'\\)"`, 'g')), 1,
        `setBackupFreq('${v}') 应恰好接线一次`);
    }
    assert.strictEqual(count(/backup-auto-freq/g), 0, 'io-modal 的频率下拉应保持移除');
    assert.strictEqual(count(/id="settings-backup-note"/g), 1, '设置弹窗备份边注存在');
  });

  test('syncBackupControls 是备份控件同步的唯一入口，四条路径都走它', () => {
    assert.match(html, /function syncBackupControls\(\)/);
    for (const fn of ['showImportExport', 'showSettings', 'setBackupFreq', 'exportData']) {
      assert.match(fnSource(fn), /syncBackupControls\(\)/, `${fn} 应调用 syncBackupControls`);
    }
  });

  test('上次备份文案单一来源 backupNoteText（logic.js），内联脚本不重复拼接', () => {
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logic, /function backupNoteText\(/);
    assert.strictEqual(count(/上次备份 \$\{/g), 0, '文案拼接不应在内联脚本里重复出现');
    assert.match(html, /backupNoteText\(state\.backup\.lastBackup/);
  });
});

describe('UI 接线契约：统一提示便条（右下角单一出口）', () => {
  test('汇率刷新不再用页头内联状态，旧通道不回潮', () => {
    assert.strictEqual(count(/rate-status/g), 0, '页头 #rate-status 内联提示应保持移除，统一走右下角便条');
    assert.strictEqual(count(/statusEl/g), 0, 'fetchRates 不应残留 statusEl DOM 操作');
  });

  test('全站只有一个 toast 实现与一个容器，容器带 aria-live 且在脚本前就存在', () => {
    assert.strictEqual(count(/function toast\(/g), 1, 'toast 函数应唯一');
    assert.strictEqual(count(/id="toast-area"/g), 1, '#toast-area 容器应唯一');
    assert.ok(
      html.indexOf('id="toast-area"') < html.indexOf('<script src="logic.js">'),
      '容器应在应用脚本加载前存在于 DOM');
    assert.match(html, /<div id="toast-area"[^>]*aria-live="polite"/, '读屏器可感知');
    // 不允许再出现其他 append 到 body 的瞬时提示通道
    assert.strictEqual(fnSource('toast').match(/document\.body\.appendChild/g), null, '便条应入容器而非直接挂 body');
  });

  test('三种语义色齐全：success/error/info 各有亮暗两套样式', () => {
    for (const t of ['success', 'error', 'info']) {
      assert.match(html, new RegExp(`\\.toast-${t} \\{`), `.toast-${t} 亮色样式存在`);
      assert.match(html, new RegExp(`\\.dark \\.toast-${t} \\{`), `.toast-${t} 暗色样式存在`);
    }
  });

  test('fetchRates 的成功/失败都走 toast；失败文案由 logic.js 纯函数决策', () => {
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    const src = fnSource('fetchRates');
    assert.match(src, /toast\('汇率已更新', 'info'\)/, '成功为系统中性知会（金墨 info）');
    assert.match(src, /rateFallbackNotice\(!!state\.rates\.fetchedAt\)/);
    assert.doesNotMatch(src, /使用缓存汇率|汇率获取失败/, '失败文案不应在内联脚本里硬编码重复');
    assert.match(logic, /function rateFallbackNotice\(/, '决策纯函数应在 logic.js');
  });

  test('toast 堆叠与去重：写入 #toast-area、末尾同文案重置计时而非堆叠', () => {
    const src = fnSource('toast');
    assert.match(src, /getElementById\('toast-area'\)/);
    assert.match(src, /area\.appendChild\(t\)/);
    assert.match(src, /dataset\.msg === msg/, '去重比较同文案');
    assert.match(src, /dataset\.type === String\(type\)/, '去重比较同类型');
    assert.match(src, /classList\.contains\('leaving'\)/, '退场中的便条不算重复');
    assert.match(html, /function armToastHide\(/, '计时/退场逻辑抽为独立函数供重置复用');
  });
});

describe('UI 接线契约：共享层单一来源（防重复实现各自漂移）', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');

  test('纯函数下沉 logic.js，index.html 不再保留本地副本', () => {
    for (const fn of ['money2', 'hexToRgba', 'nextSortState', 'expenseMonths', 'incomeGap']) {
      assert.match(logic, new RegExp(`function ${fn}\\(`), `${fn} 应在 logic.js`);
      assert.strictEqual(
        count(new RegExp(`function ${fn}\\(`, 'g')), 0, `index.html 不应再定义 ${fn}`);
    }
    // 两口径收益合计单一来源：报头副行与收益摘要都改走 sumAssetIncomes（逐资产展示值的
    // 表格行/图表切片仍各自 calcAssetIncome，属合法用途不在此约束）
    assert.match(logic, /function sumAssetIncomes\(/);
    for (const fn of ['renderMasthead', 'renderIncomeTab']) {
      assert.match(fnSource(fn), /sumAssetIncomes\(state\.assets\)/, `${fn} 应使用 sumAssetIncomes`);
    }
  });

  test('消费月份列表单一来源 expenseMonths，两处内联 Set 推导消失', () => {
    assert.strictEqual(count(/new Set\(state\.expenses/g), 0, '月份推导不应再内联（一份防御一份不防御曾各自漂移）');
    assert.strictEqual(count(/expenseMonths\(state\.expenses\)/g), 2, '月份筛选与趋势图下拉各一处');
  });

  test('三态排序状态机共用：两个 toggle 都走 nextSortState，内联循环分支不回潮', () => {
    for (const fn of ['toggleSort', 'toggleExpenseSort']) {
      assert.match(fnSource(fn), /nextSortState\(/, `${fn} 应调用 nextSortState`);
      assert.doesNotMatch(fnSource(fn), /sortDir = 'desc'/, `${fn} 内联方向翻转应消失`);
    }
    // 消费侧首次点击粘性翻转语义保留
    assert.match(fnSource('toggleExpenseSort'), /expenseSortTouched/);
  });

  test('堆叠柱状图底座单一来源：两处 setOption 均展开 barChartBase/chartTooltipBase', () => {
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      const src = fnSource(fn);
      assert.match(src, /\.\.\.barChartBase\(/, `${fn} 应用 barChartBase 底座`);
      assert.match(src, /\.\.\.chartTooltipBase\(/, `${fn} 应用 chartTooltipBase 底座`);
    }
    // 逐字重复的 grid/xAxis/yAxis 样板已收敛进 helper：字面量只允许出现一次（helper 定义处）
    assert.strictEqual(count(/grid: \{ left: '3%'/g), 1, 'axis/grid 样板只允许在 barChartBase 内定义一份');
  });

  test('快照对比默认基准单一来源 defaultCompareBaseMonth：默认最近两月，内联不重定义', () => {
    assert.match(logic, /function defaultCompareBaseMonth\(/, '默认基准口径应在 logic.js');
    assert.match(fnSource('openCompareModal'), /defaultCompareBaseMonth\(sorted\)/, '接线从 logic.js 取默认基准');
    assert.strictEqual(count(/function defaultCompareBaseMonth\(/g), 0, 'index.html 不应再保留本地副本');
    // 不保留记忆：每次打开都重置为最近两个月（起始=次新月，结束=最新月）
    const src = fnSource('openCompareModal');
    assert.doesNotMatch(src, /prevBase|prevTarget/, '不应再读取上次选择');
    assert.match(src, /baseSel\.value = defaultCompareBaseMonth\(sorted\)/, '起始月强制次新月');
    assert.match(src, /targetSel\.value = sorted\[sorted\.length - 1\]\.month/, '结束月强制最新月');
  });

  test('对比 hero 单一来源：两个对比弹窗都走 renderCompareHero，零变动文案只定义一次', () => {
    for (const fn of ['renderCompareTable', 'renderExpenseCompareTable']) {
      assert.match(fnSource(fn), /renderCompareHero\(/, `${fn} 应用 renderCompareHero`);
      assert.doesNotMatch(fnSource(fn), /±\$\{formatCNY\(0\)\}/, `${fn} 不应再内联零变动渲染`);
    }
    assert.strictEqual(count(/±\$\{formatCNY\(0\)\}/g), 1, '零变动 hero 文案单一来源');
    assert.match(html, /function renderCompareHero\(/);
  });

  test('对比表迷你量条/百分比单元格单一来源 cmpBar/cmpPctCell', () => {
    for (const fn of ['renderCompareTable', 'renderExpenseCompareTable']) {
      const src = fnSource(fn);
      assert.match(src, /cmpBar\(/, `${fn} 应用 cmpBar`);
      assert.match(src, /cmpPctCell\(/, `${fn} 应用 cmpPctCell`);
      assert.doesNotMatch(src, /cmp-bar-track/, `${fn} 不应再内联量条 HTML`);
    }
    assert.strictEqual(count(/class="cmp-bar-track"/g), 1, '量条模板只出现在 cmpBar helper 一处（CSS 类定义不计）');
  });

  test('弹窗打开统一 openModal 与 closeModal 成对，散落的 display 赋值不回潮', () => {
    assert.match(html, /function openModal\(id\)/);
    assert.match(html, /function closeModal\(id\)/);
    assert.strictEqual(count(/modal\.style\.display = ''/g), 0, '变量形式的弹窗打开应改走 openModal');
    assert.strictEqual(
      count(/document\.getElementById\('[a-z-]+-modal'\)\.style\.display = ''/g), 0,
      '直接 getElementById 的弹窗打开应改走 openModal');
  });
});

describe('UI 接线契约：logic.js 导出清单与筛选同步时序', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');

  test('logic.js 导出清单无重复条目（编辑残留即报错）', () => {
    // 锚定 2 空格缩进的工厂导出块（函数内部的 return 缩进 ≥4 空格，不会误匹配）
    const m = logic.match(/\n  return \{([\s\S]*?)\n  \};/);
    assert.ok(m, '导出块存在');
    const tokens = m[1].split(',').map(s => s.trim()).filter(Boolean);
    assert.strictEqual(new Set(tokens).size, tokens.length,
      '导出标识符应唯一，重复行如 findMonthSnapshot, getPrevSnapshot, 连写两次属编辑残留');
  });

  test('renderExpenses 先重建月份下拉再读筛选值（防「下拉=全部时间 / 空态=旧月份」脱节）', () => {
    const src = fnSource('renderExpenses');
    const build = src.indexOf('populateExpenseMonthFilter()');
    const read = src.indexOf('expenseMonthFilter = monthSel.value');
    assert.ok(build >= 0 && read >= 0, '两步都存在');
    assert.ok(build < read, 'populateExpenseMonthFilter 必须先于 expenseMonthFilter 同步：删除选中月最后一条记录后选项消失、下拉回落全部时间，若先读后建变量会持有已从 DOM 消失的旧月份');
  });
});

describe('UI 接线契约：堆叠柱下钻与图例记忆', () => {
  test('点击下钻接线单一来源 wireStackedBarDrill，两图各接一次，内联 chart.on(click) 不回潮', () => {
    assert.match(html, /function wireStackedBarDrill\(/, 'helper 定义存在');
    assert.strictEqual(count(/wireStackedBarDrill\(/g), 3, '定义一处 + 两图 init 各一次');
    assert.strictEqual(count(/\.on\('click'/g), 1, 'chart click 仅允许 wireStackedBarDrill 内一处，不得散落内联注册');
    assert.match(fnSource('renderHistoryChart'), /viewHistorySegment/, '历史图下钻到资产构成');
    assert.match(fnSource('renderExpenseTrendChart'), /viewExpenseSegment/, '趋势图下钻到消费记录');
  });

  test('下钻弹窗复用 snapshot-modal 且走 openModal 通用路径', () => {
    for (const fn of ['viewHistorySegment', 'viewExpenseSegment']) {
      const src = fnSource(fn);
      assert.match(src, /openModal\('snapshot-modal'\)/, fn + ' 复用快照弹窗');
      assert.match(src, /pctStr\(/, fn + ' 占比列与图表 tooltip 同一来源');
    }
    assert.strictEqual(count(/snapshot-modal-title..\.textContent/g), 4, '快照/月明细/两个下钻四用途共用同一标题元素');
  });

  test('图例选中态经 legendselectchanged 记忆、经 pruneLegendSelected 回灌 barChartBase', () => {
    assert.strictEqual(count(/\.on\('legendselectchanged'/g), 2, '两图各注册一次（注释字样不计）');
    assert.match(
      fnSource('renderHistoryChart'),
      /barChartBase\(th, dates, historyChartMode, sortedTags, pruneLegendSelected\(histLegendSel/,
      '历史图重绘时回灌图例选中态');
    assert.match(
      fnSource('renderExpenseTrendChart'),
      /barChartBase\(th, dates, expenseTrendMode, sortedTags, pruneLegendSelected\(trendLegendSel/,
      '趋势图重绘时回灌图例选中态');
  });
});

describe('UI 接线契约：收益覆盖标尺（分子口径可切换的预期月消费覆盖率）', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');

  test('骨架单一来源：邀请行与标尺各一份，邀请复用既有预期消费弹窗', () => {
    assert.strictEqual(count(/id="cov-invite"/g), 1);
    assert.strictEqual(count(/id="cov-section"/g), 1);
    const invite = html.match(/id="cov-invite"[\s\S]*?id="cov-section"/);
    assert.ok(invite, '邀请行应在标尺之前');
    assert.match(invite[0], /onclick="openExpectationModal\(\)"/,
      '邀请按钮复用预期消费弹窗，不得新开第二套录入通道');
  });

  test('设定后标尺仍提供「修改」再入口（否则收益 Tab 内无法改预期）', () => {
    const section = html.match(/id="cov-section"[\s\S]*?id="income-summary-footer"/);
    assert.ok(section, '标尺区存在');
    assert.match(section[0], /onclick="openExpectationModal\(\)"/, '标签行修改按钮应重开预期弹窗');
  });

  test('禁词守卫：自造概念词与第二套同义词不得回潮（html 全文含注释）', () => {
    assert.doesNotMatch(html, /食利线|息可养支|覆盖量尺/,
      '用户可见文案与注释一律用平实描述「覆盖标尺」，禁词与旧别名一并拦截');
  });

  test('覆盖率口径在 logic.js coveragePct，内联脚本不重复计算百分比', () => {
    assert.match(logic, /function coveragePct\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderCoverageMeter');
    assert.match(src, /coveragePct\(/, '渲染层从 logic.js 取口径');
    assert.doesNotMatch(src, /\/\s*expectation\s*\*|cashMonthly\s*\/\s*expectation/, '覆盖率算式不得在内联脚本重写');
  });

  test('差额口径单一来源 incomeGap：盈余/缺口叙事收归覆盖标尺，报头不再重复渲染', () => {
    assert.match(logic, /function incomeGap\(/);
    // 覆盖标尺（renderCoverageMeter）是盈余/缺口的唯一渲染出口, 口径单一来源
    assert.match(fnSource('renderCoverageMeter'), /incomeGap\(/, '覆盖标尺应使用 incomeGap 取盈余/缺口口径');
    assert.doesNotMatch(fnSource('renderCoverageMeter'), /cashMonthly\s*-\s*expectation/, '覆盖标尺不再内联差额计算');
    // 报头副行只保留收入金额与预期锚点, 盈余/缺口差额已收归覆盖标尺（不调用 incomeGap、不内联差额取整）
    assert.doesNotMatch(fnSource('renderMasthead'), /incomeGap\(/, '报头不再调用 incomeGap 渲染差额');
    assert.doesNotMatch(fnSource('renderMasthead'), /Math\.round\(Math\.abs\(gap\)\)/, '报头不再内联差额取整');
  });

  test('renderCoverageMeter 定义一次、renderIncomeTab 调用一次（骨架静态只同步宽度文案，自足计算两口径合计）', () => {
    assert.strictEqual(count(/\brenderCoverageMeter\(/g), 3, '定义一处 + renderIncomeTab 调用一处 + setCoverageMode 回调一处');
    assert.match(fnSource('renderIncomeTab'), /renderCoverageMeter\(\)/);
    assert.match(fnSource('renderCoverageMeter'), /sumAssetIncomes\(state\.assets\)/, '两口径合计与报头同源，不重复聚合');
  });

  test('分子口径切换：默认总收益、双按钮各接线一次、走 setSegMode 单一来源', () => {
    assert.match(html, /let coverageMode = 'total';/, '默认总收益口径（含增值宽松口径），与 incomeChartMode 同惯例不持久化');
    assert.match(html, /id="cov-mode-total"[^>]*class="seg-btn active"/, '初始 seg 高亮须与默认总收益口径一致');
    assert.strictEqual(count(/onclick="setCoverageMode\('cash'\)"/g), 1);
    assert.strictEqual(count(/onclick="setCoverageMode\('total'\)"/g), 1);
    assert.match(fnSource('setCoverageMode'), /setSegMode\('cov-mode-cash', 'cov-mode-total'/);
    // 指引分支仅现金口径有意义
    assert.match(fnSource('renderCoverageMeter'), /coverageMode === 'cash' && cashMonthly <= 0/);
  });

  test('预期保存/清除仅在收益 Tab 可见时刷新（守卫防隐藏容器 echarts 0 尺寸初始化）', () => {
    for (const fn of ['saveExpectation', 'clearExpectation']) {
      const src = fnSource(fn);
      // 调用语法正则锁定完整守卫形态，裸关键词计数会把注释字样也算进去
      assert.match(
        src,
        /tab-income'\)\.style\.display !== 'none'\) renderIncomeTab\(\)/,
        `${fn} 必须带可见性守卫调 renderIncomeTab（与 refreshVisibleCharts 同惯例）`);
    }
  });

  test('达标印徽复用 mo-badge.up 语义色（与目标净资产「已达成」同语言），不另造徽章样式', () => {
    assert.match(fnSource('renderCoverageMeter'), /mo-badge up/);
  });

  test('缺口还需本金：算式下沉 logic.js coverShortfallPrincipal，内联不重写外推', () => {
    assert.match(logic, /function coverShortfallPrincipal\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderCoverageMeter');
    assert.match(src, /coverShortfallPrincipal\(numerator, expectation,/, '按当前口径传入分子与预期，口径切换/滑块/预期改动自动跟随');
    assert.doesNotMatch(src, /\* 12 \* [\w.]+ \//, '缺口×12÷年化不得在内联脚本重写');
  });

  test('有息本金单一来源 ratedPrincipalCNY：页脚加权平均利率与缺口外推同基地，内联不重复聚合', () => {
    assert.match(logic, /function ratedPrincipalCNY\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderIncomeTab');
    assert.match(src, /ratedPrincipalCNY\(state\.assets\)/, '页脚基地须走 logic.js 同一口径');
    // 内联 reduce 聚合有息本金是分家源头（改一处忘另一处 → 页脚均值与外推年化对不上）
    assert.doesNotMatch(src, /assets\.reduce\(\(s, a\) => s \+ toCNY/, '页脚不得内联重复聚合有息本金');
  });

  test('缺口 Tips 复用标题旁 ? 自绘提示（.tip 唯一实现），仅缺口分支出现', () => {
    const src = fnSource('renderCoverageMeter');
    const tip = fnSource('shortfallTipHtml'); // 气泡拼装的唯一出口
    assert.ok(tip, 'shortfallTipHtml 应存在（Tips 唯一拼装处）');
    assert.match(tip, /cov-shortfall-tip/, '气泡 id 唯一可关联');
    assert.match(tip, /class="tip"/, '复用 .tip 容器');
    assert.match(tip, /class="tip-mark"/, '复用 ? 图标');
    assert.match(tip, /class="tip-bubble"/, '说明性文字进气泡不写正文');
    assert.match(tip, /aria-describedby="cov-shortfall-tip"/, '? 图标关联气泡（可访问性）');
    // 已覆盖分支只剩印徽：tip 拼装须收在 !ok 分支内
    assert.match(src, /if \(!ok\)/, 'Tips 只在未覆盖分支拼装');
    assert.match(src, /shortfallTipHtml\(need,/, '渲染层只调唯一拼装处');
    assert.doesNotMatch(tip, /formatCNY\(gap|\* 12 \*/, '外推算式不得在展示层重写（口径在 logic.js）');
    // 年化 = annual ÷ principal: 展示层再算一遍就与 logic.js 的外推基数分家（改一处忘另一处）
    assert.doesNotMatch(tip, /annual \/ principal|\/ principal \* 100/, '实际年化不得在展示层重算');
    assert.strictEqual(count(/cov-shortfall-tip/g) <= 2, true, '气泡 id 只应出现在拼装处, 不另开通道');
  });
});

describe('UI 接线契约：自动备份等待汇率拉取完成再导出', () => {
  test('DOMContentLoaded 捕获 fetchRates() 的 promise 并传给 maybeAutoBackup', () => {
    assert.match(html, /const ratePromise = fetchRates\(\);/, '应捕获本次启动的汇率拉取 promise 复用同一笔请求');
    assert.match(html, /maybeAutoBackup\(ratePromise\);/, '应把 promise 传给 maybeAutoBackup（而非无参调用）');
    assert.strictEqual(count(/maybeAutoBackup\(\)/g), 0, '不应再有无参调用，否则会抢在汇率刷新前导出拿到过期汇率');
  });

  test('maybeAutoBackup 先 await 汇率 promise 再 downloadBackupJSON', () => {
    assert.match(html, /async function maybeAutoBackup\(ratePromise\)/, '应为 async 且接收 ratePromise 参数');
    const src = fnSource('maybeAutoBackup');
    assert.match(src, /if \(ratePromise\) await ratePromise;/, '下载前应 await 汇率拉取完成（含空值守卫）');
    assert.match(src, /downloadBackupJSON\(\)/, 'await 之后才执行下载');
    // 顺序保证：await 必须排在 downloadBackupJSON 之前，否则导出拿到旧汇率
    assert.ok(
      src.indexOf('await ratePromise') < src.indexOf('downloadBackupJSON()'),
      'await ratePromise 必须排在 downloadBackupJSON 之前');
  });

  test('汇率拉取失败时不阻塞备份：await 包在独立 try/catch 且 catch 不 return，下载在后续独立 try 块', () => {
    const src = fnSource('maybeAutoBackup');
    // await 的 catch 不得提前 return 中断备份流程
    assert.doesNotMatch(src, /catch \(e\) \{[^}]*return/, 'await 的 catch 不应 return 中断备份');
    // 下载逻辑位于 await 的 catch 闭合之后、独立的 try 块内，失败也照常执行
    const awaitCatchEnd = src.indexOf('用缓存汇率继续备份');
    const dlIdx = src.indexOf('downloadBackupJSON()');
    assert.ok(awaitCatchEnd > 0 && dlIdx > awaitCatchEnd, '下载块应在 await 的 catch 之后，失败仍继续备份');
  });
});

describe('UI 接线契约：Flatpickr 日期选择器', () => {
  test('Flatpickr CDN 三件套引入（CSS + JS + 中文 locale）', () => {
    assert.match(html, /flatpickr\/dist\/flatpickr\.min\.css/, 'Flatpickr CSS 存在');
    assert.match(html, /flatpickr\/dist\/l10n\/zh\.js/, '中文 locale 存在');
    assert.strictEqual(count(/flatpickr\.min\.js/g), 0, '不应引用 flatpickr.min.js（主包已含）');
  });

  test('DOMContentLoaded 初始化 Flatpickr，locale zh + disableMobile', () => {
    assert.match(html, /flatpickr\('#expense-date'/, '应初始化 #expense-date');
    const initBlock = html.match(/flatpickr\('#expense-date'[\s\S]*?\}\);/);
    assert.ok(initBlock, '初始化块存在');
    assert.match(initBlock[0], /locale: 'zh'/, '中文 locale');
    assert.match(initBlock[0], /disableMobile: true/, '移动端禁用原生日历，统一桌面样式');
  });

  test('setExpenseDate 是日期设置的单一来源，openExpenseModal 不再内联 _flatpickr 检测', () => {
    assert.match(html, /function setExpenseDate\(/, 'helper 定义存在');
    const helperSrc = fnSource('setExpenseDate');
    assert.match(helperSrc, /\._flatpickr/, 'helper 内部检测 Flatpickr 实例');
    assert.match(helperSrc, /fp\.setDate\(/, 'helper 走 fp.setDate');
    // openExpenseModal 不再各自检测 _flatpickr
    const modalSrc = fnSource('openExpenseModal');
    assert.doesNotMatch(modalSrc, /\._flatpickr/, 'openExpenseModal 不应内联 _flatpickr 检测');
    assert.match(modalSrc, /setExpenseDate\(/, 'openExpenseModal 应调用 setExpenseDate');
    // 不应有直接赋值 .value 的日期设置
    assert.doesNotMatch(modalSrc, /expense-date\]\.value =/, 'openExpenseModal 不应直接赋值 expense-date.value');
  });

  test('selected 日期颜色用 CSS 变量而非硬编码色值', () => {
    assert.doesNotMatch(html, /\.flatpickr-day\.selected[^}]*#211b10/, '亮色选中不应硬编码 #211b10');
    assert.doesNotMatch(html, /\.dark \.flatpickr-day\.selected[^}]*#15110a/, '暗色选中不应硬编码 #15110a');
    assert.match(html, /\.flatpickr-day\.selected[^}]*var\(--fg\)/, '亮色选中应走 var(--fg)');
    assert.match(html, /\.dark \.flatpickr-day\.selected[^}]*var\(--bg\)/, '暗色选中应走 var(--bg)');
  });
});

describe('UI 接线契约：消费标签筛选（单下拉分组，类别作不可选分组头）', () => {
  test('只保留一个标签筛选下拉，级联双下拉与旧切换函数不回潮', () => {
    assert.strictEqual(count(/id="expense-tag-filter"/g), 1, '标签筛选下拉应唯一');
    assert.strictEqual(count(/id="expense-tag-cat-filter"/g), 0, '旧「分类下拉」应移除');
    assert.strictEqual(count(/onExpenseTagCatChange/g), 0, '级联切换处理函数应移除');
    assert.strictEqual(count(/populateExpenseTagCatFilter/g), 0, '分类下拉填充函数应移除');
    assert.match(html, /id="expense-tag-filter"[^>]*onchange="renderExpenses\(\)"/, '下拉 onchange 接 renderExpenses');
  });

  test('筛选状态变量仍在（分类+标签由选中值解析而来）', () => {
    assert.match(html, /let expenseTagCatFilter = '';/, '分类筛选变量存在');
    assert.match(html, /let expenseTagFilter = '';/, '标签筛选变量存在');
  });

  test('populateExpenseTagFilter 用 optgroup 按分类分组，类别不可选、标签才是选项', () => {
    const src = fnSource('populateExpenseTagFilter');
    assert.match(src, /expenseTagFilterGroups\(state\.expenseCategories\)/, '分组结构来自 logic.js 纯函数');
    assert.match(src, /<optgroup label="\$\{esc\(g\.name\)\}"/, '类别渲染为 optgroup 分组头（不可选），分类名经 esc 转义');
    assert.match(src, /全部标签/, '首项为「全部标签」');
    assert.match(src, /g\.tags\.map/, '可选项只来自分类 tags（组头本身不产出 option）');
    assert.match(src, /tagFilterValue\(g\.id, t\)/, '选项 value 走 logic.js 编码（分类+标签）');
    assert.match(src, /（暂无标签）/, '空分类给 disabled 占位项，保住分组可见');
  });

  test('选中值编码/解码下沉 logic.js，内联脚本不自拼口径', () => {
    assert.match(html, /parseTagFilter\(/, '同步时用 parseTagFilter 解码');
    assert.match(html, /tagFilterValue\(/, '生成选项时用 tagFilterValue 编码');
    assert.doesNotMatch(html, /function tagFilterValue/, '编码不得在 index.html 重定义');
    assert.doesNotMatch(html, /function parseTagFilter/, '解码不得在 index.html 重定义');
    assert.doesNotMatch(html, /function expenseTagFilterGroups/, '分组结构不得在 index.html 重定义');
    assert.doesNotMatch(html, /function hasTagFilterOption/, '有效性判定不得在 index.html 重定义');
  });

  test('选中值有效则保留，分类被删/标签改名后回落「全部标签」', () => {
    const src = fnSource('populateExpenseTagFilter');
    assert.match(src, /hasTagFilterOption\(groups, current\)/, '有效性判定走 logic.js 纯函数');
    assert.match(src, /sel\.value = ''/, '无效选中值回落为空（全部标签）');
  });

  test('syncExpenseTagFilter 是标签筛选状态的唯一同步口', () => {
    assert.match(html, /function syncExpenseTagFilter\(/, '同步函数存在');
    const src = fnSource('syncExpenseTagFilter');
    assert.match(src, /parseTagFilter\(/, '从选中值解码');
    assert.match(src, /expenseTagCatFilter = /, '写回分类状态');
    assert.match(src, /expenseTagFilter = /, '写回标签状态');
    assert.strictEqual(count(/syncExpenseTagFilter\(/g), 2, '定义一处 + renderExpenses 调用一处');
    // 除声明外，状态变量只允许在同步口内被赋值（防止绕过同步口直读 DOM 写状态）
    assert.strictEqual(count(/expenseTagCatFilter = /g), 2, '分类状态只在声明与同步口内赋值');
    assert.strictEqual(count(/expenseTagFilter = /g), 2, '标签状态只在声明与同步口内赋值');
  });

  test('renderExpenses 先重建标签下拉再同步状态（防脱节）', () => {
    const src = fnSource('renderExpenses');
    const build = src.indexOf('populateExpenseTagFilter()');
    const sync = src.indexOf('syncExpenseTagFilter()');
    assert.ok(build >= 0 && sync >= 0, '两步都存在');
    assert.ok(build < sync, '重建必须先于状态同步');
    assert.strictEqual(src.indexOf('tagCatSel'), -1, '旧的分类下拉直读不再存在');
  });

  test('renderExpenses 包含标签筛选逻辑：分类+标签同时选中才过滤', () => {
    const src = fnSource('renderExpenses');
    assert.match(src, /expenseTagCatFilter && expenseTagFilter/, '标签筛选要求分类和标签同时选中');
    assert.match(src, /e\.tags\[expenseTagCatFilter\] === expenseTagFilter/, '精确匹配标签值');
  });

  test('clearExpenseFilters 把标签下拉归「全部标签」再重绘（状态由 renderExpenses 同步）', () => {
    const src = fnSource('clearExpenseFilters');
    assert.match(src, /expense-tag-filter/, '重置标签下拉 DOM 值');
    assert.match(src, /tagSel\.value = ''/, '选中值归空');
    assert.match(src, /renderExpenses\(\)/, '触发重绘：重建下拉并重新同步状态');
  });

  test('空态提示区分标签筛选：有筛选时拼接筛选维度文案', () => {
    const src = fnSource('renderExpenses');
    // 空态分支应检查标签筛选
    assert.match(src, /expenseTagCatFilter && expenseTagFilter/, '空态 hasFilter 包含标签筛选条件');
    assert.match(src, /filterParts/, '空态文案用 filterParts 数组拼接');
    assert.match(src, /expenseTagFilter/, '空态文案包含标签筛选值');
  });

  test('合计行标签包含筛选维度：月份+标签+搜索任意组合', () => {
    const src = fnSource('renderExpenses');
    assert.match(src, /tagLabel/, '合计行引用标签筛选值');
    assert.match(src, /parts\.length/, '合计文案用 parts 数组拼接');
    // 合计行应包含所有三种筛选维度
    assert.match(src, /monthLabel\(expenseMonthFilter\)/, '合计包含月份维度');
    assert.match(src, /expenseTagFilter/, '合计包含标签维度');
  });

  test('标签筛选下拉与月份下拉、搜索框同级排列在筛选栏内', () => {
    // 筛选栏是 tab-expenses 内的 flex 容器，包含搜索框、月份下拉与分组标签下拉
    const expTab = html.match(/id="tab-expenses"[\s\S]*?<\/section>/);
    assert.ok(expTab, '消费 Tab 区域存在');
    const bar = expTab[0];
    assert.ok(bar.includes('expense-search'), '搜索框在消费筛选栏内');
    assert.ok(bar.includes('expense-month-filter'), '月份下拉在筛选栏内');
    assert.ok(bar.includes('expense-tag-filter'), '标签下拉在筛选栏内');
    assert.ok(!bar.includes('expense-tag-cat-filter'), '旧分类下拉不在筛选栏内');
  });

  test('populateExpenseTagFilter 仅在 renderExpenses 中调用（单一来源）', () => {
    assert.strictEqual(count(/populateExpenseTagFilter\(/g), 2, '定义一处 + renderExpenses 调用一处');
  });

  test('标签筛选仅在分类和标签同时选中时生效（AND 逻辑）', () => {
    const src = fnSource('renderExpenses');
    // 筛选条件必须同时检查 catFilter 和 tagFilter
    assert.match(src, /expenseTagCatFilter && expenseTagFilter/, '筛选条件为 AND 逻辑');
    assert.doesNotMatch(src, /expenseTagCatFilter \|\| expenseTagFilter/, '不应是 OR 逻辑');
  });

  test('renderExpenses 筛选顺序：月份 → 标签 → 搜索（逐层缩小）', () => {
    const src = fnSource('renderExpenses');
    const monthIdx = src.indexOf('expenseMonthFilter)');
    const tagIdx = src.indexOf('expenseTagCatFilter && expenseTagFilter)');
    const searchIdx = src.indexOf('if (q)');
    assert.ok(monthIdx >= 0 && tagIdx >= 0 && searchIdx >= 0, '三步筛选都存在');
    assert.ok(monthIdx < tagIdx, '月份筛选在标签筛选之前');
    assert.ok(tagIdx < searchIdx, '标签筛选在搜索匹配之前');
  });
});

describe('UI 接线契约：分类管理回车添加标签', () => {
  test('新增标签输入框回车即添加，且 IME 组字中回车不误提交', () => {
    const input = html.match(/<input type="text" id="\$\{cfg\.newTagPrefix\}\$\{cat\.id\}"[^>]*>/);
    assert.ok(input, '分类卡片的「新增标签」输入框模板存在');
    // 中文输入法确认候选字用的也是回车：无 isComposing 守卫会提前提交并销毁组字中的输入框
    assert.match(
      input[0],
      /onkeydown="if\(event\.key==='Enter'&&!event\.isComposing\)/,
      '回车触发添加，须带 IME 组字守卫');
    assert.match(input[0], /event\.preventDefault\(\)/, '阻止默认行为');
    assert.match(input[0], /autocomplete="off"/, '自动填充建议不应抢走回车');
    assert.match(input[0], /\$\{addTagCall\}/, '回车走与「添加」按钮相同的调用');
  });

  test('「添加」按钮与回车共用 addTagCall 单一调用表达式，两处接线不各自漂移', () => {
    assert.strictEqual(count(/const addTagCall = /g), 1, '调用表达式只定义一次');
    assert.strictEqual(count(/\$\{cfg\.addTag\}\(/g), 1, 'cfg.addTag 拼接只允许出现在定义处');
    assert.strictEqual(count(/\$\{addTagCall\}/g), 2, '输入框回车与「添加」按钮各引用一次');
    assert.match(html, /<button onclick="\$\{addTagCall\}"[^>]*>添加<\/button>/, '按钮仍保留（鼠标路径）');
  });

  test('addTagGeneric 重绘后把焦点交回同分类新输入框，不再写已脱离文档的旧 input', () => {
    const src = fnSource('addTagGeneric');
    assert.match(src, /const next = document\.getElementById\(cfg\.newTagPrefix \+ catId\)/);
    assert.match(src, /next\.focus\(\)/, '焦点交回新输入框才能连击回车连续添加');
    assert.doesNotMatch(src, /input\.value = ''/, '旧 input 已随 renderCategoryCards 重绘脱离文档，赋值是死代码');
    const rerender = src.indexOf('renderCategoryCards(side)');
    const refocus = src.indexOf('const next =');
    assert.ok(rerender >= 0 && refocus > rerender, '必须先重绘再取新输入框，否则焦点落在即将被替换的旧节点');
  });

  test('资产/消费两侧的回车与按钮都收敛到 addTagGeneric 单一实现', () => {
    assert.strictEqual(count(/addTagGeneric\(/g), 3, '定义一处 + addTag / addExpenseTag 包装各一处');
  });
});

describe('UI 接线契约：消费数据校验（缺标签一键/逐条补齐）', () => {
  test('校验条唯一且在消费记录 Tab 内，唯一写入点 renderTagCheckBar（由 renderExpenses 调用）', () => {
    assert.strictEqual(count(/id="tagcheck-bar"/g), 1, '校验条容器应唯一');
    const tab = html.match(/id="tab-expenses"[\s\S]*?<\/section>/);
    assert.ok(tab && tab[0].includes('id="tagcheck-bar"'), '校验条应在消费记录 Tab 内（而非分类管理页）');
    assert.strictEqual(count(/renderTagCheckBar\(/g), 2, '定义一处 + renderExpenses 调用一处');
    assert.match(fnSource('renderExpenses'), /renderTagCheckBar\(\)/, '列表每次重绘同步校验条');
    assert.match(fnSource('renderTagCheckBar'), /missingTagGroups\(/, '计数走 logic.js 缺口口径');
  });

  test('面板唯一 #tagcheck-modal，打开走 openModal；三个入口共 4 处接线', () => {
    assert.strictEqual(count(/id="tagcheck-modal"/g), 1, '面板弹窗应唯一（资产/消费不各造一套）');
    assert.strictEqual(count(/id="tagcheck-groups"/g), 1);
    assert.strictEqual(count(/function openTagCheck\(/g), 1, '打开入口只定义一次');
    assert.match(fnSource('openTagCheck'), /openModal\('tagcheck-modal'\)/, '走通用弹窗路径');
    // 定义一处 + 校验条「去校验」+ 分类卡片提示条 + 新建分类后自动打开
    assert.strictEqual(count(/openTagCheck\(/g), 4, '三个入口都调同一入口函数');
  });

  test('chips 单一来源 tagPickerHtml：一键与逐条复用同一实现，第二套不回潮', () => {
    assert.strictEqual(count(/class="tag-choice"/g), 1, 'tag-choice 模板只允许存在一处');
    assert.strictEqual(count(/function tagPickerHtml\(/g), 1, 'chips 生成函数唯一');
    assert.strictEqual(count(/renderTagPicker/g), 0, '旧的就地渲染函数应保持重命名（面板需要拿 HTML 字符串复用）');
    // 定义一处 + 资产表单 + 消费表单 + 面板一键补齐 + 面板逐条
    assert.strictEqual(count(/tagPickerHtml\(/g), 5);
    assert.match(fnSource('tagCheckGroupHtml'), /tagPickerHtml\(/, '面板分组复用 chips 生成');
  });

  test('写标签只走 logic.js setTag/backfillTag，UI 层不直接给 tags 赋值', () => {
    const src = fnSource('onTagCheckPick');
    assert.match(src, /setTag\(/, '逐条点选走 setTag');
    assert.match(src, /backfillTag\(/, '一键补齐走 backfillTag');
    assert.doesNotMatch(src, /\.tags\[/, '面板不得内联 tags 赋值（口径回潮即报错）');
    assert.strictEqual(count(/setTag\(/g), 1, 'index.html 只在 onTagCheckPick 内调一次');
    assert.strictEqual(count(/backfillTag\(/g), 1, 'index.html 只在 onTagCheckPick 内调一次');
  });

  test('落值后同步三处：saveState → 重绘列表与校验条 → 局部重绘该分组（不整面板重建）', () => {
    const src = fnSource('onTagCheckPick');
    assert.match(src, /saveState\(\)/);
    assert.match(src, /renderExpenses\(\)/, '列表 pill 与校验条跟着刷新');
    assert.match(src, /renderTagCheckGroup\(catId\)/, '只重绘命中分组，保留面板滚动位置');
    assert.match(fnSource('renderTagCheckGroup'), /outerHTML/, '局部替换而非重建整个面板');
    // 取消选择（再点已选项）不得改数据：按数据回滚盖印状态
    assert.match(src, /if \(!val\) \{ renderTagCheckGroup\(catId\); return; \}/, '取消选择只回滚 UI');
  });

  test('缺口口径 missingTagGroups 单一来源，四处调用；分类卡片入口带侧别闸门', () => {
    assert.strictEqual(count(/missingTagGroups\(/g), 4, '校验条 + 面板打开 + 分类卡片 + 新建后检测');
    const card = fnSource('renderCategoryCards');
    assert.match(card, /cfg\.tagCheck \? missingTagGroups/, '卡片提示条必须带 cfg.tagCheck 闸门');
    assert.match(card, /openTagCheck\('\$\{jsAttr\(cat\.id\)\}'\)/, '卡片入口聚焦该分类');
    // 两侧各声明一次：资产侧不接线、消费侧接线
    assert.strictEqual(count(/tagCheck: (true|false)/g), 2);
    assert.match(html, /tagCheck: false,[^\n]*资产侧/, '资产侧保持不接（历史快照口径未定）');
    assert.match(html, /tagCheck: true,[^\n]*消费侧/, '消费侧接线');
    assert.match(fnSource('tagCheckGroupHtml'), /isUntaggedItem\(/, '组内待归类计数与 logic.js 同口径');
  });

  test('新建消费分类后自动打开面板：带 createdId && cfg.tagCheck 守卫，且在关掉分类弹窗之后', () => {
    const src = fnSource('saveCategoryGeneric');
    assert.match(src, /if \(createdId && cfg\.tagCheck\)/, '只有启用校验的一侧且确为新建时才打开');
    assert.match(src, /openTagCheck\(createdId\)/, '聚焦新建的那个分类');
    assert.ok(
      src.indexOf('closeModal(m.id)') < src.indexOf('openTagCheck(createdId)'),
      '必须先关分类弹窗再开面板，否则面板被压在下面');
    assert.match(src, /missingTagGroups\(cfg\.items\(\), cfg\.cats\(\)\)/, '无缺口不打扰（0 条时不弹）');
  });

  test('面板语言复用既有账本词汇：✓ 徽章走 mo-badge.up，不另造徽章样式', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /mo-badge up/, '补齐完成态复用既有印徽');
    assert.match(src, /已补齐/, '完成态文案');
    assert.strictEqual(count(/class="tagcheck-group"/g), 1, '分组模板只定义一处');
  });

  test('分组头分类名取 cat 而非会话对象 g（g 只有 catId/ids，用 g.name 会渲成空串）', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /esc\(cat\.name\)/, '分类名从分类对象取');
    // 调用语法正则而非裸关键词：说明注释里也会出现字段名，裸匹配会误报
    assert.doesNotMatch(src, /\$\{esc\(g\.name\)\}/, '会话对象没有 name 字段，插值即渲出空标题');
  });

  test('data-* 属性用 esc 转义而非 jsAttr（dataset 读回需与 state 的 id 字节一致）', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /data-eid="\$\{esc\(e\.id\)\}"/);
    assert.match(src, /data-catid="\$\{esc\(g\.catId\)\}"/);
    assert.doesNotMatch(src, /data-(eid|catid)="\$\{jsAttr/,
      'jsAttr 会把反斜杠翻倍（为 JS 字符串设计），读回后 find(x => x.id === ...) 静默失配');
  });
});

describe('UI 接线契约：图表 tooltip 转义用户输入（防存储型 XSS）', () => {
  // ECharts tooltip 默认 renderMode:'html'，formatter 返回值直接 innerHTML 注入。
  // p.name / p.seriesName / treePathInfo 均来自用户输入（资产名、备注、标签名），
  // 不转义时恶意名称（或导入的 JSON）会执行脚本。列表/弹窗已全走 esc()，tooltip 不得例外。
  test('旭日图 tooltip 名称/标签路径经 esc 转义，且内容单一来源 sunburstTooltipContent', () => {
    // 转义与「路径 › 名称 + 金额 · 占比」文案收敛在 helper 一处；三张旭日图只传口径
    const helper = fnSource('sunburstTooltipContent');
    assert.ok(helper, 'sunburstTooltipContent helper 存在');
    assert.match(helper, /esc\(p\.name\)/, 'helper 应转义名称');
    assert.match(helper, /esc\(p\.treePathInfo\[1\]\.name\)/, 'helper 应转义标签路径');
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart']) {
      assert.match(fnSource(fn), /sunburstTooltipContent\(/, `${fn} 应复用统一 tooltip 内容`);
    }
    assert.strictEqual(count(/\$\{arrow\}\$\{p\.name\}/g), 0, '不得再内联未转义的 ${arrow}${p.name}');
    assert.strictEqual(count(/p\.treePathInfo\[1\]\.name \+ ' › '/g), 0, '路径拼接只允许在 helper 一处');
  });

  test('堆叠柱 tooltip 的系列名经 esc 转义', () => {
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      assert.match(fnSource(fn), /esc\(p\.seriesName\)/, `${fn} tooltip 系列名应 esc 转义`);
    }
    // 唯一允许的裸 p.seriesName 是与常量 TOTAL_SERIES_NAME 的比较，不得出现在 HTML 插值里
    assert.strictEqual(count(/\$\{p\.seriesName\}/g), 0, '系列名插值必须转义');
  });

  test('buildSunburstOption 的 tooltip 底座复用 chartTooltipBase，不再内联重复', () => {
    const src = fnSource('buildSunburstOption');
    assert.match(src, /\.\.\.chartTooltipBase\(th\)/, '应展开 chartTooltipBase 底座');
    assert.doesNotMatch(src, /extraCssText: TOOLTIP_CSS/, '内联 tooltip 底座应消失（回潮即报错）');
  });
});

describe('UI 接线契约：预期保存/清除守卫隐藏容器（消费趋势图）', () => {
  test('saveExpectation/clearExpectation 调 renderExpenseTrendChart 须带消费趋势 Tab 可见性守卫', () => {
    // 覆盖标尺的「修改」入口位于资产模式收益 Tab，此时 #tab-expense-trend 隐藏；
    // 无守卫会在隐藏容器上 echarts.init 出 0×0 实例（与 renderIncomeTab 同一种坑），
    // 之后进入趋势页图表空白，直到窗口 resize。
    for (const fn of ['saveExpectation', 'clearExpectation']) {
      const src = fnSource(fn);
      assert.match(
        src,
        /tab-expense-trend'\)\.style\.display !== 'none'\) renderExpenseTrendChart\(\)/,
        `${fn} 必须带可见性守卫调 renderExpenseTrendChart`);
      assert.doesNotMatch(
        src,
        /^\s*renderExpenseTrendChart\(\);/m,
        `${fn} 不应再无守卫裸调 renderExpenseTrendChart`);
    }
  });
});

describe('UI 接线契约：堆叠柱标签排序单一来源', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');

  test('历史净值/消费趋势的标签合计排序下沉 logic.js sortTagsByTotal，内联 tagTotals 不回潮', () => {
    assert.match(logic, /function sortTagsByTotal\(/, '决策纯函数在 logic.js');
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      assert.match(fnSource(fn), /sortTagsByTotal\(/, `${fn} 应复用统一排序`);
    }
    assert.strictEqual(count(/\btagTotals\b/g), 0, '两处内联的 tagTotals 聚合应消失');
  });
});

describe('UI 接线契约：分类调色板单一来源', () => {
  test('CATEGORY_COLORS 单一来源在 logic.js（index.html 不得再定义一份）', () => {
    // 它曾定义在 index.html：于是「配色 × 插值点都达 AA」这条不变量无法被单测逐点校验，
    // 亮色插值把底色压深而字没跟着加深的缺陷就是这么漏过去的（实测最低 2.4:1）。
    assert.strictEqual(count(/const CATEGORY_COLORS =/g), 0, 'index.html 不再定义调色板');
    assert.ok(count(/CATEGORY_COLORS\[idx/g) >= 1, 'catColorImpl 仍按 idx 取基色（引用 logic.js 的那份）');
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logic, /const CATEGORY_COLORS = \[/, 'logic.js 定义 CATEGORY_COLORS');
    assert.match(logic, /pillColors, basePill, CATEGORY_COLORS/, '并从 logic.js 导出');
  });
});

describe('UI 接线契约：下拉填充空值守卫', () => {
  test('fillCategorySelect 与 fillMonthSelect 一样先守卫元素缺失', () => {
    assert.match(fnSource('fillMonthSelect'), /if \(!sel\) return/, 'fillMonthSelect 既有守卫');
    assert.match(fnSource('fillCategorySelect'), /if \(!sel\) return/, 'fillCategorySelect 应同样守卫');
  });
});

describe('UI 接线契约：本地加载异常回退完整', () => {
  test('初始状态单一来源 freshAppState，loadState 异常回退不零散重置字段', () => {
    assert.match(html, /function freshAppState\(/, '初始状态工厂存在');
    assert.match(html, /let state = freshAppState\(\);/, '顶层 state 由工厂初始化');
    const src = fnSource('loadState');
    assert.match(src, /state = freshAppState\(\)/, 'catch 回退走同一工厂');
    assert.strictEqual(
      count(/state\.categories = \[\{ id: 'currency'/g), 0,
      '不再零散重置单个字段（rates/backup/预期等曾残留半解析状态）');
  });
});

describe('UI 接线契约：行内金额编辑键位（小键盘 Enter 同 Tab）', () => {
  test('键位语义单一来源 inlineEditKeyAction，onInlineEditKey 不内联判 NumpadEnter', () => {
    assert.match(fnSource('onInlineEditKey'), /inlineEditKeyAction\(/, '走纯函数判键位');
    assert.strictEqual(count(/NumpadEnter/g), 0, 'NumpadEnter 判定应只在 logic.js');
    assert.strictEqual(count(/inlineEditKeyAction\b/g), 1, 'index.html 只调用一次，不重复定义');
  });

  test('jump 分支阻止冒泡到 cell 的 Enter 处理（否则小键盘 Enter 会立即重进原行）', () => {
    const src = fnSource('onInlineEditKey');
    const jump = src.slice(src.indexOf("action === 'jump'"));
    assert.notStrictEqual(jump, '', '存在 jump 分支');
    assert.match(jump, /e\.stopPropagation\(\)/, 'jump 必须 stopPropagation：小键盘 Enter 的 key 也是 Enter，冒泡会触发 cell onkeydown 重回原行');
  });

  test('编辑态键位教学提示小键盘 Enter/Tab 下一行', () => {
    assert.match(fnSource('startInlineEdit'), /小键盘 Enter\/Tab 下一行/, '标题键位教学应涵盖小键盘 Enter');
  });
});

describe('UI 接线契约：键盘 Tab 在顶端资产/消费之间轮流切换', () => {
  test('Tab 导航处理器唯一、走 nextTabIndex 纯函数、只注册一次', () => {
    assert.strictEqual(count(/function handleTabKeyNav\(/g), 1, 'handler 应唯一');
    assert.match(fnSource('handleTabKeyNav'), /nextTabIndex\(/, '循环下标下沉 logic.js，不内联重写');
    assert.strictEqual(count(/addEventListener\('keydown', handleTabKeyNav\)/g), 1, '只注册一次');
  });

  test('仅接管顶端模式选择，不再接管子 Tab（.tab-btn）与其它 seg-control', () => {
    const src = fnSource('handleTabKeyNav');
    assert.match(src, /#mode-assets, #mode-expenses/, '只认顶端资产/消费两个按钮');
    assert.ok(!/tab-btn/.test(src), '不得再接管子 Tab');
    assert.ok(!/tabs-assets|tabs-expenses/.test(src), '不得再引用子 Tab 栏');
    assert.strictEqual(count(/nextTabIndex\b/g), 1, '纯函数定义在 logic.js，index.html 只调用一次');
  });

  test('页面未聚焦时的首次 Tab 也切换（补偿浏览器默认先聚焦按钮，避免需按第二次）', () => {
    const src = fnSource('handleTabKeyNav');
    assert.match(src, /document\.activeElement/, '需读取当前焦点');
    assert.match(src, /document\.body/, '识别未聚焦状态（activeElement 为 body）');
    assert.match(src, /#mode-assets\.active, #mode-expenses\.active/, '以当前激活模式按钮为起点');
  });
});

describe('UI 接线契约：弹窗可访问性', () => {
  test('每个 modal-overlay 都声明 role="dialog" 与 aria-modal', () => {
    const overlays = count(/class="modal-overlay"/g);
    assert.ok(overlays > 0, '存在弹窗容器');
    assert.strictEqual(
      count(/class="modal-overlay" role="dialog" aria-modal="true"/g), overlays,
      '全部弹窗都要有对话框语义（读屏器可识别）');
  });
});

describe('UI 接线契约：所选标签的钱 ÷ 预期月消费（消费趋势的读数卡）', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');

  test('口径在 logic.js：渲染层不内联除法，展示走 runwayMonthsText', () => {
    assert.match(logic, /function runwayLiquidCNY\(/, '分子合计在 logic.js');
    assert.match(logic, /function runwayMonths\(/, '月数口径在 logic.js');
    assert.match(logic, /function runwayMonthsText\(/, '展示口径在 logic.js');
    const src = fnSource('renderRunwayRow');
    assert.match(src, /runwayLiquidCNY\(state\.assets/, '渲染层从 logic.js 取分子');
    assert.match(src, /runwayMonths\(/);
    assert.match(src, /runwayMonthsText\(/);
    assert.doesNotMatch(src, /\/\s*expectation/, '月数算式不得在内联脚本重写');
    assert.doesNotMatch(src, /innerHTML/, '只写 textContent: 标签名/金额来自用户数据, 不拼 HTML');
  });

  test('读数卡落在消费趋势（跟着「预期月消费」这条参考线走），收益测算里不得出现', () => {
    assert.strictEqual(count(/id="runway-card"/g), 1);
    assert.strictEqual(count(/id="runway-guide"/g), 1);
    const trendTab = html.match(/id="tab-expense-trend"[\s\S]*?<\/section>/)[0];
    assert.match(trendTab, /id="runway-card"/, '读数依附「预期月消费」，故在消费趋势');
    assert.match(trendTab, /id="runway-guide"[\s\S]*id="runway-reading"/, '指引与读数同卡，指引在前');
    const incomeTab = html.match(/id="tab-income"[\s\S]*?<\/section>/)[0];
    assert.doesNotMatch(incomeTab, /runway/, '这里没有测算收益，读数不得回潮到收益测算');
    assert.strictEqual(count(/id="runway-modal"/g), 1, '标签弹窗唯一');
    assert.strictEqual(count(/onclick="openRunwayModal\(\)"/g), 2, '指引 + 读数各一处再入口');
  });

  test('读数卡公式写在结构里（整句居中, 不沿用无刻度支撑的锚点两端对齐）', () => {
    // 行尾无关: 断言只截到卡片的闭合 div（工作区可能 CRLF，写死 \n 会脆）
    const section = html.match(/id="runway-card"[\s\S]*?<\/div>/);
    assert.ok(section, '读数卡存在');
    assert.match(section[0], /÷ <span id="runway-expense-name">预期月消费<\/span>/,
      '除法与分母名称在静态骨架中可见（公式直呈现）；分母名单独成槽，自定时换成「月消费（自定）」');
    assert.match(section[0], /id="runway-num"/);
    assert.match(section[0], /id="runway-expense"/);
    assert.match(section[0], /id="runway-months"/);
    // 分母名单独成槽且唯一: JS 靠它切换「预期月消费 / 月消费（自定）」
    assert.strictEqual(count(/id="runway-expense-name"/g), 1);
    assert.match(html, /\.runway-line \{[^}]*justify-content: center/, '整句居中, 窄屏按顿读点换行');
    assert.doesNotMatch(section[0], /cov-anchors/, '无刻度可测, 不套用两端对齐锚点（中间空档会显得突兀）');
  });

  test('三种状态：未设预期整卡不显示（入口交给页头「预期消费」按钮）、未选标签走指引、否则读数', () => {
    const src = fnSource('renderRunwayRow');
    assert.match(src, /if \(!card \|\| !guide \|\| !line\) return;/, '三块骨架缺一即早退（少查一个就会在缺元素时抛错）');
    assert.match(src, /if \(!\(expectation > 0\)\)/, '未设预期时整张卡不显示');
    assert.match(src, /liquid != null/, '未选标签（null）与选了但合计为 0 区分开');
    // 四个文案槽必须逐格同步（函数签名天然含函数名, 拿函数名当断言等于没断言）
    for (const id of ['runway-tags-label', 'runway-num', 'runway-expense', 'runway-months']) {
      assert.match(src, new RegExp(`getElementById\\('${id}'\\)\\.textContent`), `${id} 用 textContent 同步`);
    }
    assert.match(fnSource('renderExpenseTrendChart'), /renderRunwayRow\(\);/, '随消费趋势同步刷新');
    assert.doesNotMatch(fnSource('renderIncomeTab'), /renderRunwayRow/, '收益侧不再接线');
    // 调用点唯一：定义 1 + 趋势图同步 1 + 保存后 1；多一处就多一份刷新时机要维护
    assert.strictEqual(count(/renderRunwayRow\(\)/g), 3, '不得新增散落调用点');
    // 空态也要刷新: 必须放在 renderExpenseTrendChart 的早退之前（无消费记录时读数照样成立）
    const trend = fnSource('renderExpenseTrendChart');
    assert.ok(trend.indexOf('renderRunwayRow();') < trend.indexOf('state.expenses.length === 0'),
      '读数同步必须在早退之前');
  });

  test('标签摘要只列有效引用：损坏引用不得渲染成字面 undefined', () => {
    const src = fnSource('renderRunwayRow');
    assert.match(src, /const refs = pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
      '渲染前走同一清理入口：否则手改 JSON 的畸形引用会显示 undefined，非数组还会直接抛错');
  });

  test('多选 chips 复用 tagChipHtml 单一来源，不另造第二套 chip 模板', () => {
    assert.strictEqual(count(/class="tag-choice"/g), 1, 'chip 模板只允许存在一处');
    assert.strictEqual(count(/function tagChipHtml\(/g), 1, 'chip 生成函数唯一');
    // 定义一处 + 单选 picker（录入/校验复用）+ 读数区多选 picker
    assert.strictEqual(count(/tagChipHtml\(/g), 3, '单选与多选共用同一 chip 生成');
    assert.match(fnSource('renderRunwayTagGroups'), /tagChipHtml\(/);
  });

  test('货币类型（内置分类）也能选：不得因 builtin 被挡在 picker 外', () => {
    const src = fnSource('renderRunwayTagGroups');
    assert.doesNotMatch(src, /builtin/, '分组不得提到 builtin（只看 CNY 能撑多久是合法筛法）；函数式 filter 也拦得住');
    assert.match(src, /state\.categories/, '分组直接来自全部分类');
  });

  test('标签引用清理单一来源 pruneRunwayTags：迁移与分类三处编辑都走它', () => {
    assert.match(logic, /function pruneRunwayTags\(/, '清理口径在 logic.js');
    assert.match(logic, /state\.runwayTags = pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
      'migrateState 迁移期清理');
    for (const fn of ['saveCategoryGeneric', 'deleteCategoryGeneric', 'removeTagGeneric']) {
      const src = fnSource(fn);
      assert.match(src, /state\.runwayTags = pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
        `${fn} 改名/删除标签后同步清理读数区引用，避免读数指着已不存在的标签`);
      assert.match(src, /side === 'asset'/, `${fn} 需带侧别闸门：消费分类与读数卡无关`);
    }
  });

  test('落值只走 saveRunwayTags（草稿 _runwayDraft，取消不落库）', () => {
    const src = fnSource('saveRunwayTags');
    assert.match(src, /state\.runwayTags = pruneRunwayTags\(_runwayDraft, state\.categories\)/);
    assert.match(src, /saveState\(\)/);
    assert.match(src, /renderRunwayRow\(\)/);
    assert.match(src, /closeModal\('runway-modal'\)/);
    assert.match(fnSource('openRunwayModal'), /openModal\('runway-modal'\)/, '走通用弹窗路径');
    assert.doesNotMatch(fnSource('openRunwayModal'), /state\.runwayTags = /, '打开只拷草稿，不写状态');
    assert.match(fnSource('openRunwayModal'), /_runwayDraft = .*state\.runwayTags/);
  });

  test('标签语义放 ? 悬停提示（正文不写说明），hover 与键盘 focus 都能看到', () => {
    assert.strictEqual(count(/同一分类内多选为「或」/g), 1, '语义只出现一次——在提示气泡里');
    const tip = html.match(/<span class="tip">[\s\S]*?<\/span>\s*<\/h3>/);
    assert.ok(tip, '标题旁有 ? 提示结构');
    assert.match(tip[0], /class="tip-mark"[^>]*aria-describedby="runway-tip"/, '? 图标关联气泡（可访问性）');
    assert.match(tip[0], /role="tooltip"/);
    assert.match(tip[0], /同一分类内多选为「或」/);
    assert.match(tip[0], /不同分类之间为「且」/);
    assert.match(tip[0], /某个分类不选则不参与过滤/);
    assert.match(html, /\.tip:hover \.tip-bubble/, 'hover 展示');
    assert.match(html, /\.tip:focus-within \.tip-bubble/, '键盘 focus 也要能看到');
    assert.match(html, /prefers-reduced-motion: reduce\) \{ \.tip-mark, \.tip-bubble \{ transition: none; \} \}/,
      '减弱动效须盖住两个会过渡的元素（只写气泡会漏掉 ? 图标）');
  });

  test('弹窗正文不再写说明段落（标题→chips→预览，说明交给 ? 提示）', () => {
    const head = html.match(/id="runway-modal"[\s\S]*?id="runway-tag-groups"/)[0];
    assert.doesNotMatch(head, /<p /, '标题到标签之间不留说明段落');
    assert.doesNotMatch(head, /能撑几个月/, '说明句移入 ? 提示');
    const modal = html.match(/id="runway-modal"[\s\S]*?id="runway-preview"/)[0];
    assert.match(modal, /id="runway-preview"/, '预览行承担算式说明');
  });

  test('弹窗内实时预览：勾选即见结果，不用保存了才知道', () => {
    assert.strictEqual(count(/id="runway-preview"/g), 1, '预览行唯一');
    const src = fnSource('renderRunwayPreview');
    assert.match(src, /runwayLiquidCNY\(state\.assets, _runwayDraft\)/, '预览按草稿算，与读数卡同一口径函数');
    assert.match(src, /runwayMonths\(/);
    assert.match(src, /runwayMonthsText\(/);
    assert.doesNotMatch(src, /innerHTML/, '只写 textContent');
    assert.match(fnSource('openRunwayModal'), /renderRunwayPreview\(\)/, '打开时同步一次');
    assert.match(fnSource('toggleRunwayTag'), /renderRunwayPreview\(\)/, '每次勾选即刷新');
  });

  test('禁词守卫：不引入自造概念词（用户只认标签与算式）', () => {
    assert.doesNotMatch(html, /备用金|跑道|安全垫|应急/,
      '用户可见文案与注释一律用平实描述：所选标签的钱 ÷ 月消费 = 能撑几个月');
  });
});

describe('UI 接线契约：读数卡的自定月消费（只对本卡生效）', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
  const modal = () => html.match(/id="runway-modal"[\s\S]*?id="runway-preview"/)[0];

  test('分母口径在 logic.js：自定优先、否则回落全局预期（渲染层不内联取值）', () => {
    assert.match(logic, /function runwayExpectationOf\(/, '分母口径在 logic.js');
    assert.match(logic, /function runwayExpectationIsCustom\(/, '「是否自定」与分母同一判定');
    const src = fnSource('renderRunwayRow');
    assert.match(src, /runwayExpectationOf\(state\.runwayExpectation, state\.expenseExpectation\)/,
      '分母必须走单一口径函数');
    assert.match(src, /runwayExpectationIsCustom\(state\.runwayExpectation\)/, '自重绘后仍要能标出「自定」');
    assert.doesNotMatch(src, /state\.expenseExpectation\s*\|\|/, '直接读全局预期会把自定值吞掉');
    // 只禁「拿 state.runwayExpectation 直接比较/运算」（裸 `expenseExpectation` 会命中函数名
    // runwayExpectationOf，造成自相矛盾的断言；带 state 前缀的赋值是卡片自身的字段，另由迁移测试把守）
    assert.doesNotMatch(src, /state\.runwayExpectation\s*[<>=!+\-*/]/,
      '分母取值一律走 runwayExpectationOf / runwayExpectationIsCustom，不在渲染层内联回落链');
    assert.match(fnSource('renderRunwayPreview'), /runwayExpectationOf\(/,
      '弹窗预览与读数卡同一分母口径');
  });

  test('输入归一单一来源：写入侧与预览共用 normalizeRunwayExpectationInput', () => {
    assert.match(logic, /function normalizeRunwayExpectationInput\(/, '归一在 logic.js');
    for (const fn of ['renderRunwayPreview', 'saveRunwayTags']) {
      assert.match(fnSource(fn), /normalizeRunwayExpectationInput\([\s\S]{0,80}state\.expenseExpectation\)/,
        `${fn} 走同一解析+归一口径（各写一份时值等价也靠不住, 只改一处就会分家）`);
    }
    // 内联脚本不再自行 replace(/,/g)/parseFloat/比较全局值
    for (const fn of ['renderRunwayPreview', 'saveRunwayTags']) {
      const src = fnSource(fn);
      assert.doesNotMatch(src, /parseFloat/, `${fn} 不得重写解析`);
      assert.doesNotMatch(src, /\/,\/g/, `${fn} 不得重写千分位剥离`);
    }
  });

  test('月消费输入与标签同处一个弹窗，标题随之改名', () => {
    assert.strictEqual(count(/id="runway-expectation"/g), 1, '输入框唯一');
    assert.match(modal(), /id="runway-expectation"/, '与标签同弹窗（同一个编辑框）');
    assert.match(modal(), /oninput="formatMoneyInput\(this\)/, '金额输入沿用同一格式化');
    assert.match(modal(), /<label[^>]*for="runway-expectation"/, '标签关联输入框（点标签可聚焦）');
    assert.match(modal(), /onkeydown="if\(event\.key==='Enter' && !event\.isComposing\)saveRunwayTags\(\)"/,
      '回车即保存（与预期消费/目标净资产弹窗同惯例），带 IME 守卫防组字中误提交');
    assert.match(html, /<h3 class="font-display modal-title">标签与月消费/, '标题已改名');
    assert.doesNotMatch(html, />选择标签</, '标题/按钮不得仍叫「选择标签」（现在也编辑月消费）');
  });

  test('打开时默认带出已填的月消费（字段里就是当前生效数），不回写状态', () => {
    const open = fnSource('openRunwayModal');
    assert.match(open, /runwayExpectationOf\(state\.runwayExpectation, state\.expenseExpectation\)/,
      '默认值走同一分母口径：自定值优先，否则全局预期');
    assert.match(open, /moneyStr\(/);
    assert.doesNotMatch(open, /state\.runwayExpectation = /, '打开只回填输入框，不写状态');
  });

  test('自定值不回填预期月消费（只对本卡生效）', () => {
    const save = fnSource('saveRunwayTags');
    assert.match(save, /state\.runwayExpectation = normalizeRunwayExpectationInput\(/,
      '保存写入读数卡自定值（归一走 logic.js，含「与全局相同则视为默认」）');
    assert.doesNotMatch(save, /state\.expenseExpectation = /, '自定值不得回填全局预期月消费');
    assert.doesNotMatch(html, /expenseExpectation = state\.runwayExpectation/, '更不得反向同步');
  });

  test('「默认」入口单一：把全局预期填回字段（值可见，不必记住原数字）', () => {
    assert.strictEqual(count(/onclick="useDefaultRunwayExpectation\(\)"/g), 1);
    const src = fnSource('useDefaultRunwayExpectation');
    assert.match(src, /moneyStr\(state\.expenseExpectation\)/);
    assert.match(src, /renderRunwayPreview\(\)/);
  });
});

describe('UI 接线契约：本月已花 ÷ 预期月消费（趋势页预算卡）', () => {
  const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
  const trendTab = html.match(/id="tab-expense-trend"[\s\S]*?<\/section>/)[0];
  // 卡片骨架：卡首到下一张卡（跑道卡）之间
  const card = trendTab.slice(trendTab.indexOf('id="month-pace-card"'), trendTab.indexOf('id="runway-card"'));
  // 渲染函数源码（剥掉注释）：契约断言针对代码——注释里复述算式或旧文案不算违规
  const paceSrc = () => stripComments(fnSource('renderMonthPace'));

  test('口径在 logic.js：预算读数/状态文案单一来源，渲染层不内联算式', () => {
    assert.match(logic, /function monthExpenseTotal\(/, '本月合计在 logic.js');
    assert.match(logic, /function monthBudgetReading\(/, '预算口径在 logic.js');
    assert.match(logic, /function monthBudgetNote\(/, '预算状态叙述在 logic.js');
    const src = paceSrc();
    assert.match(src, /monthExpenseTotal\(state\.expenses/, '渲染层从 logic.js 取合计');
    assert.match(src, /monthBudgetReading\(/);
    assert.match(src, /monthBudgetNote\(/);
    assert.doesNotMatch(src, /\/ 31|\/ days|\/ expectation|spent\s*\/\s*expectation|\* 100/, '百分比/日均算式不得在内联脚本重写（呈现统一走 pctStr）');
    assert.match(src, /pctStr\(reading\.pctOfMonth/, '百分比读数取 reading.pctOfMonth（与尺子宽度/≥90% 判断同源, 不另算一遍）');
    assert.match(src, /const now = new Date\(\);/, '合计与读数取同一时刻（各取一次 new Date 会在跨午夜时月份错位）');
    assert.match(src, /getLocalMonthStr\(now\)/, '合计月份来自单一时刻');
    assert.match(src, /monthBudgetReading\(spent, expectation, now\)/, '预算口径用同一时刻');
    assert.doesNotMatch(src, /innerHTML/, '只写 textContent: 金额来自用户数据, 不拼 HTML');
  });

  test('时间进度对照不回潮（大额固定支出会让它失真）', () => {
    // 回归背景：消费沿时间不均匀（房租在月初入账），「比时间进度多花/少花」几乎只反映那笔支出的入账日，
    // 不携带「是否花超了」的信息。改成剩余预算 + 日均后，时间进度对照与「今天」菱形站点都应消失。
    // 注释里仍会复述这条理由，故先剥掉注释再断言（守的是可见文案与旧入口，不是解释本身）。
    assert.doesNotMatch(stripComments(html), /时间进度/, '页面不得再出现时间进度对照');
    assert.doesNotMatch(stripComments(logic), /时间进度/, '口径层不得再叙述时间进度');
    assert.doesNotMatch(html, /pace-tick/, '「今天」菱形站点随时间进度一并移除');
    assert.doesNotMatch(stripComments(logic), /expectedToDate|monthPaceReading|monthPaceStatusText/, '旧入口不回潮');
  });

  test('预算卡落在消费趋势、跑道卡之前（先近后远，同依附「预期月消费」锚点），别处不得回潮', () => {
    assert.strictEqual(count(/id="month-pace-card"/g), 1);
    assert.ok(trendTab.indexOf('month-pace-card') < trendTab.indexOf('runway-card'),
      '本月视角在跑道（长期视角）之前');
    const recordsTab = html.match(/id="tab-expenses"[\s\S]*?<\/section>/)[0];
    assert.doesNotMatch(recordsTab, /month-pace/, '消费记录页不出现第二套进度呈现（单一来源）');
    for (const id of ['pace-num', 'pace-expense', 'pace-pct', 'pace-note', 'pace-fill']) {
      assert.strictEqual(count(new RegExp(`id="${id}"`, 'g')), 1, `${id} 唯一`);
    }
  });

  test('公式写在结构里；预算尺复用 cov-track 家族（不另造第二把尺），不带时间站点', () => {
    assert.match(card, /本月已花/, '主语在静态骨架中可见');
    assert.match(card, /÷ 预期月消费/, '除法与分母名称在静态骨架中可见（公式直呈现）');
    assert.match(card, /class="cov-track"/, '预算尺沿用覆盖标尺同一家族');
    assert.match(card, /class="cov-fill"/, '填充沿用覆盖标尺同一家族');
    assert.match(card, /class="cov-tick"/, '发丝刻度与货币构成条/比例尺同语言');
    assert.doesNotMatch(card, /cov-marker/, '预算尺不再有「今天」站点（尺子语义是预算容器, 不是与时间赛跑）');
    assert.doesNotMatch(html, /\.pace-tick \{/, '不另留第二套刻度样式');
  });

  test('状态机：未设预期整卡不显示（入口交给页头「预期消费」按钮），否则同步文案槽', () => {
    const src = paceSrc();
    assert.match(src, /if \(!card\) return;/, '骨架缺卡早退');
    assert.match(src, /if \(!\(expectation > 0\)\)/, '未设预期时整张卡不显示');
    assert.match(src, /card\.style\.display = 'none'/);
    for (const id of ['pace-num', 'pace-expense', 'pace-pct', 'pace-note']) {
      assert.match(src, new RegExp(`getElementById\\('${id}'\\)`), `${id} 由渲染层同步`);
    }
    // 四个槽各写一次 textContent（逐个 getElementById 取值也算）, 且全函数不得出现 innerHTML
    const textWrites = (src.match(/\.textContent =/g) || []).length;
    assert.strictEqual(textWrites, 4, `四个文案槽都走 textContent 赋值（实测 ${textWrites} 处）`);
    assert.match(src, /Math\.min\(100/, '预算尺宽度物理封顶（读数文字不封顶）');
    assert.match(src, /reading\.over/, '超支/未超支决定填充与状态行语义色');
  });

  test('接线：随消费趋势同步刷新，且在早退之前（无消费记录时也照样同步）', () => {
    const trend = fnSource('renderExpenseTrendChart');
    assert.match(trend, /renderMonthPace\(\);/, '随消费趋势同步刷新');
    assert.ok(trend.indexOf('renderMonthPace();') < trend.indexOf('state.expenses.length === 0'),
      '必须在早退之前');
    assert.strictEqual(count(/function renderMonthPace\(/g), 1, '定义唯一');
    // 调用点唯一：定义外仅趋势图同步 1 处（无散落调用点要维护）
    assert.strictEqual(count(/renderMonthPace\(\)/g), 2, '定义 1 + 趋势图同步 1');
  });
});

describe('UI 接线契约：主题与表单校验的防回潮', () => {
  test('利率输入框必须 step="any"（step="0.1" 会命中原生 stepMismatch 静默拦截提交）', () => {
    // 回归背景：演示数据的 0.25%/0.35% 利率不是 0.1 的倍数，浏览器直接拦下 submit，
    // 用户点「保存」毫无反应且无提示（saveAsset 根本没被调用）。
    const minInput = html.match(/<input[^>]*id="asset-rate-min"[^>]*>/);
    const maxInput = html.match(/<input[^>]*id="asset-rate-max"[^>]*>/);
    assert.ok(minInput && maxInput, '两个利率输入框都存在');
    assert.match(minInput[0], /step="any"/, 'rate-min 必须 step="any"');
    assert.match(maxInput[0], /step="any"/, 'rate-max 必须 step="any"');
    assert.doesNotMatch(minInput[0], /step="0\.1"/, 'step="0.1" 不回潮');
  });

  test('tag-pill 内删除按钮必须剥掉 UA 默认外观（否则灰底黑边系统按钮）', () => {
    // 回归背景：✕ 只设了 color，background/border 走浏览器默认，在古纸主题上很突兀
    const rule = html.match(/\.tag-pill button \{[\s\S]*?\n  \}/);
    assert.ok(rule, '.tag-pill button 重置规则存在');
    assert.match(rule[0], /background:\s*none/, '背景必须归零');
    assert.match(rule[0], /border:\s*none/, '边框必须归零');
  });

  test('hr 的配色必须归到主题变量（UA 默认 color 是灰）', () => {
    const rule = html.match(/\n  hr \{[^}]*\}/);
    assert.ok(rule, 'hr 主题化规则存在');
    assert.match(rule[0], /var\(--border\)/, 'hr 必须用 var(--border)');
  });

  test('两套主题的 CSS 变量一一对应（漏定义会在暗色下回落成亮色值）', () => {
    const collect = (sel) => {
      const m = html.match(new RegExp(`${sel} \{([^}]*)\}`));
      assert.ok(m, `${sel} 存在`);
      return new Set([...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]));
    };
    const light = collect(':root');
    const dark = collect(':root.dark');
    const missingInDark = [...light].filter((k) => !dark.has(k));
    const missingInLight = [...dark].filter((k) => !light.has(k));
    assert.deepStrictEqual(missingInDark, [], `暗色缺变量: ${missingInDark.join(', ')}`);
    assert.deepStrictEqual(missingInLight, [], `亮色缺变量: ${missingInLight.join(', ')}`);
  });
});

/*
 * 排版单一来源：字号/字重/字体族只此一处定义，页面不再写 Tailwind 排版工具类。
 * --------------------------------------------------------------------------
 * 为什么管这件事：Tailwind 走 CDN 且 E2E 里是空壳（window.tailwind = {}），写进工具类的
 * 规格既不可测、又会与自有档位漂移——曾经 10/11/12/13px 四档小字并存、同一处说明在弹窗里
 * 13px 在表格里 12px，用户观感就是「字大小不一、又小又浅」。收敛后：文字只两档字号
 * （12 微操作 / 14 正文）+ 三档字重，层级靠颜色与字重区分，不再靠 1px 差。
 */
describe('UI 接线契约：排版档位单一来源（字号/字重/字体族）', () => {
  test('字号档位类存在且引用变量（页面不写裸字号）', () => {
    assert.match(html, /\n  \.t-micro \{ font-size: var\(--fs-micro\); \}/, '.t-micro = 12px 微操作档');
    assert.match(html, /\n  \.t-body \{ font-size: var\(--fs-body\); \}/, '.t-body = 14px 正文档');
    assert.match(html, /\n  \.t-medium \{ font-weight: var\(--fw-medium\); \}/, '.t-medium = 500');
    assert.match(html, /\n  \.t-bold \{ font-weight: var\(--fw-bold\); \}/, '.t-bold = 700');
    // 强调档（600）不设档位类：只在行内读数出现，由 strong/b 与语义类承担，
    // 预设一个空转的 .t-strong 是死代码（曾有，0 个使用者）
    assert.match(html, /\n  strong, b \{ font-weight: var\(--fw-strong\); \}/, '行内强调走设计字重 600（非 UA 700）');
    assert.strictEqual(count(/\n  \.t-strong \{/g), 0, '不留空转的强调档位类');
  });

  test('排版 token 定义在合并选择器上（与主题无关，不重复进两套主题块）', () => {
    const rule = html.match(/\n  :root, :root\.dark \{[^}]*\}/);
    assert.ok(rule, '排版 token 集中在 :root, :root.dark（与明暗无关）');
    for (const v of ['--fs-micro', '--fs-body', '--fw-medium', '--fw-strong', '--fw-bold',
      '--font-body', '--font-display', '--font-numeric']) {
      assert.match(rule[0], new RegExp(`${v}:`), `${v} 只定义一次`);
    }
  });

  test('字体族单一来源：--font-body 含 CJK 回落，页面不再重复写字面量栈', () => {
    const rule = html.match(/--font-body: ([^;]+);/);
    assert.ok(rule, '--font-body 已定义');
    // 中文必须显式回落屏幕黑体：不写这一层，CJK 会落到 monospace 的宋体兜底，笔画极细
    assert.match(rule[1], /'PingFang SC'/, 'macOS 黑体兜底');
    assert.match(rule[1], /'Microsoft YaHei'/, 'Windows 黑体兜底');
    assert.match(rule[1], /'Noto Sans SC'/, 'Linux/其他黑体兜底');
    assert.strictEqual(count(/font-family: 'IBM Plex Mono', monospace/g), 0,
      '等宽栈不再逐处重复，一律走 var(--font-body)');
    assert.strictEqual(count(/font-family: 'Noto Serif SC', serif/g), 0,
      '展示栈不再逐处重复，一律走 var(--font-display)');
  });

  test('Tailwind 不再承载排版规格（字号/字重/字体族/字距工具类清零）', () => {
    // 规格写进 CDN 工具类的后果：E2E 里是空壳看不见、真机里又和自有档位各算一套
    for (const cls of ['text-xs', 'text-sm', 'text-lg', 'text-\\[10px\\]', 'font-medium', 'font-bold', 'font-mono',
      'tracking-tight', 'tracking-\\[[^\\]]+\\]']) {
      assert.strictEqual(count(new RegExp(`class="[^"]*\\b${cls}\\b`, 'g')), 0,
        `${cls} 应替换为自有档位类 / 角色类`);
    }
    // Tailwind 配置里的 fontFamily 同样撤掉：字体族只在 <style> 定义一次
    assert.strictEqual(count(/fontFamily: \{/g), 0, 'Tailwind config 不再声明 fontFamily');
  });

  test('小字档收敛到 12px 下限：不再有 10/11px 文字', () => {
    assert.strictEqual(count(/font-size: 10px/g), 0, '10px 档废除');
    assert.strictEqual(count(/font-size: 11px/g), 0, '11px 档废除');
    assert.strictEqual(count(/font-size: 13px/g), 0, '13px 并入 14px 正文档');
    assert.match(html, /\n  \.hint-xs \{ font-size: var\(--fs-micro\); \}/, '.hint-xs 归到 12px 档');
  });

  test('正文基准提到 14px/字重 500（原 13px/400，观感就是小且浅）', () => {
    assert.match(html, /\n  body \{[^}]*font-size: var\(--fs-body\)/, 'body 字号 14px');
    assert.match(html, /\n  body \{[^}]*font-weight: var\(--fw-medium\)/, 'body 字重 500');
    assert.match(html, /--fs-micro: 12px/, '微操作档 12px');
    assert.match(html, /--fs-body: 14px/, '正文档 14px');
  });

  test('暗色 muted 在卡面上达 AA（曾只有 4.47:1）', () => {
    const dark = html.match(/\n  :root\.dark \{([\s\S]*?)\n  \}/)[1];
    const muted = dark.match(/--muted: (#[0-9a-f]{6})/)[1];
    const card2 = dark.match(/--card-2: (#[0-9a-f]{6})/)[1];
    const card = dark.match(/--card: (#[0-9a-f]{6})/)[1];
    const bg = dark.match(/--bg: (#[0-9a-f]{6})/)[1];
    const lum = (hex) => {
      const s = hex.slice(1);
      const c = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    for (const [name, surface] of [['--bg', bg], ['--card', card], ['--card-2', card2]]) {
      assert.ok(ratio(muted, surface) >= 4.5, `暗色 muted 在 ${name} 上仅 ${ratio(muted, surface).toFixed(2)}:1`);
    }
  });

  test('标签 pill 不再用 opacity 压淡文字（0.55 时实测仅 1.6:1）', () => {
    const key = html.match(/\n  \.tag-pill \.tag-key \{[^}]*\}/)[0];
    assert.ok(!/opacity:/.test(key), '.tag-key 不用 opacity 压淡，层级靠字重');
    const btn = html.match(/\n  \.tag-pill button \{[^}]*\}/)[0];
    assert.ok(!/opacity:/.test(btn), 'pill 内 ✕ 不用 opacity 压淡（它是个真控件）');
  });

  test('平铺 chip 未选中态不套分类色（否则浅色系分类的字会「发白」）', () => {
    // CSS 注释写的是「虚线空栏 = 待选, 实心盖印 = 已选」，但未选中态一直在用 --chip-fg
    // （分类的饱和字色）：同一支 picker 里，支付方式是棕字、消费类型是绿字、消费频率是
    // 黄绿字——第三类在暖色卡面上亮度最低，肉眼看着就是「特别浅」，尽管对比度仍达标。
    // 分类色只留给「已选」这个承载语义的状态。
    const rule = html.match(/\n  \.tag-choice \{[^}]*\}/)[0];
    assert.ok(!/--chip-fg/.test(rule), '未选中态不得用分类字色');
    assert.ok(!/--chip-bg/.test(rule), '未选中态不得用分类底色');
    assert.match(rule, /color: var\(--muted\)/, '未选中态统一走 muted（所有分类长得一样）');
    const border = rule.match(/border: 1px dashed ([^;]+);/);
    assert.ok(border, '未选中态保持虚线空栏');
    assert.strictEqual(border[1].trim(), 'var(--border)', '虚线描边走中性 border，不走分类色');
    // 已选态才允许用分类色（data-driven 色值无法用类名表达，只能内联变量）
    const pressed = html.match(/\n  \.tag-choice\[aria-pressed="true"\] \{[^}]*\}/)[0];
    assert.match(pressed, /background: var\(--chip-bg\)/, '已选态用分类底色（实心盖印）');
    assert.match(pressed, /color: var\(--chip-fg\)/, '已选态用分类字色');
  });

  test('已选 chip 的描边走分类字色（曾用分类底色当描边，选中态几乎看不见）', () => {
    // pillColors 的底/描边都是 90%+ 明度的浅 tint，与弹窗卡面（--card）只差 1.04–1.09:1
    // —— 肉眼完全看不出「已选中」，用户原话「已经选中了日常但快看不出来了」。
    // 而未选中态的中性虚线描边有 1.38:1，反而比选中态更显眼，选择指示是倒挂的。
    // 描边改用分类字色（--chip-fg）：实测 4.99–7.46:1，与浅 tint 拉开明确的「盖印」边。
    const pressed = html.match(/\n  \.tag-choice\[aria-pressed="true"\] \{[^}]*\}/)[0];
    assert.match(pressed, /border: 1px solid var\(--chip-fg\)/, '描边用分类字色，不用浅 tint');
    assert.ok(!/--chip-border/.test(pressed), '不再用 --chip-border 当描边（那只是更浅的 tint）');
  });
});

/*
 * 版式一致性：同类结构必须共用同一套 class，页面不得再内联重复样式。
 * --------------------------------------------------------------------------
 * 单文件 SPA 没有组件可复用，同类结构（章节头、表格、按钮、弹窗页脚、字段标签…）
 * 只能靠「同一组 class」保持一致；一旦允许内联覆盖，同类结构就会各自漂移
 * （改一处间距，另一处不知道）。这里把「什么结构用什么 class」钉死，防回潮。
 */
describe('UI 接线契约：版式一致性（同类结构同一套 class）', () => {
  const styleOf = (attr) => (html.match(new RegExp(`${attr}[^>]*style="([^"]*)"`)) || [])[1] || '';

  test('章节头只有 section-head 一种写法（布局归 CSS，不再复制 flex/mb-6 类串）', () => {
    assert.strictEqual(count(/class="flex items-center justify-between mb-6 section-head/g), 0,
      '章节头的布局类串应收回 .section-head');
    assert.strictEqual(count(/class="section-head mb-6"/g), 8, '八个 Tab 的章节头统一为 section-head mb-6');
    const rule = html.match(/\n  \.section-head \{[^}]*\}/);
    assert.ok(rule, '.section-head 自带布局规则');
    assert.match(rule[0], /display:\s*flex/, '布局（flex）在 CSS 里定义一次');
    assert.match(rule[0], /flex-wrap:\s*wrap/, '窄屏换行也在 CSS 里');
  });

  test('表头统一 list-head：字号/字距/底色/收尾双线都在 CSS，页面不再内联', () => {
    assert.strictEqual(count(/list-head text-xs font-medium/g), 0, '表头不再内联字号类');
    assert.strictEqual(count(/list-head"[^>]*style="[^"]*color:var\(--muted\)/g), 0, '表头不再内联 muted 色');
    assert.strictEqual(count(/list-head/g), 10, '表头共 10 处（列表 2 + 弹窗/图表明细 8）');
    const rule = html.match(/\n  \.list-head \{[^}]*\}/);
    assert.ok(rule, '.list-head 规则存在');
    assert.match(rule[0], /color:\s*var\(--muted\)/, '表头底色归 CSS');
    assert.match(rule[0], /font-size:/, '表头字号归 CSS');
  });

  test('列宽模板单一来源：只在 CSS 定义一次，表头与数据行挂同一 class', () => {
    // 内联 style 里不得再出现列宽（原先表头与数据行各写一遍同一串 = 改一处漏一处）
    assert.strictEqual(count(/style="[^"]*grid-template-columns/g), 0, '列宽不许内联');
    for (const [cls, tpl] of [
      ['cols-expenses', '1fr 1fr 2fr 1.5fr 130px'],
      ['cols-expense-month', '1fr 1fr 2fr 1.5fr'],
      ['cols-income', '1.8fr 1fr 0.8fr 0.8fr 1fr 1fr 1fr'],
      ['cols-segment', '2fr 1fr 0.7fr 1.3fr 0.7fr'],
      ['cols-compare', '2fr 1.2fr 1.2fr 1.5fr 1fr'],
      ['cols-expense-segment', '1fr 1fr 0.8fr 2.6fr'],
    ]) {
      assert.match(html, new RegExp(`\\.${cls} \\{[^}]*grid-template-columns: ${tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`),
        `${cls} 模板在 CSS 里定义`);
      assert.strictEqual(count(new RegExp(`grid-template-columns: ${tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`, 'g')), 1,
        `${tpl} 只应出现一次（CSS 定义处）`);
    }
    // 表头与数据行必须引用同一个常量/类名，而不是各自写一遍
    for (const name of ['cols-segment', 'cols-compare', 'cols-expense-segment']) {
      assert.match(html, new RegExp(`const cols = '${name}'`), `${name} 走常量`);
    }
  });

  test('按钮尺寸只有两档小号（.btn-sm / .btn-xs），同类按钮不再各自内联', () => {
    assert.strictEqual(count(/btn-(ghost|gold|danger)[^>]*style="[^"]*(padding|font-size|white-space)/g), 0,
      '按钮尺寸必须走 .btn-sm / .btn-xs 档位，不再内联');
    for (const cls of ['btn-sm', 'btn-xs']) {
      assert.match(html, new RegExp(`\\.${cls}(,| \\{)`), `${cls} 档位在 CSS 里定义`);
    }
    // 空态邀请按钮的内联 padding 与 .btn-ghost 默认值完全重复，应已删除
    assert.strictEqual(count(/class="btn-ghost" style="padding/g), 0, '默认档位不再重复声明 padding');
  });

  test('弹窗：标题下间距与页脚布局统一（mb-* 变体与 mt-6/mt-8 混用不再出现）', () => {
    assert.strictEqual(count(/class="font-display modal-title mb-\d/g), 0,
      '弹窗标题间距收回 .modal-title');
    assert.strictEqual(count(/flex justify-end gap-3 mt-8/g), 0, '弹窗页脚统一走 .modal-footer');
    assert.strictEqual(count(/class="modal-footer"/g) + count(/class="modal-footer between"/g) >= 13, true,
      '全部弹窗页脚都挂 .modal-footer');
    const rule = html.match(/\n  \.modal-footer \{[^}]*\}/);
    assert.ok(rule, '.modal-footer 规则存在');
    assert.match(rule[0], /justify-content:\s*flex-end/);
  });

  test('字段标签与下拉框统一 class（.field-label / .select-field）', () => {
    assert.strictEqual(count(/class="block text-xs font-medium mb-1\.5"/g), 0,
      '表单字段标签统一走 .field-label');
    assert.match(html, /<select[^>]*class="select-field/);
    assert.strictEqual(count(/<select[^>]*style="min-width:\d+px;"/g), 0,
      '下拉框宽度由 .select-field 决定，不再逐个内联');
    const sel = html.match(/\n  \.select-field \{[^}]*\}/);
    assert.ok(sel, '.select-field 规则存在');
    assert.match(sel[0], /min-width:\s*\d+px/, '宽度只此一处');
  });

  test('muted 文字用 .muted，不再逐处内联 color:var(--muted)', () => {
    assert.strictEqual(count(/style="color:var\(--muted\);"/g), 0, '纯 muted 内联样式应清空');
    assert.match(html, /\n  \.muted \{ color: var\(--muted\); \}/, '.muted 规则存在');
  });
});

describe('UI 接线契约：卡片内读数与标题的层级（同一角色同一字号）', () => {
  test('卡片主读数统一 .hero-figure（收益摘要 / 对比弹窗 hero 不再各自内联 30px/36px）', () => {
    assert.strictEqual(count(/style="[^"]*font-size:3[06]px/g), 0,
      '主读数字号应走 .hero-figure');
    const rule = html.match(/\n  \.hero-figure \{[^}]*\}/);
    assert.ok(rule, '.hero-figure 规则存在');
    assert.match(rule[0], /font-size:/, '字号只此一处');
    assert.match(rule[0], /font-weight: var\(--fw-medium\)/, '主读数字重走 token 档位');
  });

  test('卡片标题统一 .card-title / .card-title-sm（不再内联 font-size:17px/15px）', () => {
    assert.strictEqual(count(/style="[^"]*font-size:1[57]px/g), 0,
      '卡片标题字号应走 .card-title / .card-title-sm');
    assert.match(html, /\n  \.card-title \{[^}]*font-size: var\(--fs-card\)/, '卡片标题字号走 token');
    assert.match(html, /\n  \.card-title-sm \{[^}]*font-size: var\(--fs-card-sm\)/, '卡片小标题字号走 token');
  });
});

describe('UI 接线契约：弹窗尺寸与筛选控件的档位', () => {
  test('弹窗宽度只有四档 + 默认，不再逐个内联 max-width', () => {
    assert.strictEqual(count(/class="modal-content" style="max-width/g), 0,
      '弹窗宽度应走 .modal-sm / .modal-md / .modal-lg / .modal-xl');
    for (const [cls, w] of [['modal-sm', '400px'], ['modal-md', '480px'], ['modal-lg', '720px'], ['modal-xl', '960px']]) {
      assert.match(html, new RegExp(`\.${cls} \{ max-width: ${w}; \}`), `${cls} 档位在 CSS 里定义`);
    }
  });

  test('筛选下拉统一 .select-field，搜索框宽度归 .search-wrap，都不再内联 min-width', () => {
    assert.strictEqual(count(/style="min-width:\d+px;"/g), 0, '筛选控件不再内联 min-width');
    // 8 个工具条/图表筛选下拉 + 5 个对比弹窗下拉
    assert.strictEqual(count(/class="select-field/g), 13, '13 个筛选下拉都挂同一类');
    assert.strictEqual(count(/class="select-field ml-2"/g), 5, '弹窗内下拉用既有 ml-2 工具类控制左间距');
    assert.match(html, /<input[^>]*id="expense-search"[^>]*class="t-body"/, '搜索框不再带内联宽度');
    assert.match(html, /\n  \.select-field \{ min-width: 160px; \}/, '下拉宽度只此一处');
    assert.match(html, /\n  \.search-wrap input \{[^}]*min-width: 180px/, '搜索框宽度只此一处');
  });

  test('小号元信息标签统一 .meta-label（收益摘要 / 对比弹窗筛选标签不再内联字距）', () => {
    assert.strictEqual(count(/style="[^"]*letter-spacing/g), 0, '字距应由 .meta-label / 类承担');
    assert.match(html, /\n  \.meta-label \{[^}]*letter-spacing: 0\.06em/, '.meta-label 规则存在');
  });
});

describe('UI 接线契约：文字色角色的单一来源', () => {
  test('金色读数 .ink-accent / 柔化读数 .text-value：同类数字不再逐处内联色值', () => {
    assert.strictEqual(count(/style="color:var\(--accent-ink\);?"/g), 0, '金色读数应走 .ink-accent');
    assert.strictEqual(count(/style="[^"]*color:var\(--fg\);opacity:0\.85;/g), 0, '柔化读数应走 .text-value');
    assert.match(html, /\n  \.ink-accent \{ color: var\(--accent-ink\); \}/);
    assert.match(html, /\n  \.text-value \{ color: var\(--fg\); opacity: 0\.85; \}/);
  });

  test('未设置利率的小字注记统一 .hint-xs（不再内联 font-size:11px）', () => {
    assert.strictEqual(count(/style="[^"]*font-size:11px/g), 0, '小字注记应走 .hint-xs');
    assert.match(html, /\n  \.hint-xs \{ font-size: var\(--fs-micro\); \}/);
  });
});

describe('UI 接线契约：同排标签的对齐', () => {
  test('与右侧读数同排的字段标签不带下间距（否则居中排布时上移半个间距）', () => {
    assert.match(html, /<label class="field-label tight" for="asset-cash-ratio">/,
      '现金比例标签与读数同排，下间距应由父行承担');
    assert.match(html, /\n  \.field-label\.tight \{ margin-bottom: 0; \}/);
  });
});

describe('UI 接线契约：收益/读数文字色的角色类补齐', () => {
  test('正向收益色 .ink-up、加粗读数 .readout-strong 各自单一来源', () => {
    assert.strictEqual(count(/style="color:var\(--verdigris\);"/g), 0, '正向收益色应走 .ink-up');
    assert.match(html, /\n  \.ink-up \{ color: var\(--verdigris\); \}/);
    // 读数卡里的加粗数值（标签钱数 / 月数）共用同一档
    assert.strictEqual(count(/style="font-weight:600;color:var\(--fg\);"/g), 0, '加粗读数走 .readout-strong');
    assert.strictEqual(count(/style="font-weight:600;color:var\(--accent-ink\);"/g), 0, '加粗金墨读数走 .readout-strong.ink-accent');
    assert.match(html, /\n  \.readout-strong \{ font-weight: var\(--fw-strong\); \}/);
  });
});
