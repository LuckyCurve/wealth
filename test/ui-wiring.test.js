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
    for (const fn of ['money2', 'hexToRgba', 'nextSortState', 'expenseMonths']) {
      assert.match(logic, new RegExp(`function ${fn}\\(`), `${fn} 应在 logic.js`);
      assert.strictEqual(
        count(new RegExp(`function ${fn}\\(`, 'g')), 0, `index.html 不应再定义 ${fn}`);
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
