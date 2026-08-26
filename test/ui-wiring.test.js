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

describe('UI 接线契约：食利线（现金收益覆盖预期月消费标尺）', () => {
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

  test('覆盖率口径在 logic.js coveragePct，内联脚本不重复计算百分比', () => {
    assert.match(logic, /function coveragePct\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderCoverageMeter');
    assert.match(src, /coveragePct\(/, '渲染层从 logic.js 取口径');
    assert.doesNotMatch(src, /\/\s*expectation\s*\*|cashMonthly\s*\/\s*expectation/, '覆盖率算式不得在内联脚本重写');
  });

  test('差额口径单一来源 incomeGap：报头 gapSuffix 与食利线读数共用，内联算法不回潮', () => {
    assert.match(logic, /function incomeGap\(/);
    for (const fn of ['renderMasthead', 'renderCoverageMeter']) {
      assert.match(fnSource(fn), /incomeGap\(/, `${fn} 应使用 incomeGap 取盈余/缺口口径`);
    }
    assert.doesNotMatch(fnSource('renderMasthead'), /Math\.round\(Math\.abs\(gap\)\)/, '报头不再内联差额取整');
    assert.doesNotMatch(fnSource('renderCoverageMeter'), /cashMonthly\s*-\s*expectation/, '食利线不再内联差额计算');
  });

  test('renderCoverageMeter 定义一次、renderIncomeTab 调用一次（骨架静态只同步宽度文案，自足计算两口径合计）', () => {
    assert.strictEqual(count(/\brenderCoverageMeter\(/g), 3, '定义一处 + renderIncomeTab 调用一处 + setCoverageMode 回调一处');
    assert.match(fnSource('renderIncomeTab'), /renderCoverageMeter\(\)/);
    assert.match(fnSource('renderCoverageMeter'), /sumAssetIncomes\(state\.assets\)/, '两口径合计与报头同源，不重复聚合');
  });

  test('分子口径切换：默认现金、双按钮各接线一次、走 setSegMode 单一来源', () => {
    assert.match(html, /let coverageMode = 'cash';/, '默认现金口径（不动本金的严格口径），与 incomeChartMode 同惯例不持久化');
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
});
