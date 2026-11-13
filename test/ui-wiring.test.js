const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 页面已拆成：markup（index.html）/ css（styles.css）/ js（按加载顺序拼的 app-*.js）/ 纯逻辑层（LOGIC_FILES）。
// html 是「一份文件时的全貌」，一条正则横跨多个文件时用它；只问其中一份时用对应的变量。
const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// 样式同样拆成多份（基础/版块/打印），按加载顺序拼：断言问的是「样式层里有没有这一条」，
// 不是「它恰好落在哪一份」，所以 css 是整层源码；只问入口那份时用 styles.css 自身。
const CSS_FILES = ['styles.css', 'styles-views.css', 'styles-print.css'];
const css = CSS_FILES.map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
const JS_FILES = ['app-core.js', 'app-gate.js', 'app-assets.js', 'app-categories.js', 'app-charts.js', 'app-stress.js', 'app-settings.js', 'app-ui.js', 'app-expenses.js', 'app-tag-check.js', 'app-calendar.js', 'app-receipt.js', 'app-yield.js'];
const js = JS_FILES.map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
// 纯逻辑层已按域拆成多份：`logicSrc` 是**整层的源码**（入口 + 各分片，按加载顺序）。
// 断言「某口径只在逻辑层出现一处」必须看整层——只看入口会漏、只看分片会假红。
const LOGIC_FILES = ['logic-i18n-en.js', 'logic.js'];
const logicSrc = LOGIC_FILES.map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
// <head> 里的引导/配置脚本（首帧主题 + 开屏两态、Tailwind CDN 的主题扩展）。
// 它们不参与页面脚本的拼接断言（不共享全局、也不该被当成页面逻辑），但同属运行时：
// 外呼与语法两道契约照样要看它们。
const BOOT_FILES = ['boot.js', 'tailwind-config.js'];
const html = markup + '\n' + css + '\n' + js;
const L = require('../logic.js');
const count = (re) => (html.match(re) || []).length;
// 取某顶层函数的完整源码段（函数体不含顶格的 "}"，故非贪婪匹配到行首 "}" 即函数结尾）。
// 找不到必须报错：返回空串会让该函数的所有「不得出现 X」负向断言永久假绿——测试看着在、
// 实际什么都没验（改个函数名就静默失效）。
const fnSource = (fn) => {
  const m = html.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `fnSource 未匹配到函数 ${fn}（改名/改形会让提取为空、断言静默失效，此处必须报错）`);
  return m[0];
};
// 剥掉注释后的源码：断言「不得出现某文案」时，解释该约定的注释本身不算违规
const stripComments = (src) =>
  String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// 按起止锚点截取源码块。锚点找不到必须报错：
// indexOf 返回 -1 时 slice 会静默截出空串（或末一个字符），负向断言于是永久假绿。
const blockFrom = (src, startAnchor, endAnchor) => {
  const start = src.indexOf(startAnchor);
  assert.ok(start >= 0, `源码锚点不存在: ${JSON.stringify(startAnchor)}（提取失败必须报错，不得静默返回空块）`);
  const rest = src.slice(start);
  if (endAnchor === undefined) return rest;
  const end = rest.indexOf(endAnchor);
  assert.ok(end >= 0, `结束锚点不存在: ${JSON.stringify(endAnchor)}`);
  return rest.slice(0, end);
};

describe('UI 接线契约：设置是唯一入口', () => {
  test('页头只有「设置」按钮，无导入/导出与明暗快捷开关', () => {
    assert.strictEqual(count(/onclick="showSettings\(\)"/g), 1, 'showSettings 只应接在页头一处');
    assert.strictEqual(count(/dark-toggle/g), 0, '头部 ☀/☾ 快捷开关应保持移除');
    assert.ok(!html.includes('>导入 / 导出<'), '页头不应再有「导入 / 导出」按钮');
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

  test('syncBackupControls 是备份控件同步的唯一入口，各处路径都走它', () => {
    assert.match(html, /function syncBackupControls\(\)/);
    for (const fn of ['showImportExport', 'showSettings', 'setBackupFreq', 'exportData',
      'restoreBackupDir', 'chooseBackupDirAsync', 'clearBackupDirAsync', 'applyBackupResult']) {
      assert.match(fnSource(fn), /syncBackupControls\(\)/, `${fn} 应调用 syncBackupControls`);
    }
  });

  test('上次备份文案单一来源 backupNoteText（logic.js），内联脚本不重复拼接', () => {
    const logic = logicSrc;
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backupNoteText\(/);
    assert.strictEqual(count(/上次备份 \$\{/g), 0, '文案拼接不应在内联脚本里重复出现');
    assert.match(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backupNoteText\(state\.backup\.lastBackup/);
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
    assert.strictEqual(fnSource('toast').match(/document\.body\.appendChild/g), null, '便条应入容器而非直接挂 body');
  });

  test('三种语义色齐全：success/error/info 各用一枚语义 token', () => {
    const ink = { success: '--verdigris', error: '--down', info: '--secondary' };
    for (const [t, token] of Object.entries(ink)) {
      const rule = css.match(new RegExp(`\\.toast-${t}[^{]*\\{[^}]*\\}`));
      assert.ok(rule, `.toast-${t} 样式存在`);
      assert.match(rule[0], new RegExp(`color:\\s*var\\(${token}\\)`), `.toast-${t} 的墨色走 ${token}`);
      assert.match(rule[0], /background:\s*var\(--card-2\)/, '纸面走中性 token，亮暗自动跟随');
    }
    assert.doesNotMatch(css, /\.dark \.toast-/, '语义色已是 token，不再各写一套暗色覆盖');
  });

  test('fetchRates 的成功/失败都走 toast；失败文案由 logic.js 纯函数决策', () => {
    const logic = logicSrc;
    const src = fnSource('fetchRates');
    assert.match(src, /toast\(i18n\.t\('汇率已更新'\), 'info'\)/, '成功为系统中性知会（金墨 info）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?rateFallbackNotice\(!!state\.rates\.fetchedAt\)/);
    assert.doesNotMatch(src, /使用缓存汇率|汇率获取失败/, '失败文案不应在内联脚本里硬编码重复');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?rateFallbackNotice\(/, '决策纯函数应在 logic.js');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?ratesFromApi\(/, '汇率响应须经 logic.js ratesFromApi 校验后写入');
    assert.doesNotMatch(stripComments(src), /1 \/ cny\./, '不得在页面里直接取倒数（缺字段即 NaN）');
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
  const logic = logicSrc;

  test('纯函数下沉 logic.js，index.html 不再保留本地副本', () => {
    for (const fn of ['money2', 'hexToRgba', 'nextSortState', 'expenseMonths', 'incomeGap']) {
      assert.match(logic, new RegExp(`function ${fn}\\(`), `${fn} 应在 logic.js`);
      assert.strictEqual(
        count(new RegExp(`function ${fn}\\(`, 'g')), 0, `index.html 不应再定义 ${fn}`);
    }
    // 两口径收益合计单一来源：报头副行与收益摘要都改走 sumAssetIncomes（逐资产展示值的
    // 表格行/图表切片仍各自 calcAssetIncome，属合法用途不在此约束）
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sumAssetIncomes\(/);
    for (const fn of ['renderMasthead', 'renderIncomeTab']) {
      // 压测叠加后经 assetsInView() 取资产（多一层是刻意的：派生读数不得各自读 state.assets）
      assert.match(fnSource(fn), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sumAssetIncomes\(assetsInView\(\)\)/, `${fn} 应使用 sumAssetIncomes(assetsInView())`);
    }
  });

  test('消费月份列表单一来源 expenseMonths，两处内联 Set 推导消失', () => {
    assert.strictEqual(count(/new Set\(state\.expenses/g), 0, '月份推导不应再内联（一份防御一份不防御曾各自漂移）');
    assert.strictEqual(count(/(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?expenseMonths\(state\.expenses\)/g), 2, '月份筛选与趋势图下拉各一处');
    assert.strictEqual(count(/monthsWithExpenses\(state\.expenses\)/g), 1, '初始状态判断当前月有无记录走同一个别名');
  });

  test('三态排序状态机共用：两个 toggle 都走 nextSortState，内联循环分支不回潮', () => {
    for (const fn of ['toggleSort', 'toggleExpenseSort']) {
      assert.match(fnSource(fn), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?nextSortState\(/, `${fn} 应调用 nextSortState`);
      assert.doesNotMatch(fnSource(fn), /sortDir = 'desc'/, `${fn} 内联方向翻转应消失`);
    }
    assert.match(fnSource('toggleExpenseSort'), /expenseSortTouched/);
  });

  test('堆叠柱状图底座单一来源：两处 setOption 均展开 barChartBase/chartTooltipBase', () => {
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      const src = fnSource(fn);
      assert.match(src, /\.\.\.barChartBase\(/, `${fn} 应用 barChartBase 底座`);
      assert.match(src, /\.\.\.chartTooltipBase\(/, `${fn} 应用 chartTooltipBase 底座`);
    }
    assert.strictEqual(count(/grid: \{ left: '3%'/g), 1, 'axis/grid 样板只允许在 barChartBase 内定义一份');
  });

  test('快照对比默认基准单一来源 defaultCompareBaseMonth：默认最近两月，内联不重定义', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?defaultCompareBaseMonth\(/, '默认基准口径应在 logic.js');
    assert.match(fnSource('openCompareModal'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?defaultCompareBaseMonth\(sorted\)/, '接线从 logic.js 取默认基准');
    assert.strictEqual(count(/function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?defaultCompareBaseMonth\(/g), 0, 'index.html 不应再保留本地副本');
    const src = fnSource('openCompareModal');
    assert.doesNotMatch(src, /prevBase|prevTarget/, '不应再读取上次选择');
    assert.match(src, /baseSel\.value = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?defaultCompareBaseMonth\(sorted\)/, '起始月强制次新月');
    assert.match(src, /targetSel\.value = sorted\[sorted\.length - 1\]\.month/, '结束月强制最新月');
  });

  test('对比 hero 单一来源：两个对比弹窗都走 renderCompareHero，零变动文案只定义一次', () => {
    for (const fn of ['renderCompareTable', 'renderExpenseCompareTable']) {
      assert.match(fnSource(fn), /renderCompareHero\(/, `${fn} 应用 renderCompareHero`);
      assert.doesNotMatch(fnSource(fn), /±\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?formatCNY\(0\)\}/, `${fn} 不应再内联零变动渲染`);
    }
    assert.strictEqual(count(/±\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?formatCNY\(0\)\}/g), 1, '零变动 hero 文案单一来源');
    assert.match(html, /function renderCompareHero\(/);
  });

  test('对比表迷你量条/百分比单元格单一来源 cmpBar/cmpPctCell', () => {
    const src = fnSource('compareTableHtml');
    assert.match(src, /cmpBar\(/, '对比骨架应用 cmpBar');
    assert.match(src, /cmpPctCell\(/, '对比骨架应用 cmpPctCell');
    assert.doesNotMatch(src, /cmp-bar-track/, '不内联量条 HTML');
    for (const fn of ['renderCompareTable', 'renderExpenseCompareTable']) {
      assert.doesNotMatch(fnSource(fn), /cmp(Bar|PctCell)\(/, `${fn} 只交数据，不自己拼单元格`);
    }
    assert.strictEqual(count(/class="cmp-bar-track"/g), 1, '量条模板只出现在 cmpBar helper 一处（CSS 类定义不计）');
  });

  test('对比差额条以零线为轴：符号/半宽口径只有 logic.js 一处', () => {
    assert.ok(typeof L.ui.cmpDeltaBarModel === 'function', '双向条口径必须下沉 logic.js');
    const bar = fnSource('cmpBar');
    assert.match(bar, /ui\.cmpDeltaBarModel\(/, 'cmpBar 取纯函数结果，不自己算符号与宽度');
    assert.match(bar, /cmp-bar-axis/, '模板里要有一根零线');
    assert.match(bar, /cmp-bar-\$\{m\.side\}/, '条的涨跌侧由纯函数给的 side 决定');
    const logicOnly = logicSrc;
    assert.strictEqual((logicOnly.match(/function cmpDeltaBarModel/g) || []).length, 1, '纯函数只定义一处');
    assert.match(html, /\.cmp-bar-axis/, 'CSS 里定义零线');
  });

  test('趋势列表的环比 / 较平常各挂一根带符号小条，精确数字照旧留在行里', () => {
    const trend = fnSource('renderExpenseTrendList');
    assert.match(trend, /cmpMiniBar\(/, '趋势列表挂小条');
    assert.match(trend, /较平常/, '「较平常」精确读数不能丢');
    const mom = fnSource('momCompareHtml');
    assert.match(mom, /cmpMiniBar\(/, '环比一句也挂小条（资产/消费趋势共用）');
    assert.match(mom, /formatCNY\(m\.diff\)/, '环比精确金额照旧可见');
    assert.strictEqual(count(/function cmpMiniBar/g), 1, '小条模板单一来源');
  });

  test('双向条不新增页头读数 / 卡片 / 图表实例 / 外呼', () => {
    const header = html.match(/<header class="app-header"[\s\S]*?<\/header>/);
    assert.ok(header, '页头区块存在');
    assert.doesNotMatch(header[0], /cmp-bar|cmpMiniBar/, '页头不挂差额条');
    assert.strictEqual(count(/echarts\.init\(/g), 1, '不新增图表实例');
    assert.strictEqual((stripComments(js).match(/\bfetch\s*\(/g) || []).length, 1, '不新增外呼');
  });

  test('弹窗打开统一 openModal 与 closeModal 成对，散落的 display 赋值不回潮', () => {
    assert.match(html, /function openModal\(id\)/);
    assert.match(html, /function closeModal\(id\)/);
    // 计数前先刨掉 openModal/closeModal 自身的函数体：那里**必须**改 display（它就是实现），
    // 要抓的是「别处又冒出散落的赋值」——把实现本身也算违规会让这条契约自相矛盾。
    // 两个函数在文件里并不相邻，必须**各自**剥掉；拼在一起 split 会什么都删不掉（静默失效）。
    const outside = [fnSource('openModal'), fnSource('closeModal')].reduce((acc, src) => acc.split(src).join(''), html);
    assert.strictEqual(
      (outside.match(/modal\.style\.display = ''/g) || []).length, 0,
      '变量形式的弹窗打开应改走 openModal');
    assert.strictEqual(
      (outside.match(/document\.getElementById\('[a-z-]+-modal'\)\.style\.display = ''/g) || []).length, 0,
      '直接 getElementById 的弹窗打开应改走 openModal');
  });
});

describe('UI 接线契约：排序列头的可访问名', () => {
  test('方向必须写进 aria-label（aria-sort 在 role=button 上按规范未定义，读屏器收不到）', () => {
    const src = fnSource('updateSortIndicators');
    assert.match(src, /aria-label/, '必须把方向写进可访问名——那是真正到达读屏器的通道');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sortAriaLabel\(/, '取值必须走 logic.js 单一判据');
  });

  test('每次更新都要覆盖 aria-label（未排序时置空），否则方向会粘在上一次那列上', () => {
    const src = fnSource('updateSortIndicators');
    assert.match(src, /setAttribute\('aria-label'/, '必须每次 setAttribute，而不是只在选中时设');
  });
});

describe('UI 接线契约：便条的播报优先级', () => {
  test('播报档位必须在 toast() 里按类型动态写入（写死在容器上 = error 永远被排队）', () => {
    // 容器上留一个 polite 初值是对的（live region 得在加载时就存在，读屏器才会注册它），
    // 要守的是「每次便条都按类型改写档位」——否则 22 处 error 全都被排到用户下次操作之后。
    const src = fnSource('toast');
    assert.match(src, /setAttribute\('aria-live'/, 'toast() 必须把档位写到容器上（读屏器只认 live region 的档位，逐条设无效）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?toastLiveMode\(type\)/, '档位取值必须来自 logic.js 的单一判据');
  });

  test('播报档位走 logic.js toastLiveMode（不在页面里重写一份判据）', () => {
    const src = fnSource('toast');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?toastLiveMode\(/, 'toast() 必须复用 logic.js 的单一判据');
    assert.match(src, /aria-live/, '必须把档位真的写到 DOM 属性上');
  });
});

describe('UI 接线契约：Tab 滑动指示条', () => {
  test('每条 Tab 栏里必须有且只有一个滑动指示条元素', () => {
    assert.match(html, /class="tab-bar[^"]*"[^>]*>\s*<span class="tab-indicator"/, '指示条必须是 tab-bar 的第一个子元素（单一元素）');
    assert.doesNotMatch(html, /\.tab-btn\.active \{[^}]*border-bottom-color/, 'active 按钮不得再用 border-bottom 画黄条（那是跳变）');
    assert.match(html, /\.tab-indicator \{/, '指示条要有自己的样式（位置由 JS 写变量，过渡在 CSS）');
    assert.match(html, /transition:[^;]*transform/, '指示条必须有 transform 过渡（否则还是跳变）');
  });

  test('switchTab 必须移动指示条，且位置换算只有一处', () => {
    const src = fnSource('switchTab');
    assert.match(src, /moveTabIndicator\(/, 'switchTab 要调用 moveTabIndicator');
    assert.match(html, /function moveTabIndicator\(/, '位置换算收在单一函数里');
    // 换算必须用 offsetLeft（布局事实），不得用下标 × 固定宽度（窄屏/长标题会错位）
    const src2 = fnSource('moveTabIndicator');
    assert.match(src2, /offsetLeft/, '指示条位置必须按 offsetLeft 实测，不得按下标估算');
    assert.match(src2, /offsetWidth/, '宽度也要实测（按钮文字长短不一）');
  });

  test('窗口尺寸变化时指示条要重新对位（否则换窗口后黄条指错 tab）', () => {
    // resize 里必须重新对位：从 active 按钮读当前 tab（唯一真相），调 moveTabIndicator。
    const resizeFn = (() => {
      const clean = stripComments(html);
      const key = "addEventListener('resize'";
      const segs = clean.split(key).slice(1);
      return segs.find((s) => s.slice(0, 600).includes('moveTabIndicator') && s.includes('.tab-btn.active')) || '';
    })();
    assert.ok(resizeFn, '要有 resize 监听');
    assert.ok(resizeFn.includes('moveTabIndicator'), 'resize 要重新对位（否则换窗口后黄条指错 tab）');
    assert.ok(resizeFn.includes('.tab-btn.active'), '当前 tab 从 active 按钮读（唯一真相，不另养状态变量）');
    assert.ok(resizeFn.includes("querySelector(sel + ' .tab-btn.active')".replace(/\\s+/g, ' ')) || resizeFn.includes("sel + ' .tab-btn.active'"), 'active 按钮选择器允许由 sel 拼接');
  });

  test('prefers-reduced-motion 下指示条/入场动画直接到位', () => {
    assert.match(
      html,
      /\[id\^="tab-"\]\.enter \{ animation: none; \}/,
      '减动效块要覆盖指示条与 Tab 入场动画（delay/时长一起归零）');
  });
});

describe('UI 接线契约：弹窗焦点管理（aria-modal 的兑现）', () => {
  const openSrc = fnSource('openModal');
  const closeSrc = fnSource('closeModal');

  test('打开弹窗必须把焦点搬进去（否则焦点还在背后的触发按钮上，首下 Tab 就走出弹窗）', () => {
    assert.match(openSrc, /\.focus\(/, 'openModal 必须真的 focus 第一个可聚焦元素');
    // 搬焦点会顺带滚动：正文自带 overflow-y:auto，焦点落在页脚那个「关闭」按钮上时
    // 长表一开就滚到底（标题被推出视野）。故必须带 preventScroll，且不能改成「先 focus 再滚回顶」。
    assert.match(openSrc, /\.focus\(\{ preventScroll: true \}\)/, 'openModal 聚焦时必须 preventScroll（否则长表弹窗一开就停在最底部）');
    assert.doesNotMatch(stripComments(openSrc), /scrollTop\s*=\s*0/, '不要用「聚焦后再滚回顶」代替 preventScroll：焦点仍在底部，一按 Tab 又被拽回去');
    assert.match(html, /function modalFocusables\(/, '「弹窗内可聚焦元素」须有单一实现（打开与陷阱共用一份）');
  });

  test('设置弹窗打开时焦点落在标题，不落进「导出密钥」输入框', () => {
    // 用户反馈：一开设置就进密码框，既容易误输入，焦点环也在面板中部。
    assert.match(
      html,
      /id="settings-modal-title"[^>]*data-autofocus[^>]*tabindex="-1"/,
      '标题要能被程序聚焦，并声明为打开时的落点');
    assert.match(
      openSrc,
      /querySelector\('\[data-autofocus\]'\)/,
      'openModal 要认「打开时焦点落这里」的声明');
    assert.ok(
      openSrc.indexOf('data-autofocus') < openSrc.indexOf('const firstField'),
      '标题落点必须排在「第一个输入框」之前');
    assert.match(
      html,
      /id="pass-input"[^>]*data-no-autofocus/,
      '导出密钥输入框不得再被自动聚焦（防御：其它入口也不该一开就进密码框）');
  });

  test('关闭弹窗要把焦点还回打开它的元素（不是掉到 body 从头 Tab）', () => {
    assert.match(closeSrc, /__modalReturnFocus/, 'closeModal 必须消费记住的返回焦点');
    assert.match(openSrc, /__modalReturnFocus\.push\(document\.activeElement\)/, '打开时要先记住当前焦点（入栈，确认框会叠在别的弹窗上）');
    // 栈与「开着的弹窗」一一对应：对已开着的弹窗再 openModal 会多入一层、对已关着的
    // closeModal 会多弹一层，两者都会让返回焦点错位（实测：先关下层再关上层，焦点掉到 body）。
    assert.match(openSrc, /display === 'none'\) __modalReturnFocus\.push/, '重复打开不得重复入栈');
    assert.match(closeSrc, /if \(!wasOpen\) return;/, '关一个本来就关着的弹窗不得出栈');
  });

  test('「最上层弹窗」只有一个判据：打开时挪到 body 末尾，ESC / Tab 陷阱 / 命中都读它', () => {
    // 遮罩的 z-index 完全相同，谁在上面只由 DOM 次序决定。确认框在 DOM 里排在好几个弹窗之前，
    // 叠上去时会被整个盖住（点击穿透、ESC 关错层）。故打开时挪到末尾，且「最上层」不各算一遍。
    assert.match(openSrc, /document\.body\.appendChild\(modal\)/, 'openModal 必须把弹窗挪到 body 末尾（DOM 次序 = 叠放次序）');
    assert.match(html, /function topModal\(/, '「最上层弹窗」须有单一实现');
    assert.match(html, /function openModalStack\(/, '「哪些弹窗开着」须与 topModal 同源');
    const escBlock = blockFrom(html, "if (e.key !== 'Escape') return;", '});');
    const tabBlock = blockFrom(html, "if (e.key !== 'Tab') return;", '});');
    assert.match(escBlock, /topModal\(\)/, 'ESC 必须按 topModal 判定（不能自己再数一遍 DOM 次序）');
    assert.match(tabBlock, /topModal\(\)/, 'Tab 陷阱必须按 topModal 判定');
    const withoutTopHelpers = html
      .replace(/function openModalStack[\s\S]*?\n}/, '')
      .replace(/function topModal[\s\S]*?\n}/, '');
    assert.doesNotMatch(withoutTopHelpers, /open\[open\.length - 1\]/,
      '「最后一个开着的弹窗」不得在别处重算（各写一份必然漂移）');
  });

  test('Tab 陷阱接线存在，且判据走 logic.js trapFocus（不在页面里重写一份）', () => {
    assert.match(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?trapFocus\(/, 'Tab 陷阱必须复用 logic.js 的纯函数');
    assert.match(html, /e\.key !== 'Tab'/, '必须拦截 Tab 键');
    assert.match(stripComments(html), /e\.shiftKey/, 'Shift+Tab 反方向要一并接管（只做正向 = 往回一按就逃出去）');
  });

  test('所有隐藏弹窗的路径都走 closeModal：否则焦点管理被绕过（只改 display 而不还焦点）', () => {
    const escBlock = blockFrom(html, "if (e.key !== 'Escape') return;", '});');
    assert.doesNotMatch(escBlock, /top\.style\.display = 'none'/, 'ESC 关弹窗必须走 closeModal（否则焦点不还）');
    assert.match(escBlock, /closeModal\(top\.id\)|confirmCancel\(\)/, 'ESC 应统一走 closeModal / confirmCancel');

    const overlayBlock = blockFrom(html, '__modalMouseDownTarget = e.target', '__modalMouseDownTarget = null');
    assert.doesNotMatch(overlayBlock, /e\.target\.style\.display = 'none'/, '遮罩点击关弹窗必须走 closeModal');
  });
});

describe('UI 接线契约：logic.js 导出清单与筛选同步时序', () => {
  const logic = logicSrc;

  test('导出清单按域分组：每个名字只属于一个域，域内不重复', () => {
    const api = require('../logic.js');
    const domains = Object.keys(api);
    assert.deepStrictEqual(
      domains.slice().sort(),
      ['annualize', 'backup', 'category', 'chartData', 'color', 'date', 'demo', 'expense', 'i18n', 'income', 'migrate', 'money', 'monthGrid', 'motion', 'receipt', 'snapshot', 'stress', 'text', 'ui', 'vault'],
      '域清单：新增域要在这里显式登记（防编辑残留悄悄多一个袋子）'
    );
    const seen = new Map();
    for (const d of domains) {
      assert.strictEqual(typeof api[d], 'object', d + ' 应是一个域对象');
      const keys = Object.keys(api[d]);
      assert.strictEqual(new Set(keys).size, keys.length, d + ' 域内不得有重复条目');
      for (const k of keys) {
        assert.ok(!seen.has(k), k + ' 同时出现在 ' + seen.get(k) + ' 与 ' + d);
        seen.set(k, d);
      }
    }
    assert.ok(seen.size >= 100, '域内名字总数（实得 ' + seen.size + '）');
  });

  test('日期型下拉一律新的在上：月份 option 的 map 必须挂在 monthsDesc 上', () => {
    const lines = html.split('\n').filter((l) => l.includes('date.monthLabel(m)') && l.includes('<option'));
    assert.ok(lines.length >= 4, `应扫到月份 option 的每一处构建（实得 ${lines.length}）`);
    const bad = lines.filter((l) => !l.includes('date.monthsDesc('));
    assert.deepStrictEqual(bad, [], '未经 monthsDesc 的月份列表：' + bad.map((l) => l.trim().slice(0, 80)).join(' | '));
  });

  test('下拉选项内容没变就不碰 DOM（搜索每按一键不该换掉无关控件）', () => {
    // 消费记录搜索框的 oninput 直接调 renderExpenses，而它开头会重建月份/标签下拉：
    // 每个字符都替换一遍 option 元素，展开中的下拉会被打断（实测按键后 option 全部换新）。
    assert.match(html, /function setSelectOptions\(/, '「内容变了才写」须有单一实现');
    for (const fn of ['fillMonthSelect', 'fillCategorySelect', 'populateExpenseTagFilter']) {
      assert.match(fnSource(fn), /setSelectOptions\(/, `${fn} 必须走同一个写入口`);
    }
    assert.doesNotMatch(stripComments(fnSource('fillMonthSelect')), /sel\.innerHTML =/, '不得绕过守卫直接写 innerHTML');
    assert.doesNotMatch(stripComments(fnSource('fillCategorySelect')), /sel\.innerHTML =/, '不得绕过守卫直接写 innerHTML');
  });

  test('筛选状态只有一个所有者：页面不留镜像变量，也不从控件读回', () => {
    // 旧实现把筛选值镜像成四个模块级变量，并在 renderExpenses 里按「先重建下拉、再读值」的
    // 次序同步——那个次序写过反一次（下拉=全部时间 / 空态=该月无记录）。现在状态由 logic.js
    // 的纯函数持有：控件只写、渲染只读，失效值在归一阶段丢弃。
    const src = stripComments(html);
    for (const v of ['expenseMonthFilter', 'expenseSearch', 'expenseTagCatFilter', 'expenseTagFilter']) {
      assert.doesNotMatch(src, new RegExp(`\\b${v}\\b`), `镜像变量 ${v} 不得回潮`);
    }
    const render = stripComments(fnSource('renderExpenses'));
    assert.match(render, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?normalizeExpenseFilters\(/, '失效筛选值必须由纯函数归一（不靠重建与读取的先后）');
    assert.match(render, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?expenseListView\(/, '结果、生效维度与空态要从同一份视图派生');
    assert.doesNotMatch(render, /\.value\b/, 'renderExpenses 不得从控件读筛选值（控件只写）');
  });

  test('筛选控件只写：事件一律走 setExpenseFilter 单一写入端', () => {
    const h = (id) => `id="${id}"[^>]*on`;
    assert.match(html, new RegExp(h('expense-month-filter') + `change="setExpenseFilter\\(\\{\\s*month\\s*:\\s*this\\.value\\s*\\}\\)"`), '月份下拉走 setExpenseFilter');
    assert.match(html, new RegExp(h('expense-tag-filter') + `change="setExpenseFilter\\(\\{\\s*tag\\s*:\\s*this\\.value\\s*\\}\\)"`), '标签下拉走 setExpenseFilter');
    assert.match(html, new RegExp(h('expense-search') + `input="setExpenseFilter\\(\\{\\s*query\\s*:\\s*this\\.value\\s*\\}\\)"`), '搜索框走 setExpenseFilter');
    assert.strictEqual(count(/on(change|input)="renderExpenses\(\)"/g), 0, '控件不得直接调 renderExpenses 自己读值');
  });
});

describe('UI 接线契约：明细弹窗与表格骨架（唯一主人）', () => {
  test('表格骨架唯一：表头行与数据行只在 detailTableHtml 里生成', () => {
    assert.strictEqual(count(/function detailTableHtml/), 1, '骨架只定义一处');
    for (const fn of ['viewSnapshot', 'viewHistorySegment', 'viewExpenseMonth', 'viewExpenseSegment',
      'renderCompareTable', 'renderExpenseCompareTable']) {
      assert.doesNotMatch(
        stripComments(fnSource(fn)),
        /asset-row/,
        `${fn} 不再自己拼表格骨架（表头/行/列宽都归骨架）`
      );
    }
  });

  test('明细弹窗的标题与正文只被写入一次（补丁行不回潮）', () => {
    // 曾有四行「把标题改回来」的补丁：viewSnapshot 写完标题，兄弟函数又改掉它
    assert.strictEqual(count(/snapshot-modal-title'\)\.textContent/g), 1, '标题只有一个写入点');
    assert.strictEqual(count(/snapshot-detail-content'\)\.innerHTML/g), 1, '正文只有一个写入点');
    for (const fn of ['viewSnapshot', 'viewHistorySegment', 'viewExpenseMonth', 'viewExpenseSegment']) {
      assert.match(stripComments(fnSource(fn)), /openDetail\(/, `${fn} 必须走唯一入口`);
      assert.doesNotMatch(stripComments(fnSource(fn)), /openModal\(/, `${fn} 不得自己开弹窗`);
    }
  });

  test('两张对比表共用一套列与行结构（列名只在骨架里出现一次）', () => {
    assert.strictEqual(count(/function compareTableHtml/), 1, '对比骨架只定义一处');
    for (const fn of ['renderCompareTable', 'renderExpenseCompareTable']) {
      assert.match(stripComments(fnSource(fn)), /compareTableHtml\(/, `${fn} 必须走共用骨架`);
      assert.doesNotMatch(stripComments(fnSource(fn)), /<div/, `${fn} 不再自己写表格标记`);
    }
    // 两个侧别的措辞不同（期初/期末 vs 期初月/期末月），作为参数传入，骨架里不写死
    assert.match(fnSource('renderCompareTable'), /periods: \[i18n\.t\('期初'\), i18n\.t\('期末'\)\]/, '资产侧措辞');
    assert.match(fnSource('renderExpenseCompareTable'), /i18n\.t\('期初月'\)/, '消费侧措辞（指定月基准）');
    assert.match(fnSource('renderExpenseCompareTable'), /i18n\.t\('平常'\)/, '消费侧措辞（近 12 个月基准）');
    assert.strictEqual(count(/变动 %/g), 2, '注释一处 + 骨架一处');
  });
});

describe('UI 接线契约：消费「较平常」基线（近 12 个月同长度窗口）', () => {
  test('三个纯函数是唯一来源，页面不自己算窗口/差额/排序', () => {
    for (const fn of ['expenseNormalTotals', 'expenseNormalTagRows', 'expenseNormalChanges']) {
      assert.ok(typeof require('../logic.js').expense[fn] === 'function', fn + ' 必须下沉 logic.js');
    }
    assert.match(fnSource('renderExpenseTrendList'), /expense\.expenseNormalTotals\(/, '趋势列表读纯函数');
    assert.match(fnSource('renderExpenseCompareTable'), /expense\.expenseNormalTagRows\(/, '对比表读纯函数');
    assert.match(fnSource('renderExpenseTrendList'), /\.diff\b/, '趋势行的「较平常」差额直接取纯函数结果，不另算一遍');
    assert.doesNotMatch(fnSource('renderExpenseCompareTable'), /state\.expenses\.filter\(/, '对比表不在页面里另算窗口');
  });

  test('涨跌榜排序只有一处：对比表与趋势列表都走同一个排序函数', () => {
    const compare = fnSource('renderExpenseCompareTable');
    assert.match(compare, /expense\.expenseNormalChanges\(/, '对比表按纯函数排序');
    assert.doesNotMatch(compare, /\.sort\(\(a, b\)/, '对比表不再自己写排序比较器');
  });

  test('基准选项挂进现有对比弹窗，不另开卡片/弹窗/页头读数', () => {
    assert.match(html, /id="exp-compare-base-mode"/, '基准模式下拉在原有对比弹窗里');
    assert.match(fnSource('renderExpenseCompareTable'), /exp-compare-base-mode/, '渲染读得到基准模式');
    assert.doesNotMatch(html, /id="exp-normal-card"/, '不新增「平常」卡片');
    assert.doesNotMatch(html, /id="exp-normal-modal"/, '不新增「平常」弹窗');
    const header = html.match(/<header class="app-header"[\s\S]*?<\/header>/);
    assert.ok(header, '页头区块存在');
    assert.doesNotMatch(header[0], /较平常|平常/, '页头不报消费合计/平常');
  });

  test('「较平常」不碰网络：运行时仍只有取汇率那一处 fetch', () => {
    const clean = stripComments(js);
    assert.strictEqual((clean.match(/\bfetch\s*\(/g) || []).length, 1, '新增读数不得带外呼');
    const block = fnSource('renderExpenseTrendList') + fnSource('renderExpenseCompareTable');
    assert.doesNotMatch(block, /fetch\s*\(|XMLHttpRequest|sendBeacon/, '两处渲染不碰网络');
  });
});

describe('UI 接线契约：堆叠柱下钻与图例记忆', () => {
  test('点击下钻接线单一来源 wireStackedBarDrill，两图各接一次，内联 chart.on(click) 不回潮', () => {
    assert.match(html, /function wireStackedBarDrill\(/, 'helper 定义存在');
    assert.strictEqual(count(/wireStackedBarDrill\(/g), 3, '定义一处 + 两图 init 各一次');
    assert.strictEqual(count(/\.on\('click'/g), 2, 'chart click 仅限 wireStackedBarDrill / wireSunburstDrill 内各一处');
    const inlineOn = html.split(String.fromCharCode(10))
      .filter((l) => l.indexOf(".on('click'") >= 0 && !/^\s*(\/\/|\*)/.test(l))
      .filter((l) => l.indexOf("chartObj.on('click'") < 0);
    assert.deepStrictEqual(inlineOn, [], 'render* 里不得内联注册 click');
    assert.match(fnSource('renderHistoryChart'), /viewHistorySegment/, '历史图下钻到资产构成');
    assert.match(fnSource('renderExpenseTrendChart'), /viewExpenseSegment/, '趋势图下钻到消费记录');
  });

  test('下钻弹窗复用 snapshot-modal 且走唯一明细入口', () => {
    for (const fn of ['viewHistorySegment', 'viewExpenseSegment']) {
      const src = fnSource(fn);
      assert.match(src, /openDetail\(/, fn + ' 走明细弹窗唯一入口');
      assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pctStr\(/, fn + ' 占比列与图表 tooltip 同一来源');
    }
    assert.match(fnSource('openDetail'), /openModal\('snapshot-modal'\)/, '唯一入口开快照弹窗');
    assert.strictEqual(count(/snapshot-modal-title..\.textContent/g), 1, '标题只有一个写入点（快照/月明细/两个下钻四用途共用）');
  });

  test('图例选中态经 legendselectchanged 记忆、经 pruneLegendSelected 回灌 barChartBase', () => {
    assert.strictEqual(count(/\.on\('legendselectchanged'/g), 2, '两图各注册一次（注释字样不计）');
    assert.match(
      fnSource('renderHistoryChart'),
      /barChartBase\(th, dates, historyChartMode, sortedTags, (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneLegendSelected\(histLegendSel/,
      '历史图重绘时回灌图例选中态');
    assert.match(
      fnSource('renderExpenseTrendChart'),
      /barChartBase\(th, dates, expenseTrendMode, sortedTags, (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneLegendSelected\(trendLegendSel/,
      '趋势图重绘时回灌图例选中态');
  });
});

describe('UI 接线契约：收益覆盖标尺（分子口径可切换的预期月消费覆盖率）', () => {
  const logic = logicSrc;

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
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?coveragePct\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderCoverageMeter');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?coveragePct\(/, '渲染层从 logic.js 取口径');
    assert.doesNotMatch(src, /\/\s*expectation\s*\*|cashMonthly\s*\/\s*expectation/, '覆盖率算式不得在内联脚本重写');
  });

  test('差额口径单一来源 incomeGap：盈余/缺口叙事收归覆盖标尺，报头不再重复渲染', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?incomeGap\(/);
    // 覆盖标尺（renderCoverageMeter）是盈余/缺口的唯一渲染出口, 口径单一来源
    assert.match(fnSource('renderCoverageMeter'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?incomeGap\(/, '覆盖标尺应使用 incomeGap 取盈余/缺口口径');
    assert.doesNotMatch(fnSource('renderCoverageMeter'), /cashMonthly\s*-\s*expectation/, '覆盖标尺不再内联差额计算');
    // 报头副行只保留收入金额与预期锚点, 盈余/缺口差额已收归覆盖标尺（不调用 incomeGap、不内联差额取整）
    // 双负向断言前先给一条正向锚点：否则提取到别的/空的块时，两条「不再…」都会假绿
    assert.match(fnSource('renderMasthead'), /masthead-sub/, '报头副行由 renderMasthead 渲染（证明拿到的是真实现）');
    assert.doesNotMatch(fnSource('renderMasthead'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?incomeGap\(/, '报头不再调用 incomeGap 渲染差额');
    assert.doesNotMatch(fnSource('renderMasthead'), /Math\.round\(Math\.abs\(gap\)\)/, '报头不再内联差额取整');
  });

  test('renderCoverageMeter 定义一次、renderIncomeTab 调用一次（骨架静态只同步宽度文案，自足计算两口径合计）', () => {
    assert.strictEqual(count(/\brenderCoverageMeter\(/g), 3, '定义一处 + renderIncomeTab 调用一处 + setCoverageMode 回调一处');
    assert.match(fnSource('renderIncomeTab'), /renderCoverageMeter\(\)/);
    assert.match(fnSource('renderCoverageMeter'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sumAssetIncomes\(assetsInView\(\)\)/, '两口径合计与报头同源（且同经压测叠加入口），不重复聚合');
  });

  test('分子口径切换：默认总收益、双按钮各接线一次、走 setSegMode 单一来源', () => {
    assert.match(html, /let coverageMode = 'total';/, '默认总收益口径（含增值宽松口径），与 incomeChartMode 同惯例不持久化');
    assert.match(html, /id="cov-mode-total"[^>]*class="seg-btn active"/, '初始 seg 高亮须与默认总收益口径一致');
    assert.strictEqual(count(/onclick="setCoverageMode\('cash'\)"/g), 1);
    assert.strictEqual(count(/onclick="setCoverageMode\('total'\)"/g), 1);
    assert.match(fnSource('setCoverageMode'), /setSegMode\('cov-mode-cash', 'cov-mode-total'/);
    assert.match(fnSource('renderCoverageMeter'), /coverageMode === 'cash' && cashMonthly <= 0/);
  });

  test('预期保存/清除只重绘列表（图表与报头的收尾交给 syncDerivedReads）', () => {
    for (const fn of ['saveExpectation', 'clearExpectation']) {
      const src = fnSource(fn);
      assert.match(src, /renderAssets\(\)/, `${fn} 重绘列表（收尾走 syncDerivedReads）`);
      assert.doesNotMatch(src, /renderIncomeTab\(|renderExpenseTrendChart\(/,
        `${fn} 不得自己挑图表重绘（收尾在 syncDerivedReads → refreshVisibleCharts）`);
    }
  });

  test('达标印徽复用 mo-badge.up 语义色（与目标净资产「已达成」同语言），不另造徽章样式', () => {
    assert.match(fnSource('renderCoverageMeter'), /mo-badge up/);
  });

  test('缺口还需本金：算式下沉 logic.js coverShortfallPrincipal，内联不重写外推', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?coverShortfallPrincipal\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderCoverageMeter');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?coverShortfallPrincipal\(numerator, expectation,/, '按当前口径传入分子与预期，口径切换/滑块/预期改动自动跟随');
    assert.doesNotMatch(src, /\* 12 \* [\w.]+ \//, '缺口×12÷年化不得在内联脚本重写');
  });

  test('有息本金单一来源 ratedPrincipalCNY：页脚加权平均利率与缺口外推同基地，内联不重复聚合', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?ratedPrincipalCNY\(/, '决策纯函数在 logic.js');
    const src = fnSource('renderIncomeTab');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?ratedPrincipalCNY\(assetsInView\(\)\)/, '页脚基地须走 logic.js 同一口径（经压测叠加入口）');
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
    assert.match(src, /if \(!ok\)/, 'Tips 只在未覆盖分支拼装');
    assert.match(src, /shortfallTipHtml\(need,/, '渲染层只调唯一拼装处');
    assert.doesNotMatch(tip, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?formatCNY\(gap|\* 12 \*/, '外推算式不得在展示层重写（口径在 logic.js）');
    assert.doesNotMatch(tip, /annual \/ principal|\/ principal \* 100/, '实际年化不得在展示层重算');
    assert.strictEqual(count(/cov-shortfall-tip/g) <= 2, true, '气泡 id 只应出现在拼装处, 不另开通道');
  });
});

describe('UI 接线契约：备份落盘统一走确认框 + 系统文件窗口', () => {
  test('DOMContentLoaded 捕获 fetchRates() 的 promise 并传给 maybeAutoBackup', () => {
    assert.match(html, /const ratePromise = fetchRates\(\);/, '应捕获本次启动的汇率拉取 promise 复用同一笔请求');
    assert.match(html, /maybeAutoBackup\(ratePromise\);/, '应把 promise 传给 maybeAutoBackup（而非无参调用）');
    assert.strictEqual(count(/maybeAutoBackup\(\)/g), 0, '不应再有无参调用，否则会抢在汇率刷新前导出拿到过期汇率');
  });

  test('maybeAutoBackup 先 await 汇率与句柄恢复，再弹确认框；确认框自己不落盘', () => {
    assert.match(html, /async function maybeAutoBackup\(ratePromise\)/, '应为 async 且接收 ratePromise 参数');
    const src = stripComments(fnSource('maybeAutoBackup'));
    assert.match(src, /if \(ratePromise\) await ratePromise;/, '弹框前应 await 汇率拉取完成（含空值守卫）');
    assert.match(src, /await backupDirReady/, '弹框前应等 IDB 里的目录句柄恢复（确认文案要写目录名）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backupPromptText\(/, '确认框文案走 logic.js 单一来源');
    assert.match(src, /showConfirm\(/, '自动备份必须先弹确认框：定时器没有用户手势，直接开文件窗口必然失败');
    assert.ok(src.indexOf('await ratePromise') < src.indexOf('showConfirm('),
      'await ratePromise 必须排在弹框之前，否则确认框里的文件名/汇率是旧的');
    assert.doesNotMatch(src, /showSaveFilePicker|downloadBackupJSON|backupJSONText/,
      '确认框只负责问：落盘必须交给 saveBackupToFile 唯一出口');
    const cb = src.slice(src.indexOf('showConfirm('));
    const cbBody = cb.slice(cb.indexOf('=> {'), cb.indexOf('}, prompt.title'));
    assert.ok(cbBody.length > 0, '确认回调体必须能被定位（改形会让这条断言静默失效）');
    assert.doesNotMatch(cbBody, /await|async/, '确认回调里不得有 await：手势会被消耗，文件窗口打不开');
  });

  test('确认框与文件窗口之间不得有 await：一旦 await，用户手势就被消耗、窗口打不开', () => {
    const src = stripComments(fnSource('saveBackupToFile'));
    const pickerIdx = src.indexOf('window.showSaveFilePicker(');
    assert.ok(pickerIdx > 0, '必须直接调 showSaveFilePicker（仅 Chromium 支持；其余走 fallback）');
    const head = src.slice(src.indexOf('try {'), pickerIdx);
    assert.strictEqual((head.match(/await/g) || []).length, 1,
      'showSaveFilePicker 之前不得先 await 别的：自动备份的唯一手势来自确认框那次点击');
    assert.match(head, /await\s*$/, '唯一那个 await 必须紧贴打开窗口这一句');
    assert.match(src.slice(pickerIdx), /await writeFileHandleText\(/,
      '窗口确认后才写内容（close() 成功才算写完）');
    assert.match(src, /if \(backupDirHandle\) opts\.startIn = backupDirHandle/, '文件窗口必须从设置里选的目录打开');
    assert.doesNotMatch(src, /startIn:\s*(null|undefined)/, 'startIn 只能是句柄或不存在：传 null 会被当成枚举值直接 TypeError');
  });

  test('汇率拉取失败时不阻塞备份：await 包在独立 try/catch 且 catch 不 return，弹框在后续独立 try 块', () => {
    const src = fnSource('maybeAutoBackup');
    assert.doesNotMatch(src, /catch \(e\) \{[^}]*return/, 'await 的 catch 不应 return 中断备份');
    const awaitCatchEnd = src.indexOf('用缓存汇率继续备份');
    const confirmIdx = src.indexOf('showConfirm(');
    assert.ok(awaitCatchEnd > 0 && confirmIdx > awaitCatchEnd, '弹框应在 await 的 catch 之后，失败仍继续');
  });
});

describe('UI 接线契约：导入/导出（纯原始格式 + 迁移兜底共用一套）', () => {
  test('导出内容走 logic.js backupJSONText（唯一来源，剥离快照加工字段 totalCNY）', () => {
    // 两条落盘路径（系统文件窗口 / 回退下载）必须落盘同一份内容：
    // 生成逻辑下沉 logic.js，页面不得再各写一份深拷贝 + delete
    const fnSrc = logicSrc.match(/function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backupJSONText\([\s\S]*?\n {2}\}/);
    assert.ok(fnSrc, 'logic.js 必须有 backupJSONText');
    assert.match(stripComments(fnSrc[0]), /delete sn\.totalCNY/,
      '导出前必须逐条剥离 totalCNY：它的唯一真相是 assets × currencyRates，写进文件后一旦导入端不重算就会留下与资产脱节的旧值');
    const text = stripComments(fnSource('backupFileText'));
    assert.match(text, /backup\.backupJSONText\(state\)/, 'backupFileText 是落盘内容的唯一出口，必须从这里取内容');
    assert.match(text, /vault\.encryptBackup\(/, '设了密钥必须走 logic.js 的加密实现');
    for (const fn of ['downloadBackupJSON', 'saveBackupToFile']) {
      assert.match(stripComments(fnSource(fn)), /await backupFileText\(\)/,
        `${fn} 必须用同一份内容（加密与否由 backupFileText 一处决定）`);
    }
    assert.match(stripComments(fnSource('exportDataAsync')), /saveBackupToFile\(/,
      '手动导出必须汇到同一落盘出口，不得另写一份写盘');
  });

  test('导入合并后必须走 migrateState()（与 loadState 共用同一套迁移/兜底）', () => {
    const src = stripComments(fnSource('confirmImport'));
    const mergeIdx = src.indexOf('state = { ...state, ...data }');
    const migrateIdx = src.indexOf('migrateState()');
    assert.ok(mergeIdx >= 0, '导入应先合并顶层字段');
    assert.ok(migrateIdx > mergeIdx,
      '合并后必须调用 migrateState（旧 expectedRate、旧快照格式、缺字段、孤儿标签的兜底唯一入口）');
  });

  test('密钥不进 state：备份加密的密钥只存页面自己的 localStorage 键，随备份导出就等于换掉对方的密钥', () => {
    assert.strictEqual(count(/state\.[\w.]*pass/i), 0, '密钥不得挂在 state 上（state 整份会被导入覆盖、且整份被导出）');
    const fresh = stripComments(fnSource('freshAppState'));
    assert.doesNotMatch(fresh, /pass/i, 'state 初始值不得出现密钥字段');
    assert.match(html, /const PASS_KEY = '/, '密钥的落点是独立的 localStorage 键');
    assert.match(stripComments(fnSource('exportPassphrase')), /localStorage\.getItem\(PASS_KEY\)/);
  });

  test('加密备份的导入：先问密钥、解不开原地重试，确认与迁移仍走 confirmImport', () => {
    const src = stripComments(fnSource('importData'));
    assert.match(src, /vault\.isEncryptedBackup\(data\)/, '先认信封，再决定要不要问密钥');
    assert.ok(src.indexOf('isEncryptedBackup') < src.indexOf('confirmImport'), '加密的文件必须先过密钥，不能直接覆盖');
    assert.match(src, /confirmImport\(data\)/, '明文备份与旧文件照旧：直接进确认');
    const submit = stripComments(fnSource('submitPassImportAsync'));
    assert.match(submit, /vault\.decryptBackup\(/, '解密走 logic.js');
    assert.match(submit, /confirmImport\(data\)/, '解开后与明文导入同一条路');
    assert.match(submit, /catch[\s\S]*pendingImportEnv/, '密钥不对就原地重试（保留待导入的文件）');
    assert.strictEqual(count(/onclick="submitPassImportAsync/g), 0);
    assert.match(html, /onclick="submitPassImport\(\)"/);
  });

  test('导出失败要说得出是哪一步（权限 / 占用 / 空间 / 不能加密），收尾不算进失败', () => {
    const src = stripComments(fnSource('saveBackupToFile'));
    assert.match(src, /backup\.exportErrorNotice\(e, stage\)/, '失败文案按阶段分口径，不只报「请重试」');
    assert.match(src, /stage = 'write'/, '要记录卡在哪一步');
    assert.match(src, /console\.error\(/, '控制台要留真相（一句反馈就能定位）');
    assert.ok(src.indexOf('applyBackupResult(') > src.indexOf('finally'),
      'applyBackupResult 必须在 try 之外：文件已写好之后出错不得报成导出失败');
    const dl = stripComments(fnSource('exportViaDownload'));
    assert.match(dl, /try \{[\s\S]*catch/, '回退下载也不能让异常静默消失（之前是未处理的 rejection，用户什么都看不到）');
    assert.match(dl, /backup\.exportErrorNotice\(e/);
  });

  test('设置里的导出密钥：保存 / 清除两个入口，清除要二次确认', () => {
    assert.strictEqual(count(/id="pass-input"/g), 1);
    assert.match(html, /id="pass-input"[^>]*aria-label="导出密钥"/);
    assert.match(html, /onclick="saveExportPassphrase\(\)"/);
    assert.match(html, /id="pass-clear"[^>]*onclick="clearExportPassphrase\(\)"/);
    assert.match(stripComments(fnSource('saveExportPassphrase')), /vault\.passphraseTooShort\(/,
      '短密钥在保存这一步就挡（不得存进去再在下一次导出才发现）');
    const sync = stripComments(fnSource('syncBackupControls'));
    assert.match(sync, /passInput\.hidden = !editing/, '已设置后输入框收起');
    assert.match(sync, /passChange\.hidden = editing/, '更换密钥只在已设置时出现');
    assert.match(html, /id="pass-change"[^>]*onclick="startPassEdit\(\)"/);
  });
});

describe('UI 接线契约：备份文件夹', () => {
  test('设置弹窗必须有备份文件夹行，且回显走 syncBackupControls', () => {
    assert.strictEqual(count(/id="settings-backup-dir-note"/g), 1);
    assert.match(html, /id="backup-dir-choose"[^>]*onclick="chooseBackupDir\(\)"/);
    assert.match(html, /id="backup-dir-clear"[^>]*onclick="clearBackupDir\(\)"/);
    const src = stripComments(fnSource('syncBackupControls'));
    assert.match(src, /settings-backup-dir-note/);
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backupDirNoteText\(/);
    assert.match(src, /backup-dir-clear/);
  });

  test('onclick 只挂同步入口，异步实现单独命名（内联名收集器不认 async function）', () => {
    assert.match(html, /function chooseBackupDir\(\) \{ chooseBackupDirAsync\(\); \}/);
    assert.match(html, /function exportData\(\) \{\n {2}syncBackupControls\(\);[\s\S]*?exportDataAsync\(\);/);
    const clearDir = fnSource('clearBackupDir');
    assert.match(clearDir, /showConfirm\(/, '清除备份文件夹也要二次确认');
    assert.match(clearDir, /clearBackupDirAsync\(\)/, '确认后才走异步实现');
    assert.strictEqual(count(/onclick="chooseBackupDirAsync/g), 0);
    assert.strictEqual(count(/onclick="clearBackupDirAsync/g), 0);
    assert.strictEqual(count(/onclick="exportDataAsync/g), 0);
  });

  test('目录句柄只进 IndexedDB，绝不进 state / 导出 JSON', () => {
    assert.match(html, /const BACKUP_DB = 'wealth-backup'/);
    assert.match(html, /idbSetBackupDir\(/);
    assert.match(html, /idbGetBackupDir\(/);
    assert.strictEqual(count(/state\.backup\.dir/g), 0, '句柄不可序列化，不得写进 state');
    const fresh = stripComments(fnSource('freshAppState'));
    assert.doesNotMatch(fresh, /dir|handle|folder/i, 'state 初始值不得出现目录字段');
  });

  test('旧入口不回潮：静默写目录 / 权限申请 / 回退下载节流全部移除', () => {
    const dead = /writeAutoBackupToDir|dirHasFile|firstAvailableBackupName|writeDirFile|queryDirPermission|requestDirPermission|normalizeDirPermission|lastAutoDownload/;
    assert.doesNotMatch(stripComments(html), dead, 'index.html 不得再出现静默写目录/权限申请/下载节流');
    assert.doesNotMatch(stripComments(logicSrc), dead, 'logic.js 不得再出现静默写目录/权限申请/下载节流');
  });

  test('只有确认写入才记「已备份」：所有落盘路径统一走 applyBackupResult', () => {
    const apply = stripComments(fnSource('applyBackupResult'));
    assert.match(apply, /if \(notice\.recordBackup\) markBackedUp\(today\)/);
    assert.match(apply, /syncBackupControls\(\)/);
    for (const fn of ['exportViaDownload', 'saveBackupToFile']) {
      const src = stripComments(fnSource(fn));
      assert.match(src, /applyBackupResult\(/, `${fn} 的结果必须交统一口径判定`);
      assert.doesNotMatch(src, /markBackedUp\(/, `${fn} 不得绕过 applyBackupResult 直接记成功`);
    }
    assert.match(stripComments(fnSource('maybeAutoBackup')), /saveBackupToFile\(/,
      '自动路径必须汇到同一落盘出口');
    assert.match(stripComments(fnSource('exportDataAsync')), /saveBackupToFile\(/,
      '手动路径必须汇到同一落盘出口');
  });
});

describe('UI 接线契约：汇率刷新链路（绕过 CDN 缓存 / 恢复可见重拉 / 图表跟随重绘）', () => {
  test('汇率请求强制 cache: no-store（CDN 对 @latest 带 7 天 max-age，默认复用拿不到新值）', () => {
    const src = stripComments(fnSource('fetchRates'));
    assert.match(src, /fetch\('https:\/\/[^']*cny\.json',\s*\{\s*cache:\s*'no-store'\s*\}\)/,
      '汇率 fetch 必须显式 no-store：否则普通刷新复用缓存，只有强刷才更新');
  });

  test('bfcache 恢复（pageshow 且 persisted）要重拉汇率并重渲染', () => {
    const block = blockFrom(html, "addEventListener('pageshow'", '});');
    assert.match(block, /event\.persisted/, '只在 bfcache 恢复时触发（普通首载由 DOMContentLoaded 覆盖）');
    assert.match(block, /fetchRates\(\)/, '重拉汇率——DOMContentLoaded 不会再触发，否则一直停在冻结时的旧值');
    assert.match(block, /renderAll\(\)/, '总资产/报头随新汇率重渲染');
  });

  test('切回本页：仅汇率过期（超 1 小时）才重拉，避免频繁切标签重复请求', () => {
    const block = blockFrom(html, "addEventListener('visibilitychange'", '});');
    assert.match(block, /visibilityState === 'visible'/, '只在切回可见时判定');
    assert.match(block, /fetchedAt/, '按上次拉取时间判过期');
    assert.match(block, /fetchRates\(\)/, '过期才重拉（与 pageshow 同一出口）');
    assert.match(block, /renderAll\(\)/);
  });

  test('refreshVisibleCharts：五个 Tab 都带可见性守卫，且是汇率/主题的共用重绘入口', () => {
    const src = stripComments(fnSource('refreshVisibleCharts'));
    for (const tab of ['tab-chart', 'tab-history', 'tab-income', 'tab-expense-chart', 'tab-expense-trend']) {
      assert.match(src, new RegExp(`getElementById\\('${tab}'\\)\\.style\\.display !== 'none'\\) render`),
        `${tab} 的重绘分支必须带可见性守卫（隐藏容器 echarts 0 尺寸初始化，进去就是空白）`);
    }
    assert.match(stripComments(fnSource('fetchRates')), /renderAssets\(\)/, '汇率刷新后资产与派生读数一起重算');
    assert.doesNotMatch(stripComments(fnSource('fetchRates')), /refreshVisibleCharts\(\)/,
      '不重复拉图表（renderAssets 收尾已经做过，多拉一次就是两遍 setOption）');
  });

  test('图表懒渲染排下一帧并验可见性（固定 setTimeout 会把图画进已隐藏的容器）', () => {
    // 实测：切到「资产分布」后 100ms 内切回去，setTimeout 到点仍在 display:none 的容器上
    // echarts.init，实例尺寸 0×0。五个图表 Tab 与快照保存/删除共用同一个入口。
    const src = fnSource('switchTab');
    assert.doesNotMatch(src, /setTimeout\(/, 'switchTab 不得再用固定睡眠排渲染');
    for (const fn of ['renderChart', 'renderHistoryChart', 'renderIncomeTab', 'renderExpenseChart', 'renderExpenseTrendChart']) {
      assert.match(src, new RegExp(`afterTabPaint\([^)]*${fn}\)`), `${fn} 应走 afterTabPaint`);
    }
    const helper = fnSource('afterTabPaint');
    assert.match(helper, /requestAnimationFrame\(/, '排下一帧（让浏览器先完成布局）');
    assert.match(helper, /style\.display === 'none'\) return/, '跑之前必须再确认该 Tab 仍可见');
    for (const fn of ['confirmSnapshot', 'deleteSnapshot']) {
      assert.match(fnSource(fn), /afterTabPaint\('history'/, `${fn} 重绘历史净值也要走同一入口`);
    }
    assert.match(stripComments(fnSource('setTheme')), /renderAll\(\)/, '主题切换重绘（收尾 syncDerivedReads 把可见图表也按新主题重绘）');
  });
});

describe('UI 接线契约：Flatpickr 日期选择器', () => {
  test('Flatpickr CDN 三件套引入（CSS + JS + 中文 locale）', () => {
    assert.match(html, /flatpickr\/dist\/flatpickr\.min\.css/, 'Flatpickr CSS 存在');
    assert.match(html, /flatpickr\/dist\/l10n\/zh\.js/, '中文 locale 存在');
    assert.strictEqual(count(/flatpickr\.min\.js/g), 0, '不应引用 flatpickr.min.js（主包已含）');
  });

  test('DOMContentLoaded 初始化 Flatpickr，locale 跟界面语言 + 周一开头 + disableMobile', () => {
    assert.match(html, /flatpickr\('#expense-date'/, '应初始化 #expense-date');
    const initBlock = html.match(/flatpickr\('#expense-date'[\s\S]*?\}\);/);
    assert.ok(initBlock, '初始化块存在');
    assert.match(initBlock[0], /locale: i18n\.flatpickrLocale\(flatpickr\.l10ns, state\.lang\)/, 'locale 走 helper（周一起点与月份图同轴，语言跟界面走）');
    assert.match(fnSource('syncFlatpickrLocale'), /i18n\.flatpickrLocale\(flatpickr\.l10ns, state\.lang\)/, '换语言后重建 locale 也走同一个 helper（否则又回到周日开头）');
    assert.match(initBlock[0], /disableMobile: true/, '移动端禁用原生日历，统一桌面样式');
  });

  test('setExpenseDate 是日期设置的单一来源，openExpenseModal 不再内联 _flatpickr 检测', () => {
    assert.match(html, /function setExpenseDate\(/, 'helper 定义存在');
    const helperSrc = fnSource('setExpenseDate');
    assert.match(helperSrc, /\._flatpickr/, 'helper 内部检测 Flatpickr 实例');
    assert.match(helperSrc, /fp\.setDate\(/, 'helper 走 fp.setDate');
    const modalSrc = fnSource('openExpenseModal');
    assert.doesNotMatch(modalSrc, /\._flatpickr/, 'openExpenseModal 不应内联 _flatpickr 检测');
    assert.match(modalSrc, /setExpenseDate\(/, 'openExpenseModal 应调用 setExpenseDate');
    assert.doesNotMatch(modalSrc, /expense-date\]\.value =/, 'openExpenseModal 不应直接赋值 expense-date.value');
  });

  test('今天与选中的样式只用 CSS 变量，不硬编码色值', () => {
    assert.doesNotMatch(html, /\.flatpickr-day\.today[^}]*#[0-9a-f]{3,6}/i, '今天不应硬编码色值');
    assert.doesNotMatch(html, /\.flatpickr-day\.selected[^}]*#[0-9a-f]{3,6}/i, '选中不应硬编码色值');
    assert.match(html, /\.flatpickr-day\.today[^}]*var\(--accent-strong\)/, '今天的圈走主强调 --accent-strong');
    assert.match(html, /\.flatpickr-day\.selected[^}]*var\(--secondary\)/, '选中的环走次强调 --secondary');
  });
});

describe('UI 接线契约：逻辑接口按域暴露（不再平铺 119 个全局名）', () => {
  test('页面里的逻辑调用一律带域名前缀', () => {
    // 平铺的全局名是这次重构要消掉的东西：页面与测试都经域访问，
    // 以后新增函数先想清楚属于哪个域，而不是继续往一袋名字里丢。
    for (const n of ['esc', 'money2', 'formatCNY', 'toCNY', 'monthLabel', 'pctStr', 'migrateState', 'applyExpenseFilters']) {
      assert.doesNotMatch(
        html,
        new RegExp('(?<![A-Za-z0-9_$.])' + n + '\\s*\\('),
        n + ' 不得裸调用（应写成 <域>.' + n + '）'
      );
    }
  });

  test('页面用到的域都真的被用到（域清单不是摆设）', () => {
    const api = require('../logic.js');
    for (const d of Object.keys(api)) {
      assert.match(html, new RegExp('(?<![A-Za-z0-9_$.])' + d + '\.'), '页面应经 ' + d + ' 域取逻辑');
    }
  });
});

describe('UI 接线契约：消费标签筛选（单下拉分组，类别作不可选分组头）', () => {
  test('只保留一个标签筛选下拉，级联双下拉与旧切换函数不回潮', () => {
    assert.strictEqual(count(/id="expense-tag-filter"/g), 1, '标签筛选下拉应唯一');
    assert.strictEqual(count(/id="expense-tag-cat-filter"/g), 0, '旧「分类下拉」应移除');
    assert.strictEqual(count(/onExpenseTagCatChange/g), 0, '级联切换处理函数应移除');
    assert.strictEqual(count(/populateExpenseTagCatFilter/g), 0, '分类下拉填充函数应移除');
  });

  test('populateExpenseTagFilter 用 optgroup 按分类分组，类别不可选、标签才是选项', () => {
    const src = fnSource('populateExpenseTagFilter');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?expenseTagFilterGroups\(state\.expenseCategories\)/, '分组结构来自 logic.js 纯函数');
    assert.match(src, /<optgroup label="\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(g\.name\)\}"/, '类别渲染为 optgroup 分组头（不可选），分类名经 esc 转义');
    assert.match(src, /全部标签/, '首项为「全部标签」');
    assert.match(src, /g\.tags\.map/, '可选项只来自分类 tags（组头本身不产出 option）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?tagFilterValue\(g\.id, t\)/, '选项 value 走 logic.js 编码（分类+标签）');
    assert.match(src, /（暂无标签）/, '空分类给 disabled 占位项，保住分组可见');
  });

  test('编码在页面、解码与有效性判定在 logic.js（页面不自拼口径）', () => {
    assert.match(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?tagFilterValue\(g\.id, t\)/, '生成选项时用 tagFilterValue 编码');
    for (const fn of ['tagFilterValue', 'parseTagFilter', 'expenseTagFilterGroups', 'hasTagFilterOption']) {
      assert.doesNotMatch(html, new RegExp(`function ${fn}`), `${fn} 不得在 index.html 重定义`);
    }
    assert.doesNotMatch(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?parseTagFilter\(/, '解码只在 logic.js：页面拿到的已是解码后的「分类 / 标签」');
    assert.doesNotMatch(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?hasTagFilterOption\(/, '有效性判定只在 logic.js（归一阶段）');
  });

  test('筛选状态只有一个所有者：setExpenseFilter 写入，syncExpenseControls 回写', () => {
    const decl = html.match(/let expenseFilters = \{[^}]*\}/);
    assert.ok(decl, '状态只有一处声明');
    assert.match(decl[0], /month/, '含月份');
    assert.match(decl[0], /tag/, '含标签');
    assert.match(decl[0], /query/, '含关键词');

    assert.match(
      fnSource('setExpenseFilter'),
      /expenseFilters = Object\.assign\(\{\}, expenseFilters, patch\)/,
      '写入端合并 patch（不改原对象，便于单测断言纯性）'
    );
    const sync = fnSource('syncExpenseControls');
    for (const id of ['expense-month-filter', 'expense-tag-filter', 'expense-search']) {
      assert.match(sync, new RegExp(`set\\('${id}'`), `${id} 必须由回写点写入`);
    }
    assert.match(sync, /el\.value !== v/, '值相同时不写：搜索框每次按键都重跑渲染，写回会顶飞光标');
  });

  test('renderExpenses 三步：归一 → 重建选项 → 回写控件（全程不读控件）', () => {
    const src = fnSource('renderExpenses');
    const norm = src.indexOf('normalizeExpenseFilters(');
    const build = src.indexOf('populateExpenseMonthFilter()');
    const sync = src.indexOf('syncExpenseControls()');
    assert.ok(norm >= 0 && build >= 0 && sync >= 0, '三步都存在');
    assert.ok(norm < build, '先归一：删记录 / 删分类后失效的筛选值必须在使用前丢掉');
    assert.ok(build < sync, '先重建选项再回写选中值（否则写进的是旧选项集）');
  });

  test('筛选判据不在页面：三段叠加与空态全部来自 expenseListView', () => {
    const src = fnSource('renderExpenses');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?expenseListView\(state\.expenses, expenseFilters, state\.expenseCategories\)/, '结果与空态同源');
    assert.match(src, /const filtered = view\.rows;/, '页面只消费行数据');
    assert.doesNotMatch(src, /state\.expenses\.filter\(/, '页面不再自己拼筛选链');
    assert.match(src, /view\.emptyKind/, '空态判据来自 view');
    assert.match(src, /view\.hasFilter/, '「清除筛选」显隐来自 view');
    assert.match(src, /view\.active\.tag/, '生效维度来自 view');
    assert.match(src, /view\.active\.month/, '生效维度来自 view');
  });

  test('两个清空入口都走同一写入端，不再直接改控件', () => {
    assert.match(fnSource('clearExpenseFilters'), /setExpenseFilter\(\{ month: '', tag: '', query: '', gridMonth: '' \}\)/, '四项一起归零（月份图也回到全部时间）');
    assert.match(fnSource('clearExpenseSearch'), /setExpenseFilter\(\{ query: '' \}\)/, '只清搜索词');
    assert.match(fnSource('clearExpenseSearch'), /\.focus\(\)/, '清完把焦点交回输入框');
    for (const fn of ['clearExpenseFilters', 'clearExpenseSearch']) {
      assert.doesNotMatch(stripComments(fnSource(fn)), /\.value\s*=/, `${fn} 不得直接改控件值`);
    }
  });

  test('空态提示按生效维度拼接：搜索 > 标签 > 月份', () => {
    const src = fnSource('renderExpenses');
    const at = src.indexOf('const filterParts = []');
    assert.ok(at >= 0, '空态文案用 filterParts 数组拼接');
    const seg = src.slice(at, src.indexOf('titleEl.textContent = filterParts.length'));
    const q = seg.indexOf('view.active.query');
    const tag = seg.indexOf('view.active.tag');
    const month = seg.indexOf('view.active.month');
    assert.ok(q >= 0 && tag >= 0 && month >= 0, '三个维度都进文案');
    assert.ok(q < tag && tag < month, '文案顺序：搜索 > 标签 > 月份');
  });

  test('合计行标签包含筛选维度：月份 + 标签 + 搜索任意组合', () => {
    const src = fnSource('renderExpenses');
    assert.match(src, /if \(view\.active\.month\) parts\.push/, '合计含月份维度');
    assert.match(src, /if \(view\.active\.tag\) parts\.push/, '合计含标签维度');
    assert.match(src, /\[parts\.join\(' '\), i18n\.t\('\{n\} 笔'/, '范围与笔数/合计拼在同一行');
    assert.match(src, /expense-table-summary/, '写进明细那一行，而不是页头');
    assert.doesNotMatch(src, /expense-total-line/, '页头不再报合计（它会与月份图那个月对不上）');
  });

  test('标签筛选下拉与月份下拉、搜索框同级排列在筛选栏内', () => {
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

  test('月份图与明细同一份月份：切一边就是切两边', () => {
    assert.strictEqual(count(/let monthGridView\b/g), 0, '月份图不许再存第二份月份');
    assert.match(fnSource('renderMonthGrid'), /expenseFilters\.gridMonth/, '月份图读的是筛选状态');
    assert.match(fnSource('shiftMonthGrid'), /setExpenseFilter\(\{\s*gridMonth:/, '左右箭头走唯一写入端');
    assert.match(fnSource('setExpenseFilter'), /gridMonth = patch\.month/, '明细下拉反过来带动月份图');
    const render = fnSource('renderExpenses');
    assert.match(render, /expenseFilters\.month = expenseFilters\.gridMonth/, '每次重绘由同一份状态派生明细月份');
    assert.match(render, /expenseFilters\.gridMonth = gridMonth/, '归一函数只返回三个维度，视图态要留着');
    assert.match(fnSource('populateExpenseMonthFilter'), /gridMonth/, '月份图翻到的空月也要出现在下拉里');
    assert.match(fnSource('exportMonthReceipt'), /expenseFilters\.gridMonth/, '整月小票跟着月份图那个月走');
  });
});

describe('UI 接线契约：消费月份筛选默认当月', () => {
  test('初始筛选状态：月份取当月，标签与关键词留空', () => {
    const decl = html.match(/let expenseFilters = \{[^}]*\}/);
    assert.ok(decl, '状态只有一处声明');
    assert.match(decl[0], /tag:\s*''/, '标签不设默认');
    assert.match(decl[0], /query:\s*''/, '关键词不设默认');
    const init = fnSource('initDefaultExpenseMonth');
    assert.match(init, /date\.getCurrentMonth\(\)/, '默认当月用本地月口径（不经 UTC）');
    assert.match(init, /monthsWithExpenses\(state\.expenses\)/, '当月无记录时回落「全部时间」');
    assert.match(init, /defaultExpenseMonthDone/, '只判一次，人工选过的月份不被顶掉');
    assert.match(fnSource('renderExpenses'), /initDefaultExpenseMonth\(\)/, '存档加载后、首屏渲染前才定默认值');
  });

  test('记到筛选之外的月份：筛选跟过去，别让「消费已记录」配一个纹丝不动的列表', () => {
    const src = fnSource('saveExpense');
    assert.match(src, /expenseFilters\.month\s*&&/, '只在已按月筛选时跟随；「全部时间」不擅自收窄');
    assert.match(src, /setExpenseFilter\(\{\s*month\b/, '跟随也走唯一写入端');
    assert.match(src, /\.slice\(0, 7\)/, '按记录的月份比较与写入');
    const saved = src.indexOf('saveState()');
    const follow = src.indexOf('setExpenseFilter(');
    assert.ok(saved >= 0 && follow > saved, '先落盘再跟随：归一要看得见这条新记录，否则当月无记录会被回落成「全部时间」');
  });
});

describe('UI 接线契约：分类管理回车添加标签', () => {
  test('新增标签输入框回车即添加，且 IME 组字中回车不误提交', () => {
    // id 由「前缀 + 分类 id」拼成，两者都可能来自导入的 JSON：属性里必须转义
    const input = html.match(/<input type="text" id="\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(cfg\.newTagPrefix \+ cat\.id\)\}"[^>]*>/);
    assert.ok(input, '分类卡片的「新增标签」输入框模板存在');
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
    assert.strictEqual(count(/\$\{addTagCall\}/g), 2, '输入框回车与「添加」按钮各引用一次');
    assert.match(html, /<button onclick="\$\{addTagCall\}"[^>]*>\$\{i18n\.t\('添加'\)\}<\/button>/, '按钮仍保留（鼠标路径）');
  });

  test('addTag 重绘后把焦点交回同分类新输入框，不再写已脱离文档的旧 input', () => {
    const src = fnSource('addTag');
    assert.match(src, /const next = document\.getElementById\(cfg\.newTagPrefix \+ catId\)/);
    assert.match(src, /next\.focus\(\)/, '焦点交回新输入框才能连击回车连续添加');
    assert.doesNotMatch(src, /input\.value = ''/, '旧 input 已随 renderCategoryCards 重绘脱离文档，赋值是死代码');
    const rerender = src.indexOf('renderCategoryCards(side)');
    const refocus = src.indexOf('const next =');
    assert.ok(rerender >= 0 && refocus > rerender, '必须先重绘再取新输入框，否则焦点落在即将被替换的旧节点');
  });

  test('资产/消费两侧的回车与按钮都收敛到 addTag 单一实现', () => {
    assert.strictEqual(count(/function addTag\(/g), 1, '只有一处实现');
    assert.strictEqual(count(/addTag\('\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?jsAttr\(side\)\}'/g), 1, '两侧共用同一调用表达式（侧别在生成期拼）');
    assert.doesNotMatch(html, /addExpenseTag|addTagGeneric/, '孪生与一级转发不回潮');
  });

  test('标签（逗号分隔）由 category.parseTagInput 解析，页面不另写一份 split', () => {
    const src = fnSource('saveCategory');
    assert.match(src, /const tags = category\.parseTagInput\(tagsStr\)/, '唯一解析入口');
    assert.doesNotMatch(src, /split\(\/\[,\uff0c\]\//, '逗号解析不得在页面里重写一份（去重会跟着漏）');
  });
});

describe('UI 接线契约：分类 CRUD 入口减半（侧别由调用现场提供）', () => {
  test('六个操作各一个入口：Expense* 孪生、一级转发、*Generic 后缀全部消失', () => {
    for (const dead of ['openExpenseCategoryModal', 'saveExpenseCategory', 'editExpenseCategory',
      'deleteExpenseCategory', 'addExpenseTag', 'removeExpenseTag', 'editCategory',
      'renderExpenseCategories', 'renameExpenseTag']) {
      assert.doesNotMatch(html, new RegExp(`function ${dead}\\(`), `${dead} 应已删除`);
    }
    for (const live of ['openCategoryModal', 'saveCategory', 'deleteCategory', 'addTag', 'removeTag', 'renameTag']) {
      assert.strictEqual(count(new RegExp(`function ${live}\\(`, 'g')), 1, `${live} 只定义一处`);
    }
    assert.strictEqual(count(/function \w+Generic\(/g), 0, '*Generic 后缀不再需要：它就是实现');
  });

  test('侧别由调用现场提供：静态控件读 data-side，生成的处理器带字面量', () => {
    assert.match(html, /id="category-form" data-side="asset" onsubmit="saveCategory\(this\.dataset\.side, event\)"/, '资产侧表单');
    assert.match(html, /id="expense-category-form" data-side="expense" onsubmit="saveCategory\(this\.dataset\.side, event\)"/, '消费侧表单');
    assert.strictEqual(count(/onclick="openCategoryModal\(this\.dataset\.side\)"/g), 2, '两处「新增分类」按钮同形');
    const cards = fnSource('renderCategoryCards');
    for (const call of ['addTag', 'openCategoryModal', 'deleteCategory']) {
      assert.match(cards, new RegExp(`${call}\\('\\$\\{(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?jsAttr\\(side\\)\\}'`), `${call} 在生成期带侧别`);
    }
  });

  test('配置表只存数据与文案，不再存函数名', () => {
    const cfg = blockFrom(html, 'const CAT_SIDES = {', '\n};');
    for (const dead of ['removeTag:', 'addTag:', 'renameTag:', 'edit:', 'del:']) {
      assert.doesNotMatch(cfg, new RegExp(`\b${dead}`), `CAT_SIDES 不再存 ${dead}`);
    }
  });
});

describe('UI 接线契约：标签改名（迁移引用，不是清空）', () => {
  test('改名入口单一来源：胶囊只带 data-rename 侧别，交互只有 startTagRename 一份', () => {
    assert.strictEqual(count(/function startTagRename\(/g), 1, '就地重命名交互只定义一次');
    assert.strictEqual(count(/function renameTag\(/g), 1, '改名实现只定义一次');
    assert.strictEqual(count(/renameTag\(side, catId, oldName, newName\)/g), 1, '提交处只调一次（不再有第二条路径）');
    assert.match(fnSource('tagPillHtml'), /data-rename="\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?jsAttr\(opts\.renameSide/, '胶囊只带侧别，行为交给事件委托');
    assert.doesNotMatch(html, /renameExpenseTag|renameTag: '/, '孪生与配置里的函数名不回潮');
  });

  test('改名迁移引用而非删除：走 logic.js migrateTagRefs，读数卡选择同迁移，不出现 delete', () => {
    const src = fnSource('renameTag');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?migrateTagRefs\(cfg\.items\(\), catId, oldName, newName\)/, '引用迁移下沉纯函数');
    assert.doesNotMatch(src, /delete [\w.]*\.tags\[/, '改名不得按「旧名已失效」删除引用（那正是丢数据的路径）');
    assert.match(src, /state\.runwayTags = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?migrateRunwayTagRefs\(state\.runwayTags, catId, oldName, newName\)/,
      '读数卡所选标签同按名字引用，改名必须一并迁移');
    assert.doesNotMatch(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(/, '改名不需要 prune（新名已存在，选择不该被清）');
  });

  test('改名守卫与落盘：内置分类拒改、重名拒绝、随后保存并两处重绘', () => {
    const src = fnSource('renameTag');
    assert.match(src, /cat\.builtin/, '内置分类（货币类型）不可改名');
    assert.match(src, /cat\.tags\.includes\(newName\)/, '新名已存在则拒绝（不得产生同名双标签）');
    assert.match(src, /saveState\(\)/);
    assert.match(src, /renderCategoryCards\(side\)/, '分类卡片重绘（胶囊回到新名）');
    assert.match(src, /cfg\.renderItems\(\)/, '列表上的 pill 同步');
    assert.ok(src.indexOf('saveState()') < src.indexOf("toast(i18n.t('标签已重命名')"), '先落盘再提示');
  });

  test('就地重命名输入框：IME 组字守卫、Esc 取消、提交前防重入（blur 不再二次提交）', () => {
    const src = fnSource('startTagRename');
    assert.match(src, /e\.isComposing/, '中文输入法确认候选字也是回车，无守卫会在组字中途提交');
    assert.match(src, /Escape/, 'Esc 取消（重绘即还原）');
    assert.match(src, /blur/, '点开就走提交，与行内金额编辑同习惯');
    assert.match(src, /let done = false|let done=false/, '防重入标记');
    assert.match(src, /if \(done\) return/, 'Esc 取消后 input 被重绘移除会触发 blur，必须防二次提交');
    assert.strictEqual(count(/renameTag\(/g), 2, '定义一处 + startTagRename 提交处一处（不再有第二条改名路径）');
  });

  test('胶囊上不再有 ✎：长按胶囊即改名（长按状态机与资产入口同源）', () => {
    assert.strictEqual(count(/class="tag-pill"/g), 1, '胶囊模板只允许一处');
    const pill = fnSource('tagPillHtml');
    assert.doesNotMatch(pill, /pill-edit/, '不再渲染 ✎ 图标');
    assert.doesNotMatch(pill, /✎/, '标记里不得再出现 ✎ 字形');
    assert.strictEqual(count(/✎/g), 0, '全页不留 ✎（提示文案里也不要再指路到图标）');
    assert.match(pill, /data-rename/, '胶囊带改名所需的分类/标签数据');
    assert.match(html, /startTagPress\(/, '按下即开始计时');
    assert.match(html, /endTagPress\(/, '松手判定');
    assert.match(logicSrc, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pressDecision\(heldMs, threshold\)/, '判定参数化（不复制第二份阈值逻辑）');
    assert.match(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pressDecision\([^)]*TAG_PRESS_MS/, '改名用 TAG_PRESS_MS 那一档');
    assert.strictEqual(count(/renameTag\(/g), 2, '定义一处 + startTagRename 提交处一处（不再有第二条改名路径）');
    assert.match(pill, /tabindex="0"/, '胶囊可聚焦');
    assert.match(html, /onkeydown="[^"]*renameTagFromKey/, '键盘必须有一条直达改名的路');
  });

  test('长按满时长即进编辑态：先收尾再开输入框，中继态一并删掉', () => {
    const src = fnSource('startTagPress');
    // 旧实现满时长只加一枚 armed 就停下，用户还得自己松手（实测「松开才能编辑」）；
    // 现在与「进资产页」同一处置：满时长那一帧输入框就在原地出现
    const tick = src.slice(src.indexOf('const tick = ()'));
    assert.match(tick, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pressDecision\(held, (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?TAG_PRESS_MS\)/, '判定仍与资产入口同源，只换阈值');
    assert.ok(tick.indexOf('resetTagPress()') < tick.indexOf('startTagRename('),
      '先收尾再开输入框：不先收尾的话，紧跟的松手会让 endTagPress 再开一次（同一次长按两个入口）');
    assert.doesNotMatch(src, /add\('armed'\)/, '不再有「按满但还没进去」的中继态');
    assert.strictEqual(count(/\.tag-pill\.armed/g), 0, '中继态的样式随行为一起删（死样式不留）');
    // 样式表里也不得留「只减不加」的死规则：.mode-press.armed 从未被 add 过（只有 remove），
    // 留着会让下一个人以为按住时真有这一态
    assert.strictEqual(count(/\.mode-press\.armed/g), 0, '.mode-press.armed 是死规则（无任何代码 add）');
    assert.strictEqual(count(/var\(--tag-press/g), 0, '--tag-press 没有任何视觉出口，不得留在样式中');
    assert.match(fnSource('endTagPress'), /startTagRename\(/, '手势够长不该因为少一帧而作废');
  });

  test('内置分类整张卡片只读：不接改名与删除入口（写死的逻辑不摆可点的样子）', () => {
    // 币种代码是写死的逻辑：改名/删除在守卫里都会被拒绝，但拒绝路径只是 return，没人收走
    // 那个输入框——用户实测「长按内置的货币类型，然后点其他地方不能取消编辑」。
    const src = fnSource('renderCategoryCards');
    assert.match(src, /const tagOpts = cat\.builtin/, '只读由 builtin 单一判定');
    assert.match(src, /cat\.builtin[\s\S]{0,60}?\? \{ showKey: false \}/, '内置分类只给纯展示选项');
    assert.strictEqual(count(/removeSide: side/g), 1, '入口只在这一处按 builtin 收口');
    assert.match(src, /tagPillHtml\(cat, t, cfg\.colorFn, tagOpts\)/, '两侧共用同一份 opts（不各写一遍）');
    assert.strictEqual(count(/toast\(i18n\.t\('内置分类不可修改'\)/g), 3, '改名/删除/保存分类三处守卫不漏');
  });

  test('编辑框必须有归宿：拒绝路径只 return，收尾由 finish 兜住', () => {
    const src = fnSource('startTagRename');
    assert.match(src, /if \(input\.isConnected\) renderCategoryCards\(side\)/,
      'renameTag 的每条早退（分类已删/内置/重名/旧名过期）都不重绘，输入框必须有人放回去');
    assert.ok(src.indexOf('renameTag(') < src.indexOf('input\.isConnected'),
      '先提交再兜底：提交成功那条自己重绘，兜底就成空操作（不会重绘两遍）');
  });

  test('移除标签前先告知将清空的引用数：确认框与直接保存共用同一段 apply', () => {
    const src = fnSource('saveCategory');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?countTagRefs\(cfg\.items\(\), editId, removed\)/, '引用数走 logic.js 口径');
    assert.match(src, /showConfirm\(/, '有引用时先确认（静默清空归类会让分布/收益默默失真）');
    assert.strictEqual((src.match(/\bapply\b/g) || []).length, 3, '定义 + 直接调用 + 确认回调：保存只有一段，不得分叉');
    // 确认前不得写内存态：取消保存后内存必须与存档一致（否则后续任一 saveState 会把它悄悄落盘）
    assert.ok(src.indexOf('cats[idx] = ') > src.indexOf('const apply = () => {'), '分类赋值必须发生在 apply 内');
  });
});

describe('UI 接线契约：数据校验（缺标签一键/逐条补齐，资产/消费共用一套）', () => {
  test('两侧各一条校验条，各在自己的 Tab 内；写入点 renderTagCheckBar(side)', () => {
    assert.strictEqual(count(/id="tagcheck-bar-assets"/g), 1, '资产校验条容器唯一');
    assert.strictEqual(count(/id="tagcheck-bar-expense"/g), 1, '消费校验条容器唯一');
    const assetsTab = html.match(/id="tab-assets"[\s\S]*?<\/section>/);
    const expensesTab = html.match(/id="tab-expenses"[\s\S]*?<\/section>/);
    assert.ok(assetsTab && assetsTab[0].includes('id="tagcheck-bar-assets"'), '资产校验条在资产管理 Tab 内');
    assert.ok(expensesTab && expensesTab[0].includes('id="tagcheck-bar-expense"'), '消费校验条在消费记录 Tab 内');
    assert.match(html, /onclick="openTagCheck\('asset'\)"/, '资产校验条入口带侧别');
    assert.match(html, /onclick="openTagCheck\('expense'\)"/, '消费校验条入口带侧别');
    assert.strictEqual(count(/renderTagCheckBar\(/g), 3, '定义一处 + 两侧列表各调一次');
    assert.match(fnSource('renderAssets'), /renderTagCheckBar\('asset'\)/, '资产列表每次重绘同步校验条');
    assert.match(fnSource('renderExpenses'), /renderTagCheckBar\('expense'\)/, '消费列表每次重绘同步校验条');
    assert.match(fnSource('renderTagCheckBar'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?missingTagGroups\(cfg\.items\(\), cfg\.cats\(\)\)/, '计数走 logic.js 缺口口径，两侧同一实现');
  });

  test('面板唯一 #tagcheck-modal，打开走 openModal；四个入口共 5 处接线', () => {
    assert.strictEqual(count(/id="tagcheck-modal"/g), 1, '面板弹窗应唯一（资产/消费不各造一套）');
    assert.strictEqual(count(/id="tagcheck-groups"/g), 1);
    assert.strictEqual(count(/function openTagCheck\(/g), 1, '打开入口只定义一次');
    assert.match(fnSource('openTagCheck'), /openModal\('tagcheck-modal'\)/, '走通用弹窗路径');
    assert.strictEqual(count(/openTagCheck\(/g), 5, '所有入口都调同一入口函数');
  });

  test('面板按侧别取集合：不写死消费侧（state.expenses / expenseCategories）', () => {
    const pick = fnSource('onTagCheckPick');
    assert.match(pick, /tagCheckSide/, '侧别由会话状态给出（一个弹窗同时只服务一侧）');
    assert.doesNotMatch(pick, /state\.expenses\b/, '面板不得写死消费记录集合');
    assert.doesNotMatch(pick, /state\.expenseCategories/, '面板不得写死消费分类集合');
    const group = fnSource('tagCheckGroupHtml');
    assert.doesNotMatch(group, /state\.expenses\b/, '分组模板同样按侧别取集合');
    assert.match(group, /cfg\.colorFn/, '分类色走该侧的 catColor / expenseCatColor');
    assert.match(group, /cfg\.tagCheckMeta\(/, '行内摘要按侧别渲染（资产是名称，消费是日期/备注）');
  });

  test('chips 单一来源 tagPickerHtml：一键与逐条复用同一实现，第二套不回潮', () => {
    assert.strictEqual(count(/class="tag-choice"/g), 1, 'tag-choice 模板只允许存在一处');
    assert.strictEqual(count(/function tagPickerHtml\(/g), 1, 'chips 生成函数唯一');
    assert.strictEqual(count(/renderTagPicker/g), 0, '旧的就地渲染函数应保持重命名（面板需要拿 HTML 字符串复用）');
    assert.strictEqual(count(/tagPickerHtml\(/g), 5);
    assert.match(fnSource('tagCheckGroupHtml'), /tagPickerHtml\(/, '面板分组复用 chips 生成');
  });

  test('写标签只走 logic.js setTag/backfillTag，UI 层不直接给 tags 赋值', () => {
    const src = fnSource('onTagCheckPick');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?setTag\(/, '逐条点选走 setTag');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backfillTag\(/, '一键补齐走 backfillTag');
    assert.doesNotMatch(src, /\.tags\[/, '面板不得内联 tags 赋值（口径回潮即报错）');
    assert.strictEqual(count(/(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?setTag\(/g), 1, 'index.html 只在 onTagCheckPick 内调一次');
    assert.strictEqual(count(/(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?backfillTag\(/g), 1, 'index.html 只在 onTagCheckPick 内调一次');
  });

  test('落值后同步三处：saveState → 重绘列表与校验条 → 局部重绘该分组（不整面板重建）', () => {
    const src = fnSource('onTagCheckPick');
    assert.match(src, /saveState\(\)/);
    assert.match(src, /cfg\.renderItems\(\)/, '列表 pill 与校验条跟着刷新（两侧各自重绘自己的列表）');
    assert.match(src, /renderTagCheckGroup\(catId\)/, '只重绘命中分组，保留面板滚动位置');
    assert.match(fnSource('renderTagCheckGroup'), /outerHTML/, '局部替换而非重建整个面板');
    // 取消选择（再点已选项）不得改数据：按数据回滚盖印状态
    assert.match(src, /if \(!val\) \{ renderTagCheckGroup\(catId\); return; \}/, '取消选择只回滚 UI');
  });

  test('缺口口径 missingTagGroups 单一来源，四处调用；两侧都接线，资产侧说明快照口径', () => {
    assert.strictEqual(count(/(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?missingTagGroups\(/g), 4, '校验条 + 面板打开 + 分类卡片 + 新建后检测');
    const card = fnSource('renderCategoryCards');
    assert.match(card, /cfg\.tagCheck \? (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?missingTagGroups\(/, '卡片提示条必须带 cfg.tagCheck 闸门');
    // 侧别必须在**生成时**插值成字面量：onclick 是别名里的字符串，内联处理器在全局作用域求值，
    // 写成 `openTagCheck(side, …)` 会在点击时抛 ReferenceError（弹窗根本不开，且不报错到界面上）
    assert.match(card, /openTagCheck\('\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?jsAttr\(side\)\}', '\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?jsAttr\(cat\.id\)\}'\)/, '卡片入口聚焦该分类，侧别按生成时插值（不得把模板参数写进 onclick）');
    // 两侧各声明一次：资产与消费都接线（按侧块取，避免只靠同行注释辨认是哪一侧）
    assert.strictEqual(count(/tagCheck: (true|false)/g), 2);
    const assetCfg = html.match(/\n  asset: \{[\s\S]*?\n  \},/)[0];
    const expenseCfg = html.match(/\n  expense: \{[\s\S]*?\n  \},/)[0];
    assert.match(assetCfg, /tagCheck: true,/, '资产侧接线');
    assert.match(expenseCfg, /tagCheck: true,/, '消费侧接线');
    assert.strictEqual(count(/tagCheckHint: /g), 2, '面板顶部提示两侧各一条');
    assert.match(assetCfg, /tagCheckHint: [^,]*快照[^,]*/, '资产侧需说明「历史快照不随补」');
    assert.doesNotMatch(expenseCfg, /快照/, '消费侧没有快照概念，不照抄说明');
    assert.match(fnSource('openTagCheck'), /tagcheck-hint/, '提示文案由 openTagCheck 按侧别写入（不造两套弹窗）');
    assert.match(fnSource('tagCheckGroupHtml'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?isUntaggedItem\(/, '组内待归类计数与 logic.js 同口径');
  });

  test('新建分类后自动打开面板：带 createdId && cfg.tagCheck 守卫，且在关掉分类弹窗之后', () => {
    const src = fnSource('saveCategory');
    assert.match(src, /if \(createdId && cfg\.tagCheck\)/, '只有启用校验的一侧且确为新建时才打开');
    assert.match(src, /openTagCheck\(side, createdId\)/, '聚焦新建的那个分类，并带侧别');
    assert.ok(
      src.indexOf('closeModal(m.id)') < src.indexOf('openTagCheck(side, createdId)'),
      '必须先关分类弹窗再开面板，否则面板被压在下面');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?missingTagGroups\(cfg\.items\(\), cfg\.cats\(\)\)/, '无缺口不打扰（0 条时不弹）');
  });

  test('面板语言复用既有账本词汇：✓ 徽章走 mo-badge.up，不另造徽章样式', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /mo-badge up/, '补齐完成态复用既有印徽');
    assert.match(src, /已补齐/, '完成态文案');
    assert.strictEqual(count(/class="tagcheck-group"/g), 1, '分组模板只定义一处');
  });

  test('分组头分类名取 cat 而非会话对象 g（g 只有 catId/ids，用 g.name 会渲成空串）', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(cat\.name\)/, '分类名从分类对象取');
    assert.doesNotMatch(src, /\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(g\.name\)\}/, '会话对象没有 name 字段，插值即渲出空标题');
  });

  test('data-* 属性用 esc 转义而非 jsAttr（dataset 读回需与 state 的 id 字节一致）', () => {
    const src = fnSource('tagCheckGroupHtml');
    assert.match(src, /data-eid="\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(e\.id\)\}"/);
    assert.match(src, /data-catid="\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(g\.catId\)\}"/);
    assert.doesNotMatch(src, /data-(eid|catid)="\$\{jsAttr/,
      'jsAttr 会把反斜杠翻倍（为 JS 字符串设计），读回后 find(x => x.id === ...) 静默失配');
  });
});

/*
 * 压测（全局视图叠加）的接线契约
 * --------------------------------------------------------------------------
 * 压测改的是「读数」，不是「账本」——这条界线整个功能都靠它。口径（单维度/不叠加/未归类按 0%）
 * 在 logic.js stress 域（可单测，见 test/stress-logic-cases.js）；这里守的是**页面这一侧**：
 *   ① 派生读数必须经 assetsInView()，不得自己读 state.assets 再打折（散到十几处必然漂移，
 *      症状是同一页上「压测后的覆盖率」配着「压测前的月收益」）；
 *   ② 账本侧必须**读原值**（列表/行内编辑/表单/快照/导出/示例数据）——反过来也要钉子，
 *      否则日后有人「顺手统一」就把快照也打折了；
 *   ③ 标签改名要迁移情景、分类删除要让情景失效（与读数卡同一处置）。
 */
describe('UI 接线契约：压测（读数走叠加入口，账本读原值）', () => {
  const logic = logicSrc;

  test('口径在 logic.js：折算/归一/剪枝/未归类/加权跌幅/条文案都不在页面里重写', () => {
    for (const fn of ['effectiveAssets', 'stressKeepOf', 'stressDropOf', 'stressActive', 'pruneStress',
      'unclassifiedCNY', 'weightedDrop', 'normalizeKeepPct', 'keepOfEntry', 'migrateStressTagRefs',
      'stressDimensions', 'stressKeepRows', 'stressBarText']) {
      assert.match(logic, new RegExp('function ' + fn + '\\('), fn + ' 应在 logic.js');
      assert.strictEqual(count(new RegExp('function ' + fn + '\\s*\\(', 'g')), 0, 'index.html 不应再定义 ' + fn);
    }
    const src = fnSource('renderStressChrome') + fnSource('renderStressKeeps');
    assert.doesNotMatch(src, /\*\s*\(1\s*-/, '折算不得在页面内改写（走 stress.effectiveAssets）');
    assert.doesNotMatch(src, /100\s*-\s*(keep|r\.keep)/, '跌幅是剩余比例的补数，换算只在 logic.js stressDropOf');
    assert.doesNotMatch(src, /Math\.min\(100, Math\.max\(0,/, '跌幅钳制不得在页面内重写（走 logic.js）');
  });

  test('assetsInView 是派生读数的唯一入口（页面不得自己读 state.assets 再折算）', () => {
    assert.match(logic, /function effectiveAssets\(/, '叠加实现须在 logic.js');
    assert.match(fnSource('assetsInView'), /stress\.effectiveAssets\(state\.assets, state\.stress\)/);
    // 账本原值的读取也必须经名字：ledgerAssets() 就是「这里故意不打折」的判据
    assert.match(fnSource('ledgerAssets'), /return state\.assets;/);
    // 派生读数逐个点名：这些函数体内必须出现 assetsInView()
    for (const fn of ['totalAssetsCNY', 'renderMasthead', 'renderIncomeTab', 'renderCoverageMeter',
      'renderRunwayRow', 'renderRunwayPreview', 'renderChart', 'renderIncomeChart']) {
      assert.match(fnSource(fn), /assetsInView\(\)/, fn + ' 的资产必须经 assetsInView() 取（压测叠加的唯一入口）');
    }
    // **按调用点数**把守：每处允许的 state.assets 都写在这里，多一处就红。
    // 为什么不能只断言「出现过 assetsInView」：那样同一函数里改坏一处（收益表的加权利率基地）
    // 仍会绿——真实发生过的假绿。
    const allowed = {
      renderMasthead: 1,
      renderChart: 1,
    };
    for (const [fn, n] of Object.entries(allowed)) {
      assert.strictEqual((stripComments(fnSource(fn)).match(/state\.assets/g) || []).length, n,
        fn + ' 里 state.assets 的读取点应恰好 ' + n + ' 处（多一处就是漏接 assetsInView/ledgerAssets）');
    }
    for (const fn of ['totalAssetsCNY', 'renderIncomeTab', 'renderCoverageMeter',
      'renderRunwayRow', 'renderRunwayPreview', 'renderIncomeChart',
      'confirmSnapshot']) {
      assert.strictEqual((stripComments(fnSource(fn)).match(/state\.assets/g) || []).length, 0,
        fn + ' 不得直接读 state.assets（压测叠加只在 assetsInView 一处发生）');
    }
    // 反向：金额派生不得绕过这两个入口
    assert.strictEqual(
      count(/money\.toCNY\(state\.assets|sumAssetIncomes\(state\.assets/g), 0,
      '金额派生不得绕过 assetsInView()（旧入口回潮）');
  });

  test('账本侧读原值：列表/快照/导出/示例数据不得经 assetsInView（压测不写账本）', () => {
    for (const fn of ['renderAssets', 'openAssetModal', 'saveAsset']) {
      const src = fnSource(fn);
      assert.match(src, /state\.assets/, fn + ' 应读账本原值（压测只改读数）');
      assert.doesNotMatch(src, /assetsInView\(\)/, fn + ' 不得经压测叠加（那是读数层的事）');
    }
    // 快照存的是当时的资产事实：金额与资产都要**原值**。
    // 这条曾被 E2E 抓到：上一版只断言「不出现 assetsInView()」，而它经 totalAssetsCNY()
    // **间接**叠加（快照 totalCNY 存成了 200k 而非 250k）——断言假绿。
    const snap = fnSource('confirmSnapshot');
    assert.match(snap, /JSON\.parse\(JSON\.stringify\(ledgerAssets\(\)\)\)/, '快照资产取原值');
    assert.match(snap, /sumAmountCNY\(ledgerAssets\(\), state\.rates\)/, '快照金额取原值口径');
    assert.doesNotMatch(snap, /totalAssetsCNY\(/,
      '快照金额不得经 totalAssetsCNY（它已按压测叠加）');
    assert.doesNotMatch(snap, /assetsInView\(\)/, '快照不得经压测叠加');
  });

  test('标签改名迁移情景、分类删除让情景失效（改名 ≠ 删除，与读数卡同一处置）', () => {
    assert.match(fnSource('renameTag'), /stress\.migrateStressTagRefs\(state\.stress,/, '改名要迁移跌幅条目（否则情景静默失效）');
    assert.match(fnSource('deleteCategory'), /stress\.pruneStress\(state\.stress,/, '分类删除后要重新归一');
    const src = fnSource('renameTag');
    assert.match(src, /migrateRunwayTagRefs\(/, '读数卡与压测同处迁移（别只迁一个）');
  });

  test('落盘只存跌幅，不存任何金额（金额现算：汇率会变、账本会改）', () => {
    const src = fnSource('saveStress');
    assert.match(src, /stress\.pruneStress\(/, '保存走同一归一入口');
    assert.doesNotMatch(src, /amount|cny|totalCNY/i, '情景里不得出现金额字段');
    assert.doesNotMatch(src, /pct/i, '存的是剩余比例（keep），不是跌幅（pct）——字段名必须说真话');
    assert.match(fnSource('freshAppState'), /stress: null/, '新存档默认未启用');
    assert.match(logic, /state\.stress = pruneStress\(state\.stress, state\.categories\)/, '迁移兜底与导入共用同一归一');
    assert.match(logic, /function keepOfEntry\(/, '旧存档（跌幅语义 pct）的迁移只在 keepOfEntry 一处');
  });

  test('指示器两处同「生效」判据：资产侧条 + 页头印徽（后者保证消费模式下也看得见）', () => {
    assert.strictEqual(count(/id="stress-bar"/g), 1);
    assert.strictEqual(count(/id="stress-badge"/g), 1);
    assert.match(html, /id="tabs-assets"[\s\S]{0,400}?id="stress-bar"/, '条横贯全部资产 Tab（不只放报头旁）');
    assert.match(html, /id="stress-badge"[^>]*onclick="openStressModal\(/, '印徽点开同一弹窗');
    const src = fnSource('renderStressChrome');
    assert.match(src, /stress\.stressActive\(state\.stress\)/, '两处指示器共用同一「生效」判据');
    assert.match(src, /stress\.stressBarText\(/, '条的三态文案在 logic.js');
    assert.match(fnSource('renderAssets'), /syncDerivedReads\(\)/, '资产重绘时同步指示器');
  });

  test('弹窗：草稿制（取消不落库）、跌幅行复用既有滑块与胶囊模板', () => {
    assert.match(fnSource('openStressModal'), /_stressDraft = /, '打开只拷草稿');
    assert.match(fnSource('openStressModal'), /keeps: cur && cur\.catId === catId \? cur\.keeps/, '草稿拷的是剩余比例（存储与滑块同一语义）');
    assert.doesNotMatch(fnSource('openStressModal'), /state\.stress = /, '打开不得写状态');
    assert.match(fnSource('saveStress'), /state\.stress = next/, '保存才落 state');
    assert.match(fnSource('clearStress'), /state\.stress = null/, '清除立即回真实值');
    const keeps = fnSource('renderStressKeeps');
    assert.match(keeps, /class="scale-input"/, '复用比例尺滑块（与安全边际同一套）');
    assert.match(keeps, /class="scale-reading"/, '复用等宽读数（--fill 与滑块同步）');
    assert.match(keeps, /tagPillHtml\(cat, r\.tag, catColor\)/, '胶囊走唯一模板 tagPillHtml');
    assert.strictEqual(count(/class="tag-pill"/g), 1, '胶囊模板只允许一处');
    assert.match(fnSource('onStressKeepInput'), /setScaleValue\(/, '滑块填充走 setScaleValue 单一来源');
    assert.match(fnSource('fillStressDimensionSelect'), /stress\.stressDimensions\(state\.categories\)/);
  });

  test('弹窗有名字、说明进 ? 气泡、口径句在条与弹窗各一处', () => {
    assert.match(html, /id="stress-modal"[^>]*aria-labelledby="stress-modal-title"/);
    assert.match(html, /id="stress-modal-title"/);
    const modal = html.match(/id="stress-modal"[\s\S]*?id="stress-modal-title"/)[0];
    assert.doesNotMatch(modal, /<p /, '标题之前不留说明段落');
    assert.match(html, /aria-describedby="stress-tip"[\s\S]{0,120}?role="tooltip"/, '说明性文字进 ? 气泡（唯一一套 .tip）');
    assert.match(html, /id="stress-unclassified"/, '弹窗里也有未归类口径句（填跌幅时先问这个）');
  });

  test('语言词条两条通道都覆盖（含可访问名与占位符）', () => {
    for (const key of ['压测', '压测情景', '压测维度', '压测中', '压测：未启用',
      '压测：先在「分类管理」里建一个分类', '{p1} 的剩余比例（百分比）',
      '该维度下未归类的资产（{p1}，{p2} 项）按未打折计入。', '压测已清除']) {
      assert.ok(key in require('../logic.js').i18n.I18N_EN, '缺英文词条: ' + key);
    }
  });
});

/*
 * 实时联动：账本一变，**所有**从它派生的读数就都重算一次
 * --------------------------------------------------------------------------
 * 此前每个写入点各自挑几处重绘（行内编辑只刷报头 + 可见图表、表单只刷列表、导入只 renderAll、
 * 切收益口径只刷收益页），于是同一屏上会出现：
 *   · 报头副行已是「原值 ¥290,000 / -13.8%」，压测条还写着「未归类 ¥50,000」；
 *   · 收益页换了 min→max，报头「预估月收益」还停在上一个口径；
 *   · 收益页开着时导入数据，整页数字不动（只有报头变了）。
 * 散点接线必然漏一处，且漏了不报错、只在特定顺序下显形。故收敛成**一个刷新口**：
 * 列表重绘（两侧）、行内编辑、口径切换的收尾都只调它。
 */
describe('UI 接线契约：账本一变，所有派生读数就重算（实时联动）', () => {
  test('syncDerivedReads 是派生读数的唯一刷新口（报头 + 压测指示器 + 可见图表）', () => {
    const src = fnSource('syncDerivedReads');
    assert.match(src, /renderMasthead\(\)/, '报头净资产/构成/副行/目标进度');
    assert.match(src, /renderStressChrome\(\)/, '压测条与页头印徽');
    assert.match(src, /refreshVisibleCharts\(\)/, '收益/分布/历史/消费图表（各自带可见性守卫，隐藏时为零开销）');
  });

  test('列表重绘与行内编辑的收尾都走它（不在各写入点各挑几处重绘）', () => {
    for (const fn of ['renderAssets', 'renderExpenses', 'commitInlineEdit', 'setIncomeMode']) {
      assert.match(fnSource(fn), /syncDerivedReads\(\)/, fn + ' 收尾必须重算派生读数');
    }
    // 反向：renderAssets 不得再各自挑选重绘谁（多头接线正是漏刷的源头）
    const src = fnSource('renderAssets');
    assert.doesNotMatch(src, /renderMasthead\(/, '报头不由列表渲染器单独刷（走 syncDerivedReads）');
    assert.doesNotMatch(src, /renderStressChrome\(/, '指示器不由列表渲染器单独刷（走 syncDerivedReads）');
  });

  test('报头总数自己算，不接受调用方传入的数（防「谁算的谁负责」漏更新）', () => {
    const src = fnSource('renderMasthead');
    assert.match(html, /function renderMasthead\(\)/, '签名无参：总数由报头自己现算');
    assert.match(src, /const total = totalAssetsCNY\(\)/, '总资产在报头内部现算（经 assetsInView，含压测叠加）');
  });

  test('报头同一目标不重启动画（重复重绘不得把计数动画拽回起点）', () => {
    const src = fnSource('renderMasthead');
    assert.match(src, /_mastheadTarget/, '以「当前应有目标」判定是否需要新动画');
    assert.match(src, /total !== _mastheadTarget/, '目标未变就不重启动画');
  });

  test('批量重绘只收尾一次（renderAll 不得把同一张图画两遍）', () => {
    assert.match(fnSource('renderAll'), /_renderBatch\+\+/, 'renderAll 括住整个批量');
    assert.match(fnSource('renderAll'), /syncDerivedReads\(\)/, '批量结束后再刷一次');
    assert.match(fnSource('syncDerivedReads'), /if \(_renderBatch\) return;/, '批量期间先攒着');
  });
});

describe('UI 接线契约：图表 tooltip 转义用户输入（防存储型 XSS）', () => {
  // ECharts tooltip 默认 renderMode:'html'，formatter 返回值直接 innerHTML 注入。
  // p.name / p.seriesName / treePathInfo 均来自用户输入（资产名、备注、标签名），
  // 不转义时恶意名称（或导入的 JSON）会执行脚本。列表/弹窗已全走 esc()，tooltip 不得例外。
  test('旭日图 tooltip 名称/标签路径经 esc 转义，且内容单一来源 sunburstTooltipContent', () => {
    const helper = fnSource('sunburstTooltipContent');
    assert.ok(helper, 'sunburstTooltipContent helper 存在');
    assert.match(helper, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(p\.name\)/, 'helper 应转义名称');
    assert.match(helper, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(p\.treePathInfo\[1\]\.name\)/, 'helper 应转义标签路径');
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart']) {
      assert.match(fnSource(fn), /sunburstTooltipContent\(/, `${fn} 应复用统一 tooltip 内容`);
    }
    assert.strictEqual(count(/\$\{arrow\}\$\{p\.name\}/g), 0, '不得再内联未转义的 ${arrow}${p.name}');
    assert.strictEqual(count(/p\.treePathInfo\[1\]\.name \+ ' › '/g), 0, '路径拼接只允许在 helper 一处');
  });

  test('拼进 id / data-* 的元素 id 也要转义（属性截断 = 注入）', () => {
    // id 来自导入的 JSON，不经用户手：一个双引号就能截断属性并插进新标签。
    // 实测 id = `a"><img src=x onerror="window.__xss=1">` 时，校验面板真的执行了脚本。
    const picker = fnSource('tagPickerHtml');
    assert.match(picker, /const hidId = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(/, 'hidden input 的 id 与 data-target 须走同一个转义后的串');
    assert.doesNotMatch(picker, /id="\$\{idPrefix\}/, '不得把未转义的前缀直接插进 id');
    for (const fn of ['startInlineEdit', 'commitInlineEdit']) {
      assert.match(fnSource(fn), /CSS\.escape\(id\)/, `${fn} 的属性选择器要转义 id`);
    }
  });

  test('用户字段插值一律经 esc：日期不是「安全形状」，它同样来自导入的 JSON', () => {
    assert.strictEqual(count(/\$\{e\.date\}/g), 0, '日期插值必须走 esc（月度明细/分类构成两处曾裸插）');
    assert.strictEqual(count(/\$\{(?:e|exp|it|a|asset|s)\.(?:date|note|name)\}/g), 0,
      '用户输入字段不得裸插值进 innerHTML');
  });

  test('堆叠柱 tooltip 的系列名经 esc 转义', () => {
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      assert.match(fnSource(fn), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?esc\(p\.seriesName\)/, `${fn} tooltip 系列名应 esc 转义`);
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

describe('UI 接线契约：预期保存/清除不自己碰图表（隐藏容器 echarts 0 尺寸初始化）', () => {
  test('写入点只重绘列表，图表重绘一律经 syncDerivedReads（守卫只在一处）', () => {
    for (const fn of ['saveExpectation', 'clearExpectation']) {
      const src = fnSource(fn);
      assert.match(src, /renderAssets\(\)/, `${fn} 重绘列表`);
      assert.doesNotMatch(src, /renderExpenseTrendChart\(/, `${fn} 不得直接画图（隐藏容器 0×0）`);
      assert.doesNotMatch(src, /renderIncomeTab\(/, `${fn} 不得直接画图（隐藏容器 0×0）`);
    }
  });
});

describe('UI 接线契约：堆叠柱标签排序单一来源', () => {
  const logic = logicSrc;

  test('历史净值/消费趋势的标签合计排序下沉 logic.js sortTagsByTotal，内联 tagTotals 不回潮', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sortTagsByTotal\(/, '决策纯函数在 logic.js');
    for (const fn of ['renderHistoryChart', 'renderExpenseTrendChart']) {
      assert.match(fnSource(fn), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sortTagsByTotal\(/, `${fn} 应复用统一排序`);
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
    const logic = logicSrc;
    assert.match(logic, /const CATEGORY_COLORS = \[/, 'logic.js 定义 CATEGORY_COLORS');
    const api = require('../logic.js');
    assert.strictEqual(api.color.CATEGORY_COLORS, api.color.CATEGORY_PALETTE.length ? api.color.CATEGORY_COLORS : undefined, '经 color 域导出');
    assert.ok(api.color.pillColors && api.color.basePill, 'pillColors / basePill 同在 color 域');
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
    assert.match(fnSource('onInlineEditKey'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?inlineEditKeyAction\(/, '走纯函数判键位');
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

describe('UI 接线契约：行级可点元素必须键盘可达（可点即键盘可达）', () => {
  test('行级激活键位走 logic.js activateKeyAction，不在内联里各自判键名', () => {
    assert.strictEqual(
      (html.match(/function activateKeyAction/g) || []).length,
      0,
      'index.html 不应重复定义键位判定（单一来源在 logic.js）');
    assert.match(
      html,
      /onkeydown="if\((?:[A-Za-z_$][A-Za-z0-9_$]*\.)?activateKeyAction\(event\.key\)\)/,
      '行级激活应走单一口径 activateKeyAction');
  });

  test('三处「点行进入」的元素都带 role=button + tabindex=0 + 键盘通道', () => {
    // 旭日图清单顶层行（下钻）、快照行、消费趋势月份行。
    // 判据是「不能只靠指针」：cursor:pointer 而 tabIndex=-1，键盘用户就永远到不了。
    for (const [name, handler] of [
      ['旭日图清单行', 'drillSunburst'],
      ['快照行', 'viewSnapshot'],
      ['消费趋势月份行', 'viewExpenseMonth'],
    ]) {
      assert.ok(
        html.includes(handler),
        `${name} 的入口 ${handler} 应仍在（本契约随后检查它的可达性）`);
    }
    // 三个渲染点的行元素都必须是可聚焦的 role=button
    for (const fn of ['renderSunburstLegend', 'renderHistoryTab', 'renderExpenseTrendList']) {
      const src = fnSource(fn);
      assert.match(
        src,
        /tabindex="0"/,
        `${fn} 生成的行必须可聚焦（否则键盘用户到不了）`);
      assert.match(
        src,
        /role="button"/,
        `${fn} 生成的行必须声明 role=button（读屏器才知道它能按）`);
      assert.match(
        src,
        /activateKeyAction/,
        `${fn} 生成的行必须有键盘通道，且与其余两处同一判据`);
    }
  });

  test('行级可点元素的指针样式收回 CSS，页面不再内联 cursor:pointer', () => {
    // 同类结构出现 ≥2 次就下沉单一实现（本项目「版式单一来源」约定）。
    assert.strictEqual(
      (html.match(/style="cursor:pointer;"/g) || []).length,
      0,
      'cursor:pointer 应收回 CSS 类（原先 6 处内联各写一遍）');
    assert.match(
      html,
      /\n  \.row-hit \{[^}]*cursor: pointer;/,
      '行级可点元素共用 .row-hit 一个类');
  });

  test('排序表头：Space 与 Enter 同义、aria-sort 走 logic.js 单一口径', () => {
    const sortHeads = html.match(/<div[^>]*onclick="toggle(Sort|ExpenseSort)[^>]*>/g) || [];
    assert.strictEqual(sortHeads.length, 6, '资产 4 列 + 消费 2 列排序表头');
    for (const head of sortHeads) {
      assert.match(
        head,
        /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?activateKeyAction\(event\.key\)/,
        '排序表头的键位应走单一口径（Enter 与 Space 同义）');
      assert.match(head, /aria-sort="none"/, '初始 aria-sort 应为 none');
      // 一个标签里写两遍 class：浏览器只认第一个，第二个（这里是 .row-hit）被静默丢弃——
      // 金额表头于是少了 cursor:pointer 与焦点环，而文本断言（只查 class 出现过）照样绿。
      assert.strictEqual((head.match(/\bclass="/g) || []).length, 1,
        `排序表头只能有一个 class 属性（重复的那个会被丢弃，导致 .row-hit 静默失效）：${head}`);
      assert.match(head, /\bclass="[^"]*\brow-hit\b/, '排序表头必须带上 .row-hit（指针样式与焦点环的来源）');
      if (/金额/.test(head)) assert.match(head, /\bclass="[^"]*\bnum\b/, '数值列表头还要带 .num（右对齐与等宽数字）');
    }
    assert.match(
      fnSource('updateSortIndicators'),
      /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sortAriaSort\(/,
      'aria-sort 的取值口径应走 logic.js sortAriaSort');
    assert.strictEqual(
      (html.match(/getAttribute\('aria-sort'\)/g) || []).length,
      0,
      '不在此处另写一套 aria-sort 推导');
  });

  test('导入「选择文件」必须键盘可达（label 不是控件，display:none 的 input 进不了 Tab 序）', () => {
    // 实测：label[for=import-file] 的 tabIndex=-1（label 不是控件），而它的 <input type="file">
    // 又是 display:none —— 两头都进不了 Tab 序，于是**键盘用户完全无法导入数据**
    // （真实浏览器里 Shift+Tab 会直接跳过它）。这是「可点即键盘可达」的第 4 处同类缺陷，
    // 且后果最重：整块功能不可达，而不是少一个快捷键。
    //
    // 做法：label **包住** file input。只有一个 Tab 停靠点（input），浏览器原生负责
    // Enter/Space 打开选择框，不必自己写「转发 click」的脚本（少一段可写错的接线）。
    assert.match(
      html,
      /<label class="btn-gold file-label">[\s\S]*?<input type="file" id="import-file"/,
      'label 应包住 file input（而不是 label[for] + 位于别处的 input）');
    assert.match(html, /id="import-file"[^>]*class="sr-only"/, 'file input 用 sr-only 隐藏而不是 display:none');
    assert.doesNotMatch(
      html,
      /id="import-file"[^>]*style="display:none;"/,
      'display:none 的元素无法聚焦，键盘用户会整块够不到它');
    assert.match(html, /\n  \.sr-only \{/, 'sr-only 工具类（视觉隐藏但仍可聚焦）必须在自有 CSS 里定义一次');
    assert.match(
      html,
      /\.file-label:focus-within \{[^}]*outline/,
      '真正的焦点在里面的 input 上，焦点环必须画在看得见的 label 上（:focus-within）');
  });

  test('清单行的 focus-visible 规则不得再是死代码（元素必须真的能聚焦）', () => {
    // 曾存在 .chart-legend-row:focus-visible 规则，但行 tabIndex=-1——
    // 样式写了却永远不可能命中，正是「以为做了键盘可达、其实没做」的化石。
    assert.match(
      html,
      /\n  \.row-hit:focus-visible \{[^}]*outline/,
      '行级可点元素必须有可见焦点环（quality floor：可见键盘焦点）');
  });
});

describe('UI 接线契约：内联事件属性必须是合法 JS（单测看不见的那一层）', () => {
  test('所有 on* 属性的处理体都能被真解析（防止 if 少写花括号这类静默失效）', () => {
    // 为什么需要这条：onkeydown="..." 是**属性里的字符串**，不在 <script> 里，
    // 所以「整段内联脚本能被 new Function 解析」那条契约罩不到它；
    // node --test 的文本断言也只看得到字面量。曾实测写坏一次：
    //   if(cond)event.preventDefault();doThing();}
    // 少一个左花括号 → 只有 preventDefault 受守卫，doThing();} 是语法错误。
    // 浏览器里这条属性只在事件触发时才编译 → **按了 Enter 毫无反应、且不报错**，
    // 445 个单测全绿、真浏览器里功能全废。故这里把每个属性处理体逐条真解析。
    const attrs = [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(attrs.length > 10, `应扫到一批内联事件属性（实得 ${attrs.length}）`);
    const bad = [];
    for (const raw of attrs) {
      // 属性写在模板字符串里时含 ${...} 占位（那部分是给 JS 引擎在**生成时**求值的，
      // 不是处理体的一部分）。把它们换成无害标识符，才能只看**结构**是否合法——
      // 而那正是我们要守的东西（少花括号这类错误与占位符内容无关）。
      const body = raw.replace(/\$\{[^}]*\}/g, '0');
      try {
        new Function('event', body);
      } catch (e) {
        bad.push(`${e.message} :: ${raw}`);
      }
    }
    assert.deepStrictEqual(bad, [], '内联事件属性存在语法错误（浏览器里表现为「按了没反应」）');
  });

  test('行级激活的守卫必须包住整段动作，而不是只包住 preventDefault', () => {
    // if(cond)A;B 只守卫 A——这是上面那条语法错误的成因，单独立一条说得更清楚。
    const hits = [...html.matchAll(/onkeydown="if\((?:[A-Za-z_$][A-Za-z0-9_$]*\.)?activateKeyAction\(event\.key\)\)([^"]*)"/g)];
    assert.strictEqual(hits.length, 10, `行级激活共 10 处（资产 4 列排序 + 消费 2 列排序 + 清单行 + 快照行 + 趋势月份行 + 明细微标）`);
    for (const [, body] of hits) {
      assert.match(body, /^\{/, '守卫后应紧跟左花括号，把整段动作一起包住');
      assert.match(body, /\}$/, '动作段应以右花括号收尾');
      assert.ok(!/^event\.preventDefault\(\);\w/.test(body), '不得只包住 preventDefault');
    }
  });

  test('内联处理体里引用的名字必须真的存在（模板变量 `side` 曾漏进 onclick）', () => {
    // 语法合法 ≠ 能跑：`onclick="openTagCheck(side, '...')"` 里的 `side` 是**模板函数**
    // 的参数，而内联处理器在全局作用域求值 —— 点了只报 ReferenceError，弹窗不出现。
    // 上一版契约只把处理体交给 new Function 解析（只看结构），罩不到这类「名字不存在」。
    // 判据：处理体里出现的每个裸标识符，必须能在页面自己的**顶层**声明里找到
    // （内联 <script> 顶格声明，或 logic.js 工厂内两格缩进的声明），或是浏览器内建名。
    // 只认顶层：函数内的局部变量（如 renderCategoryCards(side) 的形参）**不在**全局作用域里，
    // 恰恰是这类名字漏进内联处理器才会 ReferenceError。
    const logic = logicSrc;
    const declared = new Set();
    const collect = (src, indent) => {
      const re = new RegExp(`^${indent}(?:async\\s+)?(?:function|let|const|var)\\s+([A-Za-z_$][\\w$]*)`, 'gm');
      for (const m of src.matchAll(re)) declared.add(m[1]);
      const re2 = new RegExp(`^${indent}(?:let|const|var)\\s+[^;=]+=[^;]*;`, 'gm');
      for (const m of src.matchAll(re2)) {
        for (const n of m[0].matchAll(/(?:^|[,\s])([A-Za-z_$][\w$]*)\s*=/g)) declared.add(n[1]);
      }
    };
    collect(html, '');      // 内联脚本：顶格声明
    collect(logic, '  ');   // logic.js：UMD 工厂内两格缩进
    for (const m of logic.matchAll(/^ {4}([A-Za-z_$][\w$]*): \{$/gm)) declared.add(m[1]);

    const builtins = new Set([
      'event', 'this', 'document', 'window', 'console', 'Math', 'Date', 'JSON', 'Number', 'String',
      'Array', 'Object', 'Set', 'Map', 'Boolean', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
      'Infinity', 'NaN', 'undefined', 'if', 'else', 'return', 'true', 'false', 'null',
    ]);
    const bad = [];
    for (const [, attr, raw] of html.matchAll(/\son([a-z]+)="([^"]*)"/g)) {
      // ${...} 占位由生成时求值，换成 '0'；字符串字面量先剥干净，免把参数名当标识符。
      // 对象字面量的**键**不是引用（`{query:this.value}` 里的 query 是键），只留值那一侧——
      // 否则「给函数传 patch 对象」这种合法写法会被误报成「名字不存在」。
      const body = raw.replace(/\$\{[^}]*\}/g, '0').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1');
      for (const m of body.matchAll(/(^|[^\w$.'"])([A-Za-z_$][\w$]*)/g)) {
        const name = m[2];
        if (builtins.has(name) || declared.has(name)) continue;
        bad.push(`on${attr} 引用了不存在的名字「${name}」:: ${raw}`);
      }
    }
    assert.deepStrictEqual(bad, [], '内联处理体引用了生成时的局部变量（浏览器里表现为「点了毫无反应且不报错」）');
  });

});

describe('UI 接线契约：键盘 Tab 不再切换资产/消费', () => {
  test('旧键盘接管整块移除，不回潮', () => {
    assert.strictEqual(count(/handleTabKeyNav/g), 0, '键盘 Tab 接管处理器应保持移除');
    assert.strictEqual(count(/nextTabIndex/g), 0, '组内循环下标纯函数随之移除');
    const bar = html.match(/<div id="tabs-assets"[\s\S]*?<\/div>/)[0];
    assert.ok(!/onkeydown/.test(bar), '子 Tab 栏不得接管键位');
  });
});

describe('UI 接线契约：资产页只能靠长按送达（提高日常查看成本）', () => {
  test('模式按钮是长按接线：按下起计时、松手/移开收尾', () => {
    assert.match(html, /id="mode-assets"[^>]*onpointerdown="startModePress\(event\)"/, '按下即起计时（pointer 事件对鼠标/触摸同一套）');
    assert.match(html, /id="mode-assets"[^>]*onpointerleave="cancelModePress\(\)"/, '指针移开即放弃');
    // 松手必须收在 document 上：在按钮外松手时 pointerup 不落到按钮上，
    // 挂在按钮上会漏收尾，墨线留在满格、下一次按下被误判成就绪
    assert.match(html, /document\.addEventListener\('pointerup', endModePress\)/, '松手收尾挂在 document');
    assert.strictEqual(count(/onclick="switchMode\('assets'\)"/g), 0, '旧「点一下就进」入口应保持移除');
  });

  test('合成 click 只抬闸、不进门（廉价通道不存在，键盘也没被挡在门外）', () => {
    assert.match(html, /id="mode-assets"[^>]*onclick="modePressClick\(event\)"/, 'click 走单一处置函数');
    const src = fnSource('modePressClick');
    assert.match(src, /e\.detail === 0/, '只有合成激活抬闸；鼠标/触摸的 detail 是 1，被长按链挡住');
    assert.match(src, /openAssetGate\(\)/, '合成激活只开抄写框');
    assert.doesNotMatch(src, /switchMode\(/, '合成激活绝不能直接进资产页（那正是被删掉的「两次回车进去」）');
  });

  test('右键不参与长按（option+点击是「想开菜单」，不是想进门）', () => {
    assert.match(fnSource('startModePress'), /e\.button !== 0/, '忽略非主按键');
    assert.match(fnSource('endModePress'), /e\.button !== 0/, '非主按键松开不替主键的按住收尾');
  });

  test('已在资产页时入口整体失效（再问一次「现在确实要看？」是荒谬的）', () => {
    const src = fnSource('assetsEntryOpen');
    assert.match(src, /currentMode !== 'assets'/, '判据单一来源');
    assert.match(fnSource('startModePress'), /assetsEntryOpen\(\)/, '按下前先问这道闸');
    assert.match(fnSource('openAssetGate'), /assetsEntryOpen\(\)/, '抬闸链路也得问（键盘通直也不例外）；重入路径不留缺口');
  });

  test('收尾后的残留帧不报错（cancel 排在下一帧之前时 rAF 仍会跑到）', () => {
    assert.match(fnSource('tickModePress'), /modePressStart === null/, '推进帧先查按下是否还在');
  });

  test('消费按钮仍是一次点击直达（成本只加在资产侧）', () => {
    assert.match(html, /id="mode-expenses"[^>]*onclick="switchMode\('expenses'\)"/, '回消费不受惩罚');
    assert.strictEqual(count(/onclick="switchMode\('expenses'\)"/g), 1);
  });

  test('满时长判定与进度走 logic.js 单一来源，不得内联重写阈值', () => {
    assert.match(fnSource('endModePress'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?modePressDecision\(/, '送达判定下沉 logic.js');
    assert.match(fnSource('tickModePress'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?modePressProgress\(/, '进度比例下沉 logic.js');
    // 阈值只在 logic.js 定义一次；页面脚本里不得出现裸的毫秒字面量（文案里的「1 秒」由常量派生）
    const src = ['startModePress', 'tickModePress', 'endModePress', 'cancelModePress', 'openAssetGate']
      .map(fnSource).join('\n');
    assert.ok(!/\b\d{3,}\b/.test(src), '按下/松手链路不得内联毫秒阈值');
    assert.strictEqual(count(/MODE_PRESS_MS\s*=/g), 0, '常量定义只在 logic.js');
  });

  test('长按有可见进度反馈（填充完全由 CSS 画，JS 只同步一个变量）', () => {
    assert.match(html, /\n  \.mode-press::after \{[^}]*width: calc\(var\(--mode-press, 0\) \* 100%\)/, '墨线宽度换算在 CSS 一处，不逐帧写 style.width');
    assert.match(fnSource('tickModePress'), /style\.setProperty\('--mode-press'/, 'JS 只同步 CSS 变量，不逐帧改 class');
  });

  test('长按满时长自动抬闸（按满即弹抄写框，不必再松手）', () => {
    const tick = fnSource('tickModePress');
    assert.match(tick, /openAssetGate\(/, '满时长由推进帧直接抬闸（不必等松手）');
    assert.match(tick, /__autoOpenedAt = performance\.now\(\)/, '弹出时刻要记下（守卫窗的起点）');
    const end = fnSource('endModePress');
    assert.match(end, /decision === 'hint'/, '短按仍要教一句');
    assert.match(end, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?autoOpenGuard\(/, 'pointerup 收尾必须查守卫（否则抬手即关）');
  });

  test('抄写闸：进门只有两个合法来源，且都走同一个放行点', () => {
    assert.strictEqual(count(/switchMode\('assets'\)/g), 1, '全页只有一个地方能把人送进资产页');
    const src = fnSource('submitAssetGate');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?entryPhraseMatches\(/, '比对下沉 logic.js（可单测）');
    assert.match(src, /enterAssets\(\)/, '抄对才切模式');
    assert.match(
      src.slice(src.indexOf('entryPhraseMatches('), src.indexOf('enterAssets()')),
      /return;/,
      '不匹配的分支必须 return，切换只能在通过之后');
    assert.match(src, /markGateUnlocked\(\)/, '只有抄对才写冷却起点');

    // 冷却窗口是第二条合法来源：仍要过「已在资产页」闸，并汇入同一个放行点
    const cool = fnSource('tryEnterCooledAssets');
    assert.match(cool, /assetsEntryOpen\(\)/, '已在资产页就不再进门');
    assert.match(cool, /gateCooling\(\)/, '冷却判定只此一处');
    assert.match(cool, /enterAssets\(\)/, '免抄也要走同一个放行点');
    assert.match(fnSource('gateCooling'), /ui\.gateCooldownActive\(/, '时间判定下沉 logic.js（可单测）');
  });

  test('抄写闸：手误原地重试（原句不换、输入清空、报错可见）', () => {
    const src = fnSource('submitAssetGate');
    assert.match(src, /input\.value = ''/, '不一致就清空重抄');
    assert.match(src, /setAssetGateError\(true\)/, '要明文说「不一致」，不能默默驳回');
    assert.match(fnSource('openAssetGate'), /drawAssetGatePhrase\(\)/, '每次抬闸重新抽句');
    assert.match(fnSource('drawAssetGatePhrase'), /assetGatePhrase = ui\.entryPhrase\(lang\)/, '取哪一池由选定的语言决定');
    assert.strictEqual(count(/assetGatePhrase = ui\.entryPhrase/g), 1, '抽句只此一处');
    assert.doesNotMatch(src, /assetGatePhrase =/, '重试不得换句（换句等于惩罚手误，还给背句子的人开口子）');
    assert.match(fnSource('cancelAssetGate'), /assetGatePhrase = ''/, '放弃后收尾旧句');
  });

  test('抄写闸：粘贴被拦、Enter 提交、输入法组合中的 Enter 不算提交', () => {
    assert.match(html, /id="asset-gate-input"[^>]*onpaste="event\.preventDefault\(\)"/, '允许粘贴就把门槛变成一次性的');
    assert.match(html, /id="asset-gate-input"[^>]*onkeydown="assetGateKey\(event\)"/, 'Enter 提交走单一入口');
    const src = fnSource('assetGateKey');
    assert.match(src, /e\.isComposing/, '输入法选词时的 Enter 不得提交');
    assert.match(src, /submitAssetGate\(\)/, '提交即判（不再要一次「确认」点击）');
  });

  test('抄写闸：三道出口都作废本次（Esc / 点遮罩 / 「不看」）', () => {
    assert.match(html, /id="asset-gate-modal"[^>]*aria-labelledby="asset-gate-title"/, '弹窗要有名字');
    assert.match(html, /onclick="cancelAssetGate\(\)"[^>]*data-i18n="不看"/, '「不看」退出建成一条按钮');
    // Esc 与遮罩 click 都得走同一条出口，否则「放弃」有两种不一致的结局
    assert.match(html, /top\.id === 'asset-gate-modal'\) cancelAssetGate\(\)/, 'Esc 走 cancelAssetGate');
    assert.match(html, /e\.target\.id === 'asset-gate-modal'\) \{\s*cancelAssetGate\(\)/, '点遮罩也走同一条出口');
  });

  test('门槛箴言池不在 index.html（下沉 logic.js 才能单测长度/标点/句数）', () => {
    assert.doesNotMatch(html, /账面起落皆是暂相|Numbers rise and fall/, '箴言池写进页面就成了第二份真相');
    assert.match(fnSource('drawAssetGatePhrase'), /ui\.entryPhrase\(/, '唯一取句入口');
  });

  test('拄写闸：可以换成英文取句（中文输入法难打），选择记住', () => {
    assert.strictEqual(count(/id="asset-gate-lang"/g), 1, '换语言只有一个入口');
    assert.match(html, /onclick="toggleAssetGatePhraseLang\(\)"/, '按钮直接接到切换上');
    const toggle = fnSource('toggleAssetGatePhraseLang');
    assert.match(toggle, /state\.gateLang = assetGateLang/, '记住这次的选择');
    assert.match(toggle, /saveState\(\)/, '要落盘（下次进来别再换一遍）');
    assert.match(toggle, /drawAssetGatePhrase\(\)/, '换语言 = 换一句新的');
    assert.match(fnSource('drawAssetGatePhrase'), /asset-gate-input'\)\.value = ''/, '换句要把已抄的那半清掉');
    assert.match(fnSource('openAssetGate'), /state\.gateLang === 'zh'/, '上次选的语言优先于界面语言');
  });

  test('共用确认框的文案/色调每次重置（金调不得粘到下一个删除确认上）', () => {
    // 备份提示是金调调用方；门槛已改用自有弹窗，但重置这条不能跟着走：
    // 剩下的调用方一样靠「每次写回」把上一次的文案/色调摸掉
    const src = fnSource('showConfirm');
    assert.match(src, /ok\.textContent = opts\.okLabel \|\| i18n\.t\('确认'\)/, '文案默认回「确认」');
    assert.match(src, /ok\.className = opts\.tone === 'gold' \? 'btn-gold' : 'btn-danger'/, '色调默认回危险色');
  });
});

describe('UI 接线契约：菜单图标（内联 Lucide symbol，一个来源）', () => {
  // 图标只做路标：定义在页内 symbol 集里（不发额外请求、亮暗随 currentColor），
  // 每个按钮 = 图标 + 紧邻文字。为什么要钉住「文字仍在」：图标一旦成了唯一标签，
  // 读屏器与语音控制（WCAG 2.5.3）就都失去名字——而这一条单看 HTML 只能这样验。
  const symbols = new Set([...html.matchAll(/<symbol id="(ic-[\w-]+)" viewBox="0 0 24 24">/g)].map((m) => m[1]));
  const uses = [...html.matchAll(/<use href="#(ic-[\w-]+)"\/>/g)].map((m) => m[1]);

  test('每个用到的图标都有定义，且没有无人使用的死图标（与死词条同理）', () => {
    assert.ok(symbols.size >= 14, `图标集应有 15 枚（现 ${symbols.size}）`);
    assert.deepStrictEqual(uses.filter((u) => !symbols.has(u)), [], '引用了不存在的 symbol');
    assert.deepStrictEqual([...symbols].filter((i) => !uses.includes(i)), [], '定义了却没人用的图标会悄悄腐烂');
  });

  test('图标一律 aria-hidden，且要么紧跟文字标签，要么按钮自带无障碍名', () => {
    const pairs = [...html.matchAll(
      /<svg class="ico" aria-hidden="true"><use href="#ic-[\w-]+"\/><\/svg><span data-i18n="([^"]+)">([^<]+)<\/span>/g
    )];
    // 图标作按钮的唯一内容（门槛里那枚换句图标）：可见文字没了，名字只能来自 aria-label，
    // 且必须挂 data-i18n-aria-label，否则英文界面下读屏器听到的仍是中文。
    const iconOnly = [...html.matchAll(
      /<button\b([^>]*)><svg class="ico" aria-hidden="true"><use href="#ic-[\w-]+"\/><\/svg><\/button>/g
    )].filter((m) => /aria-label="[^"]+"/.test(m[1]) && /data-i18n-aria-label="[^"]+"/.test(m[1]));
    assert.strictEqual(pairs.length + iconOnly.length, uses.length,
      '每个 <use> 都要有名字：紧跟的文字标签，或按钮自带的 aria-label');
    const bad = pairs.filter((m) => m[1] !== m[2]).map((m) => m[1]);
    assert.deepStrictEqual(bad, [], 'span 的 data-i18n 与可见文字必须一致（否则换语言会错位）');
  });

  test('尺寸/描边只在 .ico 一处声明（符号里只有路径数据）', () => {
    const css = html.match(/\n  \.ico \{[\s\S]*?\n  \}/)[0];
    assert.match(css, /width: 1em; height: 1em/, '尺寸跟随所在档位字号');
    assert.match(css, /stroke: currentColor/, '颜色随正文/主题');
    assert.strictEqual(count(/stroke-width: 2/g), 1, '描边宽度只声明一次（symbol 里再写一遍就会漂）');
    assert.strictEqual(count(/<path d=/g) > 20, true, '符号里应当只有路径数据');
  });

  test('主题档不再用 emoji（同一语义不留两套）', () => {
    assert.strictEqual(count(/☀|☾/g), 0, 'emoji 与图标的混用会让两种语言下形态不一');
  });
});

describe('UI 接线契约：弹窗可访问性', () => {
  test('每个 modal-overlay 都要有名字（aria-labelledby 指向本弹窗内的可见标题）', () => {
    const overlays = html.match(/<div id="[^"]+" class="modal-overlay"[^>]*>/g) || [];
    assert.ok(overlays.length >= 10, '弹窗数量应被扫到');
    for (const tag of overlays) {
      const id = (tag.match(/<div id="([^"]+)"/) || [])[1];
      const ref = (tag.match(/aria-labelledby="([^"]+)"/) || [])[1];
      assert.ok(ref || /aria-label="/.test(tag), `#${id} 没有可访问名（aria-labelledby / aria-label）`);
      if (ref) {
        assert.match(html, new RegExp(`<h3[^>]*id="${ref}"`), `#${id} 的 aria-labelledby 应指向一个真标题元素`);
      }
    }
  });

  test('每个 modal-overlay 都声明 role="dialog" 与 aria-modal', () => {
    const overlays = count(/class="modal-overlay"/g);
    assert.ok(overlays > 0, '存在弹窗容器');
    assert.strictEqual(
      count(/class="modal-overlay" role="dialog" aria-modal="true"/g), overlays,
      '全部弹窗都要有对话框语义（读屏器可识别）');
  });
});

describe('UI 接线契约：所选标签的钱 ÷ 预期月消费（消费趋势的读数卡）', () => {
  const logic = logicSrc;

  test('口径在 logic.js：渲染层不内联除法，展示走 runwayMonthsText', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayLiquidCNY\(/, '分子合计在 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonths\(/, '月数口径在 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonthsText\(/, '展示口径在 logic.js');
    const src = fnSource('renderRunwayRow');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayLiquidCNY\(assetsInView\(\)/, '渲染层从 logic.js 取分子（经压测叠加入口）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonths\(/);
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonthsText\(/);
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
    const section = html.match(/id="runway-card"[\s\S]*?<\/div>/);
    assert.ok(section, '读数卡存在');
    assert.match(section[0], /÷ <span id="runway-expense-name"[^>]*>预期月消费<\/span>/,
      '除法与分母名称在静态骨架中可见（公式直呈现）；分母名单独成槽，自定时换成「月消费（自定）」');
    assert.match(section[0], /id="runway-num"/);
    assert.match(section[0], /id="runway-expense"/);
    assert.match(section[0], /id="runway-months"/);
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
    assert.strictEqual(count(/renderRunwayRow\(\)/g), 3, '不得新增散落调用点');
    // 空态也要刷新: 必须放在 renderExpenseTrendChart 的早退之前（无消费记录时读数照样成立）
    const trend = fnSource('renderExpenseTrendChart');
    assert.ok(trend.indexOf('renderRunwayRow();') < trend.indexOf('state.expenses.length === 0'),
      '读数同步必须在早退之前');
  });

  test('标签摘要只列有效引用：损坏引用不得渲染成字面 undefined', () => {
    const src = fnSource('renderRunwayRow');
    assert.match(src, /const refs = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
      '渲染前走同一清理入口：否则手改 JSON 的畸形引用会显示 undefined，非数组还会直接抛错');
  });

  test('多选 chips 复用 tagChipHtml 单一来源，不另造第二套 chip 模板', () => {
    assert.strictEqual(count(/class="tag-choice"/g), 1, 'chip 模板只允许存在一处');
    assert.strictEqual(count(/function tagChipHtml\(/g), 1, 'chip 生成函数唯一');
    assert.strictEqual(count(/tagChipHtml\(/g), 3, '单选与多选共用同一 chip 生成');
    assert.match(fnSource('renderRunwayTagGroups'), /tagChipHtml\(/);
  });

  test('货币类型（内置分类）也能选：不得因 builtin 被挡在 picker 外', () => {
    const src = fnSource('renderRunwayTagGroups');
    assert.doesNotMatch(src, /builtin/, '分组不得提到 builtin（只看 CNY 能撑多久是合法筛法）；函数式 filter 也拦得住');
    assert.match(src, /state\.categories/, '分组直接来自全部分类');
  });

  test('标签引用清理单一来源 pruneRunwayTags：迁移与分类三处编辑都走它', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(/, '清理口径在 logic.js');
    assert.match(logic, /state\.runwayTags = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
      'migrateState 迁移期清理');
    for (const fn of ['saveCategory', 'deleteCategory', 'removeTag']) {
      const src = fnSource(fn);
      assert.match(src, /state\.runwayTags = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(state\.runwayTags, state\.categories\)/,
        `${fn} 改名/删除标签后同步清理读数区引用，避免读数指着已不存在的标签`);
      assert.match(src, /side === 'asset'/, `${fn} 需带侧别闸门：消费分类与读数卡无关`);
    }
  });

  test('落值只走 saveRunwayTags（草稿 _runwayDraft，取消不落库）', () => {
    const src = fnSource('saveRunwayTags');
    assert.match(src, /state\.runwayTags = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pruneRunwayTags\(_runwayDraft, state\.categories\)/);
    assert.match(src, /saveState\(\)/);
    assert.match(src, /renderRunwayRow\(\)/);
    assert.match(src, /closeModal\('runway-modal'\)/);
    assert.match(fnSource('openRunwayModal'), /openModal\('runway-modal'\)/, '走通用弹窗路径');
    assert.doesNotMatch(fnSource('openRunwayModal'), /state\.runwayTags = /, '打开只拷草稿，不写状态');
    assert.match(fnSource('openRunwayModal'), /_runwayDraft = .*state\.runwayTags/);
  });

  test('标签语义放 ? 悬停提示（正文不写说明），hover 与键盘 focus 都能看到', () => {
    assert.strictEqual(count(/>同一分类内多选为「或」[^<]*</g), 1, '语义只出现一次——在提示气泡里');
    // 弹窗标题里的 ? 提示现在有两处（压测 + 读数卡），必须锚定到读数卡那一个：
    // 非贪婪匹配会拿到文档里先出现的那个，断言就成了「验了另一个弹窗」
    const tip = html.match(/id="runway-modal"[\s\S]*?<span class="tip">[\s\S]*?<\/span>\s*<\/h3>/);
    assert.ok(tip, '标题旁有 ? 提示结构');
    assert.match(tip[0], /class="tip-mark"[^>]*aria-describedby="runway-tip"/, '? 图标关联气泡（可访问性）');
    assert.match(tip[0], /role="tooltip"/);
    assert.match(tip[0], /同一分类内多选为「或」/);
    assert.match(tip[0], /不同分类之间为「且」/);
    assert.match(tip[0], /某个分类不选则不参与过滤/);
    assert.match(html, /\.tip-bubble\.placed \{[^}]*visibility: visible/, '定位后即展示');
    assert.match(html, /document\.addEventListener\('mouseover'/, '指针进入时定位');
    assert.match(html, /document\.addEventListener\('focusin'/, '键盘 focus 也能定位');
    assert.match(html, /prefers-reduced-motion: reduce\) \{ \.tip-mark, \.tip-bubble \{ transition: none; \}/,
      '减弱动效须盖住会过渡的元素（只写气泡会漏掉 ? 图标）；.tab-indicator 也在同一块');
  });

  test('气泡不得被祖先的层叠上下文/裁剪困住（卡片有 backdrop-filter，会自成一层）', () => {
    // 用户实测：收益测算里「缺口」旁的 ? hover 后，气泡下半部分被下面那张表格卡片盖住。
    // 根因不是 z-index 太小——**卡片自身有 backdrop-filter**，于是它自成层叠上下文，
    // 气泡的 z-index 只在卡片内部有效；后面那张卡片在文档里更靠后，就整块盖上来。
    // 同理，弹窗正文 overflow-y:auto 与窄屏表格 overflow-x:auto 会直接裁掉溢出的气泡。
    // 故气泡必须**脱离**这些祖先：position: fixed + 由 JS 按视口定位（tipBubblePos）。
    const bubble = html.match(/\n  \.tip-bubble \{[\s\S]*?\n  \}/)[0];
    assert.match(bubble, /position: fixed/, '气泡必须相对视口定位（否则被祖先的层叠上下文困住）');
    assert.doesNotMatch(bubble, /position: absolute/, 'absolute 会落进祖先的层叠上下文');
    assert.match(logicSrc, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?tipBubblePos\(/, '定位换算有单一入口（logic.js 纯函数）');
    assert.match(html, /function placeTipBubble\(/, '页面只做「量尺寸 + 写变量」这一件事');
    assert.match(html, /--tip-x/, '坐标经 CSS 变量写入');
    assert.doesNotMatch(html, /bubble\.style\.(left|top)\s*=/, '不得直接写 left/top（与 CSS 变量两套来源）');
    assert.match(html, /document\.addEventListener\('mouseout'/, '收起时把气泡搬回原处（否则它会一直显示）');
  });

  test('文案换了要按新宽度重挂气泡：亮着的那份只从 __bubble 取', () => {
    // 回归：展开时气泡已被 append 到 body，不再在 .tip 里。旧代码用
    // tip.querySelector('.tip-bubble.placed') 判「亮着」，恒为 null，重挂从不发生——
    // 换语言 / 换句之后气泡仍钉在旧宽度的位置。
    const place = fnSource('placeTipBubble');
    assert.match(place, /tip\.__bubble \|\| tip\.querySelector\('\.tip-bubble'\)/,
      '取气泡要先认搬到 body 下的那一份');
    assert.doesNotMatch(js, /tip\.querySelector\('\.tip-bubble\.placed'\)/, '判「亮着」不许再查 .tip 的子孙（那里永远没有）');
    assert.match(fnSource('drawAssetGatePhrase'), /tip\.__bubble\) placeTipBubble/, '换句改宽度后重挂');
    assert.match(fnSource('applyI18nDom'), /tip\.__bubble\) placeTipBubble/, '换语言改宽度后重挂');
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
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayLiquidCNY\(assetsInView\(\), _runwayDraft\)/, '预览按草稿算，与读数卡同一口径函数（同样经压测叠加）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonths\(/);
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayMonthsText\(/);
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
  const logic = logicSrc;
  const modal = () => html.match(/id="runway-modal"[\s\S]*?id="runway-preview"/)[0];

  test('分母口径在 logic.js：自定优先、否则回落全局预期（渲染层不内联取值）', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationOf\(/, '分母口径在 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationIsCustom\(/, '「是否自定」与分母同一判定');
    const src = fnSource('renderRunwayRow');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationOf\(state\.runwayExpectation, state\.expenseExpectation\)/,
      '分母必须走单一口径函数');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationIsCustom\(state\.runwayExpectation\)/, '自重绘后仍要能标出「自定」');
    assert.doesNotMatch(src, /state\.expenseExpectation\s*\|\|/, '直接读全局预期会把自定值吞掉');
    assert.doesNotMatch(src, /state\.runwayExpectation\s*[<>=!+\-*/]/,
      '分母取值一律走 runwayExpectationOf / runwayExpectationIsCustom，不在渲染层内联回落链');
    assert.match(fnSource('renderRunwayPreview'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationOf\(/,
      '弹窗预览与读数卡同一分母口径');
  });

  test('输入归一单一来源：写入侧与预览共用 normalizeRunwayExpectationInput', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?normalizeRunwayExpectationInput\(/, '归一在 logic.js');
    for (const fn of ['renderRunwayPreview', 'saveRunwayTags']) {
      assert.match(fnSource(fn), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?normalizeRunwayExpectationInput\([\s\S]{0,80}state\.expenseExpectation\)/,
        `${fn} 走同一解析+归一口径（各写一份时值等价也靠不住, 只改一处就会分家）`);
    }
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
    assert.match(html, /<h3 class="font-display modal-title" id="runway-modal-title"><span data-i18n="标签与月消费">标签与月消费<\/span>/, '标题已改名');
    assert.doesNotMatch(html, />选择标签</, '标题/按钮不得仍叫「选择标签」（现在也编辑月消费）');
  });

  test('打开时默认带出已填的月消费（字段里就是当前生效数），不回写状态', () => {
    const open = fnSource('openRunwayModal');
    assert.match(open, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?runwayExpectationOf\(state\.runwayExpectation, state\.expenseExpectation\)/,
      '默认值走同一分母口径：自定值优先，否则全局预期');
    assert.match(open, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?moneyStr\(/);
    assert.doesNotMatch(open, /state\.runwayExpectation = /, '打开只回填输入框，不写状态');
  });

  test('自定值不回填预期月消费（只对本卡生效）', () => {
    const save = fnSource('saveRunwayTags');
    assert.match(save, /state\.runwayExpectation = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?normalizeRunwayExpectationInput\(/,
      '保存写入读数卡自定值（归一走 logic.js，含「与全局相同则视为默认」）');
    assert.doesNotMatch(save, /state\.expenseExpectation = /, '自定值不得回填全局预期月消费');
    assert.doesNotMatch(html, /expenseExpectation = state\.runwayExpectation/, '更不得反向同步');
  });

  test('「默认」入口单一：把全局预期填回字段（值可见，不必记住原数字）', () => {
    assert.strictEqual(count(/onclick="useDefaultRunwayExpectation\(\)"/g), 1);
    const src = fnSource('useDefaultRunwayExpectation');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?moneyStr\(state\.expenseExpectation\)/);
    assert.match(src, /renderRunwayPreview\(\)/);
  });
});

describe('UI 接线契约：本月已花 ÷ 预期月消费（趋势页预算卡）', () => {
  const logic = logicSrc;
  const trendTab = html.match(/id="tab-expense-trend"[\s\S]*?<\/section>/)[0];
  const card = trendTab.slice(trendTab.indexOf('id="month-pace-card"'), trendTab.indexOf('id="runway-card"'));
  const paceSrc = () => stripComments(fnSource('renderMonthPace'));

  test('口径在 logic.js：预算读数/状态文案单一来源，渲染层不内联算式', () => {
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthExpenseTotal\(/, '本月合计在 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthBudgetReading\(/, '预算口径在 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthBudgetNote\(/, '预算状态叙述在 logic.js');
    const src = paceSrc();
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthExpenseTotal\(state\.expenses/, '渲染层从 logic.js 取合计');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthBudgetReading\(/);
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthBudgetNote\(/);
    assert.doesNotMatch(src, /\/ 31|\/ days|\/ expectation|spent\s*\/\s*expectation|\* 100/, '百分比/日均算式不得在内联脚本重写（呈现统一走 pctStr）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?pctStr\(reading\.pctOfMonth/, '百分比读数取 reading.pctOfMonth（与尺子宽度/≥90% 判断同源, 不另算一遍）');
    assert.match(src, /const now = new Date\(\);/, '合计与读数取同一时刻（各取一次 new Date 会在跨午夜时月份错位）');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?getLocalMonthStr\(now\)/, '合计月份来自单一时刻');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?monthBudgetReading\(spent, expectation, now\)/, '预算口径用同一时刻');
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
 * 为什么管这件事：Tailwind 走 CDN，类是否生效不由我们决定，写进工具类的规格会与自有档位漂移——曾经 10/11/12/13px 四档小字并存、同一处说明在弹窗里
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
    for (const cls of ['text-xs', 'text-sm', 'text-lg', 'text-\\[10px\\]', 'font-medium', 'font-bold', 'font-mono',
      'tracking-tight', 'tracking-\\[[^\\]]+\\]']) {
      assert.strictEqual(count(new RegExp(`class="[^"]*\\b${cls}\\b`, 'g')), 0,
        `${cls} 应替换为自有档位类 / 角色类`);
    }
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

  test('内容栏宽度与左右边距单一来源（页头 / 子 Tab / 正文共用一套 token）', () => {
    // 原先 max-w-6xl + px-6 在 4 处各写一遍：改一处就会让某一行单独错位。
    // 而且 Tailwind 走 CDN——工具类是否生效不由我们决定，版式不能建在它上面。
    assert.strictEqual(count(/class="[^"]*max-w-6xl/g), 0, '内容栏宽度不得再由 Tailwind 工具类承担');
    for (const sel of ['.app-header-inner', '.content-column']) {
      assert.match(html, new RegExp(`\\.${sel.slice(1)}\\b[^{]*\\{[^}]*max-width: var\\(--content-max\\)`), `${sel} 走内容栏 token`);
    }
    assert.match(html, /--content-max: \d+rem;/, '宽度 token 存在');
    assert.match(html, /--content-pad: [\d.]+rem;/, '边距 token 存在');
    assert.strictEqual(count(/class="app-header-inner/g), 1, '页头走内容栏');
    assert.strictEqual(count(/class="content-column/g), 3, '两个 Tab 栏与正文都走内容栏');
  });

  test('原生控件明暗由页面的 color-scheme 决定（不跟随系统）', () => {
    assert.match(html, /\n  :root \{[^}]*color-scheme: light;/, ':root 声明亮色');
    assert.match(html, /\n  :root\.dark \{[^}]*color-scheme: dark;/, ':root.dark 声明暗色');
    assert.strictEqual(count(/color-scheme: light dark/g), 0, '不得跟随系统（两者可能不一致）');
  });

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
    // CSS 3 处 = 表头本体 + 打印分页避断 + 打印隐藏空占位格（拖拽/操作列）
    assert.strictEqual(count(/list-head/g), 8, '表头共 8 处：CSS 3 + 静态列表 2 + 收益表 1 + 明细骨架 1 + 年化分段表 1（六处动态表头已收进骨架）');
    const rule = html.match(/\n  \.list-head \{[^}]*\}/);
    assert.ok(rule, '.list-head 规则存在');
    assert.match(rule[0], /color:\s*var\(--muted\)/, '表头底色归 CSS');
    assert.match(rule[0], /font-size:/, '表头字号归 CSS');
  });

  test('列宽模板单一来源：只在 CSS 定义一次，表头与数据行挂同一 class', () => {
    // 内联 style 里不得再出现列宽（原先表头与数据行各写一遍同一串 = 改一处漏一处）
    assert.strictEqual(count(/style="[^"]*grid-template-columns/g), 0, '列宽不许内联');
    for (const [cls, tpl] of [
      ['cols-expenses', '96px 108px minmax(0, 1fr) minmax(0, 1.6fr) 13rem'],
      ['cols-expense-month', '96px 1fr 2fr 1.5fr'],
      ['cols-income', '1.8fr 1fr 0.8fr 0.8fr 1fr 1fr 1fr'],
      ['cols-segment', '2fr 1fr 0.7fr 1.3fr 0.7fr'],
      ['cols-compare', '2fr 1.2fr 1.2fr 1.5fr 1fr'],
      ['cols-expense-segment', '96px 1fr 0.8fr 2.6fr'],
      ['cols-snapshot', '1.6fr 104px 52px 104px 2fr'],
    ]) {
      assert.match(html, new RegExp(`\\.${cls} \\{[^}]*grid-template-columns: ${tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`),
        `${cls} 模板在 CSS 里定义`);
      assert.strictEqual(count(new RegExp(`grid-template-columns: ${tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`, 'g')), 1,
        `${tpl} 只应出现一次（CSS 定义处）`);
    }
    // 表头与数据行必须引用同一份列宽：现在只在骨架里挂一次（cols 由调用点传入）
    assert.match(html, /function detailTableHtml\(cols, head, rows\)/, '列宽作为参数进骨架');
    assert.strictEqual(count(/class="asset-row list-head \$\{cols\}"/g), 1, '表头挂同一列宽 class');
    assert.strictEqual(count(/class="asset-row \$\{cols\}"/g), 1, '数据行挂同一列宽 class');
  });

  test('旭日图的高度由列宽决定（不写死像素，否则清单只有一行时右侧塌成一片空白）', () => {
    // 实测：消费分布卡高 619px，其中图纸写死 520px，而右侧构成清单只有 35px（一行）。
    // 图纸是正圆形，高度写死就与「这张卡实际有多少内容」脱钩——分类少时整卡被空白撑起。
    // 圆在 CSS 里没有确定尺寸（由 ECharts 按容器算），故高度只能由列宽推出来。
    const heights = html.match(/id="(sunburst-chart|income-chart|expense-sunburst-chart)"[^>]*style="[^"]*height:\s*(\d+)px/g) || [];
    assert.strictEqual(heights.length, 0,
      `图纸高度不得写死像素：${heights.map((h) => h.slice(0, 60)).join(' / ')}`);
    assert.match(html, /\.chart-canvas \{[^}]*aspect-ratio/, '高度由列宽与宽高比推出');
    assert.strictEqual((html.match(/class="chart-canvas[ "]/g) || []).length, 3, "三张旭日图都走同一个容器类（高度比例只在类里定义）");
  });

  test('新增标签的输入框按标签体量给宽（不靠 flex-1 撑满整行）', () => {
    // 实测：这一行输入框占满卡片整宽（约 990px），而它只用来敲一个 2–4 字的标签；
    // 「添加」按钮还被推到整页右端——一件控件被拉成两半。
    // flex-1 是 Tailwind 类：CDN 拉不到就不生效，必须换成自有 CSS 的宽度上限。
    assert.strictEqual(count(/placeholder="新增标签（回车添加）"[^>]*flex-1/g), 0,
      '新增标签输入框不得再靠 flex-1 撑满（CDN 拉不到就不生效）');
    assert.match(html, /\n  \.new-tag-row \{[^}]*max-width/, '宽度上限在自有 CSS 里定义');
    assert.match(html, /class="new-tag-row"/, '那一行挂上同一套 class（资产/消费两侧共用）');
  });

  test('行内操作组统一 .row-actions：不得靠工具类的 flex + justify-end', () => {
    assert.strictEqual(count(/flex gap-2 justify-end/g), 0, '旧写法在窄列里向左溢出，会压住上一列的标签');
    const rule = html.match(/\n  \.row-actions \{[^}]*\}/);
    assert.ok(rule, '.row-actions 规则存在');
    assert.match(rule[0], /display:\s*flex/, '行内排列');
    assert.match(rule[0], /flex-wrap:\s*wrap/, '放不下就换行（不换行就往左溢出）');
    assert.match(rule[0], /justify-content:\s*flex-end/, '仍然靠右');
    assert.ok(count(/class="row-actions"/g) >= 2, '至少资产与消费两处的行都用它');
    assert.ok(count(/'row-actions'/g) >= 1, '当天记录的行也用它（模板参数形式）');
  });

  test('所有列宽模板共用一处列间距（列宽按 fr 分配时单元格是紧贴的）', () => {
    // 回归：最初只有弹窗里那三张窄表给了 column-gap，而列表页的三张表**完全没有**——
    // 列宽按 fr 分配时单元格之间是紧贴的，「看着有空隙」只是因为内容短。实测：
    // `50,000.00CNY`、`¥50,000.000-0%`，表头连成「金额货币」「金额 (CNY)预期年化」。
    // 间距只能在**一处**定义：逐个模板各写一遍迟早漏一张（这正是当初漏掉三张表的原因）。
    const rules = html.match(/(?:^|\n)  [^{}\n]*(?:\n  [^{}\n]*)*?\{ column-gap: \d+px; \}/g) || [];
    assert.strictEqual(rules.length, 1, `column-gap 只应有一处定义（实得 ${rules.length} 处）`);
    const gap = Number(rules[0].match(/column-gap: (\d+)px/)[1]);
    assert.ok(gap >= 12, '列间距要够看（≥12px）');
    // 该规则必须覆盖全部六套模板 + 资产宽表
    for (const cls of ['cols-expenses', 'cols-expense-month', 'cols-income', 'cols-segment', 'cols-compare', 'cols-expense-segment', 'cols-snapshot']) {
      assert.ok(rules[0].includes('.' + cls), `${cls} 也要吃到列间距`);
    }
    assert.ok(rules[0].includes('.asset-row.grid-wide'), '资产宽表也要吃到列间距');
    assert.match(html, /\n  \.cols-expense-month \{ grid-template-columns: 96px 1fr 2fr 1\.5fr; \}/, '月度明细的日期栏定宽');
    assert.match(html, /\n  \.cols-expense-segment \{ grid-template-columns: 96px 1fr 0\.8fr 2\.6fr; \}/, '构成明细的日期栏定宽');
  });

  test('按钮尺寸只有两档小号（.btn-sm / .btn-xs），同类按钮不再各自内联', () => {
    assert.strictEqual(count(/btn-(ghost|gold|danger)[^>]*style="[^"]*(padding|font-size|white-space)/g), 0,
      '按钮尺寸必须走 .btn-sm / .btn-xs 档位，不再内联');
    for (const cls of ['btn-sm', 'btn-xs']) {
      assert.match(html, new RegExp(`\\.${cls}(,| \\{)`), `${cls} 档位在 CSS 里定义`);
    }
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
    assert.strictEqual(count(/class="select-field( |")/g), 15, '15 个下拉都挂同一类');
    assert.strictEqual(count(/class="select-field ml-2"/g), 6, '弹窗内下拉用既有 ml-2 工具类控制左间距');
    assert.match(html, /<input[^>]*id="expense-search"[^>]*class="t-body"/, '搜索框不再带内联宽度');
    assert.match(html, /\n  \.select-field \{ min-width: 160px; \}/, '下拉宽度只此一处');
    assert.match(html, /id="stress-dimension"[^>]*class="select-field field-full"/, '压测维度下拉撑满弹窗宽度（表单字段，不是工具条筛选）');
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
    assert.match(html, /<label class="field-label tight" for="asset-cash-ratio"[^>]*>/,
      '现金比例标签与读数同排，下间距应由父行承担');
    assert.match(html, /\n  \.field-label\.tight \{ margin-bottom: 0; \}/);
  });
});

describe('UI 接线契约：收益/读数文字色的角色类补齐', () => {
  test('正向收益色 .ink-up、加粗读数 .readout-strong 各自单一来源', () => {
    assert.strictEqual(count(/style="color:var\(--verdigris\);"/g), 0, '正向收益色应走 .ink-up');
    assert.match(html, /\n  \.ink-up \{ color: var\(--verdigris\); \}/);
    assert.strictEqual(count(/style="font-weight:600;color:var\(--fg\);"/g), 0, '加粗读数走 .readout-strong');
    assert.strictEqual(count(/style="font-weight:600;color:var\(--accent-ink\);"/g), 0, '加粗金墨读数走 .readout-strong.ink-accent');
    assert.match(html, /\n  \.readout-strong \{ font-weight: var\(--fw-strong\); \}/);
  });
});

/*
 * 分布图总数：资产/消费旭日图卡片上方的合计数。
 * --------------------------------------------------------------------------
 * 旭日图只给各部分占比，切右上角筛选后看不出「当前这一筛到底多少」——用户原话
 * 「现在我可以看到经过右上角筛选后的各个部分，但是没有一个总数」。
 * 口径必须两页一致：显示的总数与 tooltip 分毋是同一个变量，不得一个「已归类合计」
 * 一个「全局净值」（单测曾就是这么漏过一版口径分裂的）。
 */
describe('UI 接线契约：分布图总数（与扇区同源，随筛选联动）', () => {
  test('两个分布页都有总数容器，且图表卡片内只有这一处合计', () => {
    assert.match(html, /<p class="chart-total" id="chart-total"/, '资产分布有总数容器');
    assert.match(html, /<p class="chart-total" id="expense-chart-total"/, '消费分布有总数容器');
    assert.strictEqual(count(/class="chart-total"/g), 2, '两个分布页各一处，不铺开到其它图表');
  });

  test('两侧都调 logic.js 的 sumAmountCNY（不各写一遍 reduce）', () => {
    const expenseSrc = fnSource('renderExpenseChart');
    assert.ok(!/filtered\.reduce\(/.test(expenseSrc), '消费分布不得再自己 reduce 合计');
    assert.match(expenseSrc, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sumAmountCNY\(/, '消费分布走同一纯函数');
    // 报头净资产也委托同一纯函数：不得再自写一遍 reduce
    assert.match(fnSource('totalAssetsCNY'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sumAmountCNY\(/, '净资产合计与分布总数同源');
    // 总数渲染收在同一 helper，避免两处 DOM 副作用漂移
    assert.match(fnSource('renderChart'), /renderChartTotal\(/);
    assert.match(expenseSrc, /renderChartTotal\(/);
  });

  test('显示的总数与 tooltip 百分比分母是同一个变量（曾两套口径各算各的）', () => {
    // 曾一边显示「已归类合计」、一边用「全局净资产」做分母：同一张卡上两个总数，
    // 扇区百分比之和对不上显示的总数（口径分裂）。这里钉死「只用同一个 total 变量」。
    for (const fn of ['renderChart', 'renderExpenseChart']) {
      const src = fnSource(fn);
      const decl = src.match(/const (\w*[Tt]otal\w*) = (?!document\.)[^;]+;/);
      assert.ok(decl, `${fn} 应有一个金额合计变量（实测 ${JSON.stringify(src.slice(0, 60))}）`);
      const name = decl[1];
      assert.match(src, new RegExp(`(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?sunburstDrillView\\(data, ${name}, `), `${fn}: 派生以该筛选合计为起点`);
      assert.match(src, /renderChartTotal\(totalEl, view\.total\)/, `${fn}: 显示的总数用派生分母`);
      assert.match(src, /sunburstTooltipContent\(p, th, view\.total\)/, `${fn}: tooltip 分毋同源`);
    }
  });

  test('空态时不显示总数（与图表空态同一判据）', () => {
    // 每一条「提前退出/空态」路径都必须收起总数，否则会留一个孤零数字压在空态提示上。
    // 不逐一对齐 showChartOrEmpty 的次数：!cat 这类守卫也是早退路径，同样得收起。
    for (const fn of ['renderChart', 'renderExpenseChart']) {
      const src = fnSource(fn);
      const emptyBranches = src.match(/showChartOrEmpty\([^)]*false\)/g) || [];
      assert.ok(emptyBranches.length >= 2, `${fn} 有空态分支（实测 ${emptyBranches.length}）`);
      for (const line of emptyBranches) {
        const idx = src.indexOf(line);
        assert.match(src.slice(idx, idx + 200), /hideChartTotal\(/, `${fn} 的空态分支里应收起总数`);
      }
      // 显示分支（true）必须先于收起出现，否则收起会盖掉刚写上的值
      assert.match(src, /renderChartTotal\(/, `${fn} 应有显示总数的路径`);
    }
  });
});

/*
 * 视觉增强（台灯掠光 + 纸面质感）的接线契约。
 * --------------------------------------------------------------------------
 * 这一批改动的共同风险：①「跟随指针」的换算被写成第二份（CSS 一处、JS 一处），
 * 改了一处另一处不跟；②光晕层挂在有定位/拖拽语义的元素上，反而换了行为；
 * ③动效没有减动效出口，或整个地写死了 pointer 事件，触屏上白耗性能。
 */
describe('UI 接线契约：台灯掠光（跟随指针的纸面光）', () => {
  test('位置换算与开关判定都在 logic.js，页面只写 CSS 变量', () => {
    assert.match(html, /logic\.js/, 'logic.js 由页面脚本加载');
    const logic = logicSrc;
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampPos\(/, '坐标换算下沉 logic.js');
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampEnabled\(/, '开关判定下沉 logic.js');
    const src = fnSource('flushLamp');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampPos\(/, '走纯函数换算');
    assert.match(src, /setProperty\('--lamp-x'/, '只写 CSS 变量');
    assert.match(src, /setProperty\('--lamp-y'/, '只写 CSS 变量');
    assert.ok(!/\/\s*(window\.)?innerWidth/.test(stripComments(src)), '不得在页面里再算一遍百分比');
    // 逐次写变量会让全屏固定层的渐变每帧重算：坐标必须靠 rAF 合并
    assert.match(html, /_lampRaf = requestAnimationFrame\(flushLamp\)/, '每帧只写一次');
  });

  test('事件注册唯一：pointermove 只挂一处，且不在被 patch 的元素上重复注册', () => {
    assert.strictEqual(count(/addEventListener\('pointermove', updateLamp\)/g), 1, '指针移动只挂一次');
    assert.strictEqual(count(/function updateLamp\(/g), 1, 'handler 唯一');
    // 光晕层本身必须不吃事件：否则 hover/拖拽/点击全被它挡在下面
    assert.match(html, /\n  \.lamp-layer \{[^}]*pointer-events: none/, '光晕层不吃指针事件');
    assert.match(html, /\n  \.lamp-layer \{[^}]*position: fixed/, '光晕层脱离文档流');
    // z-index: -1 = 在流内容之后、根背景之前；实测仍可见（负 z-index 不会落到根背景后面）。
    // 用它就不必给任何内容抬 z-index，日后新增元素天然在灯之上
    assert.match(html, /\n  \.lamp-layer \{[^}]*z-index: -1/, '灯在内容之后（不给内容留抬升负担）');
    assert.ok(!/header, main \{ position: relative; z-index/.test(html), '不得靠逐个抬内容 z-index 让灯可见');
  });

  test('减动效 / 粗指针 / 页面不可见三种情况都不跟（判定单一来源）', () => {
    assert.strictEqual(count(/(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampEnabled\(/g), 1, '页面只调用、不重写判定');
    assert.match(html, /prefers-reduced-motion/, '减动效有出口');
    assert.match(html, /pointer: coarse/, '触屏不跟（无悬停可言）');
    assert.match(fnSource('syncLamp'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampEnabled\(/, '开关走纯函数');
  });

  test('还没收到指针坐标前不亮灯（首帧在正中先亮一团光再跳走，不像灯）', () => {
    const src = fnSource('syncLamp');
    assert.match(src, /_lampLast !== null/, '未收到坐标时不得点亮');
    assert.match(fnSource('setLampAt'), /syncLamp\(\);/, '首枚坐标到达时点亮');
  });

  test('掠光是纸面光学，不该给卡片/行另加一套悬停渐变（各部件各有自己的 hover 语义）', () => {
    // 表格行的 hover 是「当前行」的指示，曾经就是纯底色；不得被光晕改写
    assert.match(html, /\n  \.asset-row:hover \{ background: var\(--card-2\); \}/, '行悬停语义不变');
    const mats = html.match(/radial-gradient\(\d+px \d+px at var\(--lamp-x/g) || [];
    assert.strictEqual(mats.length, 1, '指针处的小圆芯只此一处');
    const lampCss = html.match(/\.lamp-layer \{[^}]*\}/)[0];
    assert.match(lampCss, /var\(--lamp-x, 50%\)/, '未收到指针时停在居中兜底值');
    assert.match(lampCss, /transparent calc\(var\(--lamp-x, 50%\) [-+]/, '光带位置随指针（而非固定条纹）');
    assert.ok(!/radial-gradient\(5\d\dpx/.test(lampCss), '不得用大半径圆霍冒充光');
  });
});

describe('UI 接线契约：纸面质感与印刷细节', () => {
  test('页头背景收回 CSS 变量类（内联渐变会让 AA 巡检整块跳过）', () => {
    const header = html.match(/<!-- Header -->[\s\S]*?<\/header>/)[0];
    assert.ok(!/style="[^"]*background/.test(header), '页头不得内联背景（渐变底无法校对比度，会整块豁免）');
    assert.match(header, /class="app-header/, '背景改由类名承担');
    assert.match(html, /\n  \.app-header \{[^}]*background: var\(--bg\)/, '页头底色走主题变量');
  });

  test('纸纹与灯具的颜色全部走 CSS 变量（两套主题一一对应）', () => {
    for (const v of ['--lamp-tint', '--lamp-glow', '--engrave', '--engrave-w']) {
      const decls = (html.match(new RegExp(`${v}:`, 'g')) || []).length;
      assert.strictEqual(decls, 2, `${v} 必须在亮/暗两套 :root 里各定义一次（实得 ${decls} 处）`);
    }
  });

  test('关键动效均可在减动效下关停（光晕在减动效下直接不画）', () => {
    // 光晕靠 pointermove + rAF 驱动，必须有一条 CSS 侧的硬出口
    // （logic.js 的 lampEnabled 是另一道闸，两重保险：JS 不写 + CSS 不画）
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ \.lamp-layer \{ display: none; \} \}/, '光晕在减动效下直接不画');
    assert.match(fnSource('syncLamp'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?lampEnabled\(/, 'JS 侧也走同一道判定');
  });
});

/*
 * 脚本自身可解析性：单文件 SPA 没有构建步骤，也没人为每个 <script> 跑 lint，
 * 一个重复的顶层声明（哪怕一个是 let、一个是 const）就会让整段脚本死在解析期——
 * 症状是「页面在，但没有数字」，renderAll 之后的所有接线都不存在（点设置没反应、图表不画），
 * 而浏览器只在控制台留一行 SyntaxError。实测代价：台灯一节重复声明了 masthead 已有的
 * _reduceMotion，全套 E2E 红了 26 条。
 *
 * 这里用 new Function 做**真正的解析**（只解析、不执行，也不需要 DOM）：
 * 比手写正则数重名可靠得多——正则只看同类声明，漏掉 let 与 const 撞名这类真错。
 */
describe('UI 接线契约：源码清单与页面的加载顺序一致', () => {
  // 拆分把「哪些文件属于运行时」从「目录里有什么」变成了「几份清单里写了什么」。
  // 漏登一份的症状不是红，而是**围栏静默地不罩它**：语法解析、全仓外呼扫描、跨文件重名
  // 都会跳过它。所以清单本身要被 index.html 盯住（顺序也盯：顺序就是级联与执行次序）。
  test('scripts / stylesheets 与本文件里的清单一一对应（含顺序）', () => {
    const scripts = [...markup.matchAll(/<script src="([^":/]+\.js)"><\/script>/g)].map((m) => m[1]);
    const sheets = [...markup.matchAll(/<link rel="stylesheet" href="([^":/]+\.css)">/g)].map((m) => m[1]);
    assert.deepStrictEqual(scripts, [...BOOT_FILES, ...LOGIC_FILES, ...JS_FILES],
      '页面里的本地脚本清单（含顺序）必须与 BOOT_FILES / LOGIC_FILES / JS_FILES 完全一致');
    assert.deepStrictEqual(sheets, CSS_FILES, '页面里的本地样式表清单（含顺序）必须与 CSS_FILES 一致');
    assert.ok(scripts.length > 10 && sheets.length >= 3, '正则没抽到东西时不能让这条断言假绿');
  });
});

describe('UI 接线契约：页面脚本必须能通过解析', () => {
  // 逐个文件解析、再整体解析一次：跨文件的顶层重名只有拼起来才会显形。
  for (const file of [...BOOT_FILES, ...JS_FILES]) {
    test(`${file} 可解析`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      // 下限用字符数，不用字节数：中文在本文件里一字一字符、三字节，拿 5000 卡会把
      // 只装了下拉/换算这种小活儿的新文件误报成「没读到全文」。读失效只会得到空串。
      assert.ok(src.length > 500, `${file} 应取到全文（读文件是否失效？）`);
      assert.doesNotThrow(() => new Function(src), `${file} 存在语法错误`);
    });
  }

  test('页面脚本拼起来可解析（跨文件顶层声明重名会在此现形）', () => {
    assert.ok(js.length > 10000, '应取到脚本全文');
    assert.doesNotThrow(() => new Function(js), '顶层声明跨文件重名——整段脚本都不会执行');
  });

  test('logic.js 可解析', () => {
    const logic = logicSrc;
    assert.doesNotThrow(() => new Function(logic));
  });

  test('顶层声明去重检查本身有效（对重名样本报错）', () => {
    assert.throws(() => new Function('let a = 1;\nconst a = 2;'), SyntaxError);
  });
});

/*
 * 分布图的版式：旭日图 + 构成清单并列。
 * --------------------------------------------------------------------------
 * 旭日图的外径受容器**高度**限制（要正圆），而卡片宽度有 1100px 左右 ——
 * 实测 1054×520 的画布里，左右各有 293px 是纯白（共占 56% 宽度）。
 * 与其让那一片白空着，不如把「谁占多少」列出来：图给比例直觉，清单给确切数字，
 * 顺带把占比从「悬停才看得见」变成一眼可读。
 */
describe('UI 接线契约：分布图的两栏（图 + 构成清单）', () => {
  test('两张旭日图都在 .chart-split 里，右侧清单容器各一处', () => {
    for (const [chartId, listId] of [['sunburst-chart', 'chart-legend'], ['expense-sunburst-chart', 'expense-chart-legend'], ['income-chart', 'income-chart-legend']]) {
      // chart-split 与图容器必须相邻（中间只隔着 chart-canvas 这层），
      // 用「两 id 之间的距离」判定，比嵌套正则稳
      const split = html.indexOf('class="chart-split"');
      assert.ok(split >= 0, '.chart-split 存在');
      const blocks = html.split('class="chart-split"').slice(1);
      assert.ok(blocks.some(b => b.indexOf(chartId) >= 0 && b.indexOf(chartId) < 400),
        `${chartId} 应紧跟在 .chart-split 内（否则又回落到一片白的居中布局）`);
      assert.strictEqual(count(new RegExp(`id="${listId}"`, 'g')), 1, `${listId} 容器唯一`);
    }
    assert.strictEqual((html.match(/class="chart-canvas[ "]/g) || []).length, 3, "三张旭日图都走同一个容器类（高度比例只在类里定义）");
  });

  test('清单渲染走 logic.js 的 sunburstBreakdown（占比口径单一来源）', () => {
    assert.strictEqual(count(/function renderSunburstLegend\(/g), 1, '清单渲染只此一处实现');
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstLegendRows\(/, '排序/占比/选中口径下沉 logic.js');
    // 占比不得在页面里再算一遍（同一张卡上两个「占比」各算各的口径就是 bug）
    assert.ok(!/\/\s*total\s*\*\s*100/.test(stripComments(src)), '不得内联重写百分比');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?formatCNY\(/, '金额走统一格式化');
  });

  test('清单与图共用同一个分母（总数、tooltip 百分比、清单百分比三者同源）', () => {
    // 三处（卡片总数显示 / tooltip 百分比 / 清单占比）必须都指向同一个变量名
    const cases = [
      ['renderChart', 'totalCNY'],
      ['renderExpenseChart', 'total'],
    ];
    for (const [fn, name] of cases) {
      const src = fnSource(fn);
      // 用字面量包含判定，不用 RegExp：`\(` 在 JS 字符串里会退化成分组括号，
      // 于是 `f(a)` 变成「f 后紧跟 a」而永远匹配不上（这个坑刚踩过）
      assert.ok(src.includes(`const ${name} = `), `${fn} 应有总数变量 ${name}`);
      assert.ok(src.includes(`sunburstDrillView(data, ${name}, `), `${fn}: 派生分母以筛选合计为起点`);
      assert.ok(src.includes('sunburstTooltipContent(p, th, view.total)'), `${fn}: tooltip 分母同源`);
      assert.ok(src.includes('renderChartTotal(totalEl, view.total)'), `${fn}: 卡片总数同源`);
      // 清单调用跨行，按「整条调用语句包含该变量」判（不用跨行通配，行尾是 CRLF）。
      // 每个函数里 renderSunburstLegend 出现两次：空态传 []/0（清空用），有数据时传 data/该 total。
      // 这里只对**带 data 的那一次**断言分母，否则会误抓到空态那次。
      const calls = src.split('renderSunburstLegend(').slice(1).map(c => c.slice(0, c.indexOf(')')));
      assert.ok(calls.length >= 1, `${fn}: 应调用 renderSunburstLegend`);
      const dataCall = calls.find(c => !/^'[^']*', *\[\]/.test(c));
      assert.ok(dataCall, `${fn}: 应有带 data 的清单调用`);
      assert.ok(dataCall.includes('view.total'), `${fn}: 清单占比必须用与 tooltip 同一个分母`);
    }
  });

  test('悬停清单行联动高亮扇区（按原 data 下标定位，不用行号）', () => {
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /dispatchAction\(\{ *type: *'highlight'/, '悬停高亮对应扇区');
    assert.match(src, /dispatchAction\(\{ *type: *'downplay'/, '移出恢复');
    assert.match(src, /dataIndex: a\.flat/, 'dataIndex 取自行上带的扁平树下标');
    // 清单按值降序排过，行号 ≠ dataIndex：必须把 r.idx 写进 data-idx，
    // 用 map 的第二参（行号）就会「悬停 A 高亮 B」（这个 bug 刚犯过一次）
    assert.match(src, /data-idx="\$\{r\.idx\}"/, 'data-idx 用 r.idx（原 data 下标）');
    assert.ok(!/data-idx="\$\{i\}"/.test(src), '不得用行号当 dataIndex');
    // 顶层 idx 不是 ECharts 的 dataIndex（虚拟根占 0）——必须经 sunburstNodePath 换算并存进 data-flat
    assert.match(src, /data-flat="\$\{flat/, '扁平树下标由 sunburstNodePath 算出后写在行上');
  });

  test('清单行的色块直接取数据节点的 itemStyle.color（与扇区同一份色值）', () => {
    const src = fnSource('renderSunburstLegend');
    // 不再按「分类在 data 里的下标」重算色板：下钻时 data 已被裁成单个分类，
    // 下标恒为 0，于是 HKD（绿）的色块会变成 CNY 的红色（真实浏览器实测过）
    assert.match(src, /itemStyle\.color/, '色块取节点自带的色值');
    assert.ok(!/CATEGORY_PALETTE\[/.test(src), '不得在清单里重算色板（下钻后下标会失真）');
    assert.ok(!/catColor|expenseCatColor/.test(src), '不混用 pill 调色板（两套色板各司其职）');
  });
});

/*
 * 顶端模式选择的左右次序：消费在左、资产在右。
 * --------------------------------------------------------------------------
 * 理由（为什么值得一条断言守着）：
 *   ① 默认模式是消费 —— 首屏选中的那个落在左边，读写方向与「第一项 = 默认」的直觉对齐；
 *   ② 资产侧是有门槛的（长按 + 确认），把它放在顺手的第一位，等于用位置在劝人误触；
 *      放右侧让它明确是「退一步才做的动作」。
 * 这不是纯装饰：按钮次序还决定了键盘 Tab 的焦点次序（Tab 键早已交还浏览器），
 * 排错了会让人第一次按 Tab 就落在门槛按钮上。
 */
describe('UI 接线契约：顶端模式按钮的次序（消费在左 / 资产在右）', () => {
  test('DOM 次序即消费在前、资产在后（同时决定 Tab 焦点次序）', () => {
    const bar = html.match(/<div class="seg-control">\s*<!--[\s\S]*?<\/div>/);
    assert.ok(bar, '页头模式选择存在');
    const order = [...bar[0].matchAll(/id="(mode-assets|mode-expenses)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(order, ['mode-expenses', 'mode-assets'],
      '消费必须在资产之前（默认模式落在左边；资产是带门槛的动作，不该占顺手位）');
  });

  test('默认高亮仍在消费（换位不得顺手改了默认模式）', () => {
    assert.match(html, /id="mode-expenses"[^>]*class="seg-btn active"/, '消费默认 active');
    assert.ok(!/id="mode-assets"[^>]*class="seg-btn[^"]*active/.test(html), '资产不得默认 active');
    assert.match(html, /let currentMode = 'expenses'/, '初始模式仍是消费');
  });
});

/*
 * 卡片材质：液态玻璃（半透明 + 背光模糊 + 受光方向 + 深度）。
 * --------------------------------------------------------------------------
 * 为什么值得契约守：
 *   ① **底必须透光过半**（不再是纯白 `--card`）——这是「液态」的全部来源：
 *      纸面与桌光要能透过卡片看见，卡面才会随背景与指针「活」起来；
 *   ② **不得给 .card 写 background-image**：渐变底会让 AA 巡检对卡片内**每一行字**
 *      静默跳过（上一轮页头就是这么漏检的）。所有光泽都只能靠 box-shadow；
 *   ③ 玻璃色必须是 CSS 变量且亮/暗各一套：写死就做不到两套主题，也会被 theme 巡检判为越界；
 *   ④ **受光方向**：顶面接光、远端转开。四边一圈等亮时，玻璃就只是一块有描边的白板。
 * 这里守「写下来的东西」（源码文本）；「渲染出来对不对」由 e2e/glass-material.spec.js
 * 在真实浏览器里量像素——同一改动的两半。
 */
describe('UI 接线契约：卡片的液态玻璃材质', () => {
  const cardRule = () => html.match(/\n  \.card \{[\s\S]*?\n  \}/)[0];

  test('.card 半透明 + 背光模糊，且不写 background-image（否则 AA 巡检整块跳过）', () => {
    const card = cardRule();
    assert.match(card, /background: var\(--glass-fill\)/, '底走玻璃变量（半透明）');
    assert.match(card, /backdrop-filter: blur\(/, '背光模糊是「玻璃」的核心');
    assert.match(card, /-webkit-backdrop-filter: blur\(/, 'Safari 前缀');
    assert.ok(!/background-image/.test(card), '卡片不得用渐变作底（AA 巡检会整块豁免）');
    assert.ok(!/\.card::(before|after)/.test(html), '材质不得另加伪元素：它会让正文底下的真实取色偏离 AA 巡检的假设');
  });

  test('材质打包进 --glass-shadow，:hover 只换外阴影（不重抄一遍材质）', () => {
    const shadowVar = html.match(/--glass-shadow:[\s\S]*?;/g) || [];
    assert.strictEqual(shadowVar.length, 1, '--glass-shadow 只能定义一次');
    assert.match(shadowVar[0], /var\(--glass-rim\)/, '受光边在里面');
    assert.match(shadowVar[0], /var\(--glass-shade\)/, '背光边在里面');
    assert.match(cardRule(), /box-shadow: var\(--glass-shadow\)/, '外阴影与材质叠加');
    const hovers = html.match(/\n  \.card[^\n{]*:hover[^\n{]*\{[^}]*\}/g) || [];
    assert.ok(hovers.length > 0, ':hover 规则还在（没被合并进基础规则）');
    for (const h of hovers) {
      assert.ok(!/inset/.test(h), `:hover 不得重抄材质（只换外阴影）：${h.slice(0, 60)}`);
      assert.match(h, /var\(--glass-depth-lift\)/, ':hover 的深度也走打包变量（不重写一遍影层）');
    }
  });

  test('受光方向靠 box-shadow 的偏移实现（受光在上、背光在下）', () => {
    const shadow = html.match(/--glass-shadow:[\s\S]*?;/)[0];
    assert.match(shadow, /inset 0 1px 0 var\(--glass-rim\)/, '顶边 1px 受光');
    assert.match(shadow, /inset 0 -1px 0 var\(--glass-shade\)/, '底边 1px 背光（远端转开）');
    assert.match(shadow, /inset \d+px \d+px[^,]*var\(--glass-sheen\)/, '左上角柔光：偏移为正（光在厚度里漫开）');
    assert.match(shadow, /inset -\d+px -\d+px[^,]*var\(--glass-shade\)/, '右下角内暗：偏移为负（与掠光相反）');
  });

  test('柔光的涉足范围小于卡片内边距（不然它会把正文底下的真实取色改掉）', () => {
    // 涉足 = 偏移 + 模糊 + 扩展。掠光会把局部底色提亮，而 AA 巡检按 fill 这个平底色算，
    // 故它只允许待在内边距带里（实测：正文首行的实取色对比仍有 6.4:1，见 LESSONS「版式、颜色与主题」）。
    const shadow = html.match(/--glass-shadow:[\s\S]*?;/)[0];
    const reach = [...shadow.matchAll(/inset (-?\d+)px (-?\d+)px (\d+)px (-?\d+)px/g)]
      .map((m) => Math.max(+m[1], +m[2]) + +m[3] + +m[4]);
    const padding = parseFloat(cardRule().match(/padding: (\d+)px/)[1]);
    for (const r of reach) assert.ok(r < padding, `柔光涉足 ${r}px 超过了内边距 ${padding}px`);
  });

  test('玻璃材质只在 .card 一处定义（同类结构同一实现，不逐个组件重写）', () => {
    // 材质变量只允许出现在 .card 自身的规则块里；别处出现就是有组件在自己的规则里重写了材质
    const card = cardRule();
    for (const v of ['--glass-fill', '--glass-edge', '--glass-rim', '--glass-sheen', '--glass-shade', '--glass-inner']) {
      const uses = (html.match(new RegExp(`var\\(${v}\\)`, 'g')) || []).length;
      const inCard = (card.match(new RegExp(`var\\(${v}\\)`, 'g')) || []).length;
      assert.strictEqual(uses, inCard, `${v} 只允许在 .card 的材质里使用（实得 ${uses} 处，其中材质 ${inCard} 处）`);
    }
  });

  test('玻璃色与桌光色在亮/暗两套 :root 各定义一次（否则暗色回落成亮色的一套）', () => {
    for (const v of ['--glass-fill', '--glass-edge', '--glass-rim', '--glass-sheen', '--glass-shade', '--glass-inner', '--desk-lit', '--desk-fall']) {
      const decls = (html.match(new RegExp(`${v}:`, 'g')) || []).length;
      assert.strictEqual(decls, 2, `${v} 必须在亮/暗各定义一次（实得 ${decls} 处）`);
    }
  });

  test('桌光是静止的一层（唯一跟指针走的光仍是台灯）', () => {
    const desk = html.match(/body::after \{[\s\S]*?\}/)[0];
    assert.match(desk, /position: fixed/, '铺满视口，不跟着滚动跑');
    assert.match(desk, /z-index: -2/, '落在纸纹之后（纸是铺在桌上的）');
    assert.ok(!/--lamp/.test(desk), '桌光不得跟指针走（那就成了第二盏灯）');
  });

  test('半透明底不得靠 opacity 实现（那会把卡片里的字一起淡化掉）', () => {
    assert.ok(!/^\s*opacity:/m.test(cardRule()), '透明度只能靠颜色 alpha，不能用 opacity');
  });
});

describe('UI 接线契约：弹窗遮罩（磨砂与颜色变量）', () => {
  const overlayRule = () => (html.match(/\n  \.modal-overlay \{[\s\S]*?\n  \}/) || [''])[0];

  test('遮罩色走 --scrim（亮/暗各一次），磨砂带 Safari 前缀', () => {
    const rule = overlayRule();
    assert.match(rule, /background: var\(--scrim\)/, '写死色值会在主题巡检的清理清单里长挂一行');
    assert.match(rule, /backdrop-filter: blur\(/, '磨砂是「背后账页退开」的质感来源');
    assert.match(rule, /-webkit-backdrop-filter: blur\(/, 'Safari 前缀');
    assert.strictEqual((html.match(/--scrim:/g) || []).length, 2, '--scrim 亮/暗各定义一次（漏一个会在另一套主题下回落）');
  });

  test('遮罩与便条的入场动画尊重减动效（与指示条/入场同一块 media）', () => {
    assert.match(
      html,
      /prefers-reduced-motion[^\n]*\.modal-overlay, \.modal-content \{ animation: none; \}/,
      '弹窗两层的入场动画要进 reduced-motion 块');
    assert.match(
      html,
      /prefers-reduced-motion[^\n]*\.toast \{ animation: none; transition: none; \}/,
      '便条的入场/退场同样归零');
  });
});

/*
 * 开屏（落纸）与动效约定
 * --------------------------------------------------------------------------
 * 用户要的是「开屏或其他特效，提升页面质感」。这里**不做**遮挡数据的 splash：
 * 这个应用的全部价值就是首屏那几个数字，遮住它等于扣分（也违反「无构建、直开即用」的性子）。
 * 改做一次非阻塞的入场：页面落到纸上（三段纸面依次落定）+ 台灯随后升起，由 html.ready 门控。
 *
 * 为什么用 html.ready 而不是直接写在元素上：base 状态必须是**最终态**（内容可见）。
 * 万一 JS 没跑（脚本报错、页面被当静态文件打开），必须有东西可看。
 */
describe('UI 接线契约：开屏（落纸入场）', () => {
  test('入场是两态 transition 且只在 booting 那一态才隐藏内容（base 即最终态）', () => {
    assert.match(html, /html\.booting:not\(\.ready\) \.app-header-inner/, '未落定那一态存在');
    assert.match(html, /html\.ready \.app-header-inner \{[^}]*transition:/, '落定那一态带过渡');
    assert.match(html, /html\.booting:not\(\.ready\) \.lamp-layer \{[^}]*opacity: 0/, '第二拍：未落定时按住台灯');
    const hiding = html.match(/html\.booting:not\(\.ready\)[^{]*\{[^}]*opacity:\s*0[^}]*\}/g) || [];
    assert.ok(hiding.length > 0, '未落定态确实在隐藏纸面');
    // 不得用 display/visibility 藏（那会让巡检与读屏器真的一无所见）
    for (const r of hiding) assert.doesNotMatch(r, /display:\s*none|visibility:\s*hidden/, r.slice(0, 60));
    // 不得用 @keyframes 做入场：隐藏容器里的元素会卡在 from 帧（实测过的坑）
    assert.doesNotMatch(html, /@keyframes settle/, '入场不得回到 keyframes 写法');
  });

  test('booting 与看门狗写在 <head> 的引导脚本里，ready 在首屏渲染完成后加', () => {
    // 引导脚本从 index.html 拆出去了："首帧前执行" 这件事现在由两个事实担保：
    // ① 它是 <head> 里的**阻塞**脚本（可以 defer 掉首屏，但会晚一帧）；② 它确实做了那两件事。
    const bootTag = markup.indexOf('<script src="boot.js"></script>');
    assert.ok(bootTag > 0, '首帧引导脚本由 index.html 加载');
    assert.ok(bootTag < markup.indexOf('<body>'), '引导脚本必须在 <head> 里（body 之前同步执行）');
    const boot = fs.readFileSync(path.join(__dirname, '..', 'boot.js'), 'utf8');
    assert.match(boot, /classList\.add\('booting'\)/, '首帧前就进入未落定态（否则会先看见内容再跳一下）');
    assert.match(boot, /setTimeout\(function \(\) \{[\s\S]*?classList\.add\('ready'\)/, '看门狗自己放行（脚本万一没跑到就绪，页面不得空白）');
    // 就绪点在「渲染完成之后」：DOMContentLoaded 里 renderAll 之后才翻转，否则落纸先于内容
    const readyFlip = html.match(/document\.addEventListener\('DOMContentLoaded'[\s\S]*?classList\.add\('ready'\)/);
    assert.ok(readyFlip, 'ready 由启动流程翻转');
    assert.ok(readyFlip[0].indexOf('renderAll()') < readyFlip[0].indexOf("classList.add('ready')"), '先渲染完，再落纸');
  });

  test('减动效要连延迟一起关（只关时长的话，带 delay 的入场会先停在未落定态）', () => {
    const kill = html.match(/\*, \*::before, \*::after \{[^}]*animation-duration: 0\.001ms[^}]*\}/);
    assert.ok(kill, '全局减动效闸门存在');
    assert.match(kill[0], /animation-delay:\s*0\.001ms !important/, '动画延迟也要归零');
    assert.match(kill[0], /transition-delay:\s*0\.001ms !important/, '过渡延迟也要归零');
  });

  test('不得有遮挡数据的开屏遮罩（全屏 splash / 加载动画都是错的工具）', () => {
    for (const bad of ['id="splash"', 'class="splash', 'id="boot-overlay"']) {
      assert.strictEqual(count(new RegExp(bad, 'g')), 0, `${bad} 不该存在`);
    }
  });
});

/*
 * 图表尺寸同步：每张 echarts 实例都要登记「盯住容器」。
 * --------------------------------------------------------------------------
 * 为什么值得契约守：尺寸不对是**静默**的——图还在，只是画在错误尺寸的画布上
 * （用户报的「全屏再缩小后图不对」就是这么来的），漏登记一张不会有任何报错。
 */
describe('UI 接线契约：图表尺寸同步', () => {
  test('图表实例只在宿主里创建一次，且紧跟尺寸登记（新增第六张图不用再登记）', () => {
    const inits = (html.match(/echarts\.init\(/g) || []).length;
    assert.strictEqual(inits, 1, `init 只应在 chartApply 里出现（实得 ${inits}）`);
    assert.match(
      html,
      /chart = echarts\.init\(spec\.el\);\s*\n\s*observeChartSize\(chart\);\s*\n\s*spec\.slot\.set\(chart\);/,
      'init 后立刻登记尺寸观察，再交给调用方的实例槽'
    );
    assert.strictEqual(count(/observeChartSize\(/g), 2, '定义一处 + 宿主调用一处');
  });

  test('尺寸只以容器的可见尺寸为准（隐藏时不 resize，那才是把图做废的那一步）', () => {
    const src = fnSource('syncChartSize');
    assert.match(src, /clientWidth/, '读容器宽');
    assert.match(src, /clientHeight/, '读容器高');
    assert.match(src, /if \(!w \|\| !h\) return/, '容器不可见（尺寸 0）时不动它');
    assert.ok(!/window\.addEventListener\('resize', \(\) => \{\s*if \(chart\)/.test(html),
      '原先那段 window resize 统一 resize 应收敛到 observeChartSize');
  });
});

/*
 * 旭日图的「选中分类 → 右侧清单联动」。
 * --------------------------------------------------------------------------
 * 需求原话：「选中其中一个层级的时候，他右边的标签可以联动成选中的当前分类下的一些标签」。
 * 两个入口（点图上的扇区、点清单里的分类行）必须走**同一条**路径——否则两处行为会各自漂移。
 * 另：ECharts 的 dataIndex 是扁平树下标（虚拟根占 0），高亮定位必须经 sunburstNodePath 换算，
 * 直接传顶层下标会差一个（曾真的高亮到隔壁扇区）。
 */
describe('UI 接线契约：旭日图选中分类后清单联动', () => {
  test('清单数据走 logic.js sunburstLegendRows（选中态与占比口径单一来源）', () => {
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstLegendRows\(/, '选中态/分母口径下沉 logic.js');
    assert.ok(!/\/\s*sub\s*\*\s*100/.test(stripComments(src)), '不得在页面里重写百分比');
  });

  test('高亮定位经 sunburstNodePath 换算（dataIndex 是扁平树下标，不是顶层下标）', () => {
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstNodePath\(/, '下标换算下沉 logic.js');
    // 不得直接把顶层 idx 当 dataIndex 用（那就是差一个的老 bug）
    assert.ok(!/dataIndex: *i *[,}]/.test(src), '不得把清单行下标直接当 dataIndex');
  });

  test('选中态是单一来源的模块级状态，且按图表容器各存一份', () => {
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /sunburstLegendSel/, '选中态存在模块级映射里（重绘后要能续上）');
    assert.match(fnSource('drillSunburst'), /sunburstLegendSel\[/, '切换选中走单一入口');
    assert.strictEqual(count(/function drillSunburst\(/g), 1, '入口唯一');
  });

  test('图上的扇区点击与清单行点击走同一条路径（两处行为不许各自漂移）', () => {
    assert.strictEqual(count(/function wireSunburstDrill\(/g), 1, '接线函数唯一');
    assert.strictEqual(count(/wireSunburstDrill\(/g), 4, '定义一处 + 三张图各接一次');
    const src = fnSource('wireSunburstDrill');
    assert.match(src, /drillSunburst\(/, '点击扇区 → 选中该分类');
    assert.match(src, /treePathInfo/, '用 ECharts 给的祖先路径判层级（顶层分类才下钻）');
    const legend = fnSource('renderSunburstLegend');
    assert.match(legend, /el\.onclick = /, '清单行点击挂在自己的渲染函数里');
    assert.match(legend, /drillSunburst\(elId/, '行点击 → 同一个 drillSunburst 入口');
    // 选中态只有两个合法写入点：① 用户切换（drillSunburst）；② 渲染时发现选中分类
    // 在当前数据里已不存在，顺势清掉（否则状态会卡着，切回同名维度时莫名又进下钻态）。
    // 除此之外任何地方写它都是绕过这两道的「第二套状态管理」
    const writes = (html.match(/sunburstLegendSel\[[^\]]+\] = /g) || []);
    assert.strictEqual(writes.length, 2, `选中态只允许这两个写入点（实得 ${writes.length}）`);
  });

  test('空态/换维度时选中态被清掉，不留悬空分类', () => {
    // 空态分支必须同时清清单与选中态，否则切回来还停在上次的分类里。
    // 只数总数是不够的：曾有 5 处而消费分布的空维度分支恰恰是漏的那个（总数达标、
    // 那个分支还是不清）。改为「每个 showChartOrEmpty(..., false) 分支里都得清清单」。
    for (const [fn, elId] of [['renderChart', 'chart-legend'], ['renderExpenseChart', 'expense-chart-legend']]) {
      const src = fnSource(fn);
      const branches = src.split('showChartOrEmpty(').slice(1);
      const empties = branches.filter(b => b.startsWith('chartEl, emptyEl, false'));
      assert.ok(empties.length >= 2, `${fn} 应有空态分支（实得 ${empties.length}）`);
      for (const b of empties) {
        assert.ok(b.slice(0, 220).includes(`renderSunburstLegend('${elId}', [], 0, null)`),
          `${fn} 的每个空态分支都要清清单（图与清单同生共死）`);
      }
    }
    assert.match(fnSource('renderSunburstLegend'), /selected[\s\S]*?sunburstLegendRows/, '选中态由纯函数校验后回落');
  });

  test('关掉 ECharts 原生下钻（nodeClick:false），否则图上会有第二套视图状态', () => {
    const src = fnSource('buildSunburstOption');
    assert.match(src, /nodeClick: *false/, '必须显式关掉原生下钻');
    // 回潮即报错：两个原生入口（点击下钻、内环点击返回）都只由 nodeClick 驱动
    assert.doesNotMatch(src, /nodeClick: *'rootToNode'/, '不得交回 ECharts 自己管视图');
    assert.doesNotMatch(stripComments(html), /sunburstRootToNode/, '不得到处 dispatch 原生下钻动作');
  });

  test('三张旭日图的数据都经 sunburstDrillView 派生（图与清单同一套选中态）', () => {
    assert.strictEqual(count(/function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstDrillView\(/g), 0, '派生逻辑下沉 logic.js，页面不另写一份');
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart']) {
      const src = fnSource(fn);
      assert.match(src, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstDrillView\(/, `${fn}: 喂给图的数据必须由选中态派生`);
    }
    // 派生结果必须是**同一个变量**同时喂给图、tooltip、清单（否则又是一处口径分裂）
    const src = fnSource('renderChart');
    assert.match(src, /const view = (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?sunburstDrillView\(/, '派生结果收在 view 里');
    assert.match(src, /buildSunburstOption\(view\.data, /, '图用派生后的数据');
    assert.match(src, /renderSunburstLegend\('chart-legend', view\.data, view\.total/, '清单与图同源');
  });

  test('点清单行 / 点扇区 / 返回全部分类 都只走 drillSunburst（含重绘图）', () => {
    const src = fnSource('drillSunburst');
    assert.match(src, /sunburstRerender\[/, '重绘回调按容器取');
    // 登记的回调必须是**整个渲染函数**（清单 + setOption），否则图不会跟着下钻；
    // 只重绘清单会让「返回全部分类」后的图停在下钻层（就是这个 bug）
    for (const [fn, elId] of [['renderChart', 'chart-legend'], ['renderIncomeChart', 'income-chart-legend'], ['renderExpenseChart', 'expense-chart-legend']]) {
      const body = fnSource(fn);
      assert.ok(body.includes(`sunburstRerender['${elId}'] = ${fn}`), `${fn}: 重绘回调应登记为整个渲染函数`);
    }
    // 回潮即报错：选中态不得在别处被赋值（写入点仍只两处）
    const writes = (html.match(/sunburstLegendSel\[[^\]]+\] = /g) || []);
    assert.strictEqual(writes.length, 2, `选中态只允许两个写入点（实得 ${writes.length}）`);
  });

  test('下钻接线只在 init 时注册一次（每帧 on(click) 会累积监听器）', () => {
    assert.match(fnSource('chartApply'), /if \(spec\.wire\) spec\.wire\(chart\);/, '宿主在 init 分支里接线');
    for (const [fn, id] of [['renderChart', 'chart-legend'], ['renderIncomeChart', 'income-chart-legend'], ['renderExpenseChart', 'expense-chart-legend']]) {
      const src = fnSource(fn);
      assert.match(src, /wire: c => wireSunburstDrill\(c, '[^']+'\)/, `${fn}: 接线只作为 wire 回调交一次`);
      assert.strictEqual(count(new RegExp(`wireSunburstDrill\\([^)]*'${id}'\\)`, 'g')), 1, `${id}: 接线只出现一次`);
    }
  });

  test('setOption 前先清掉强调态（否则 blur 会粘在新扇区上）', () => {
    // 真实 ECharts 5 实测：下钻/返回后，setOption 重建的扇区会继承上一帧的 blur(0.2)，
    // 表现为几个扇区一直是灰的。这条现在由宿主统一守，调用点不得自己重绘。
    const src = fnSource('chartApply');
    const downplay = src.indexOf("dispatchAction({ type: 'downplay' })");
    const setOption = src.indexOf('setOption(');
    assert.ok(downplay >= 0, 'host: 重绘前应清强调态');
    assert.ok(downplay < setOption, 'host: downplay 必须在 setOption 之前（否则清的是旧扇区）');
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart', 'renderHistoryChart', 'renderExpenseTrendChart']) {
      assert.doesNotMatch(stripComments(fnSource(fn)), /dispatchAction|setOption/, `${fn}: 不得自己重绘`);
    }
  });
});

describe('UI 接线契约：拖拽排序的键盘替代', () => {
  test('拖拽把手必须可聚焦（否则纯键盘用户无法调整资产顺序）', () => {
    const h = stripComments(fnSource('renderAssets'));
    assert.match(h, /class="drag-handle"[^>]*tabindex="0"/, '把手要有 tabindex=0');
    assert.match(h, /drag-handle"[^>]*role="button"/, '把手要有 role=button');
    assert.match(h, /drag-handle"[^>]*aria-label="[^"]*上移[^"]*"/, '把手的可访问名要说明「上移」');
  });

  test('键盘移动走 moveAsset 单一入口（不在 keydown 里重写排序逻辑）', () => {
    assert.match(fnSource('moveAsset'), /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?moveAssetIndex\(/, '数组操作复用 logic.js 纯函数');
    assert.match(fnSource('moveAsset'), /sortBy = ''/, '移动后清空排序状态（与拖拽 drop 同一套收尾）');
    const h = stripComments(fnSource('renderAssets'));
    assert.match(h, /moveAsset\(/, '把手 keydown 必须调 moveAsset');
  });
});

describe('UI 接线契约：Tab/模式切换的过渡动画', () => {
  test('入场过渡挂在会动画的内层面板上：switchTab 触发，switchMode 只透传方向', () => {
    assert.match(fnSource('switchTab'), /enterTab\([\s\S]*?shift\)/, 'switchTab 要触发内层面板的入场过渡');
    const mode = stripComments(fnSource('switchMode'));
    assert.doesNotMatch(mode, /enterTab\(/,
      'switchMode 不得对 content-* 调 enterTab：动画选择器只认 [id^="tab-"] 内层面板，那是无人消费的死接线');
    assert.match(mode, /switchTab\([^)]*shift\)/, '方向经 switchTab 透传给真正入场的面板（一次翻页一个方向）');
  });

  test('入场过渡在 CSS 里统一定义（不逐处内联）', () => {
    assert.match(html, /\n  \[id\^="tab-"\]\.enter \{/, '入场态样式集中在 [id^=tab-].enter 一处');
    assert.match(html, /\[id\^="tab-"\]\.enter \{[^}]*animation/, '用 animation 表达入场（避免 JS 同步时序）');
  });

  test('减动效下入场动画直接归零（与开屏同一块 media）', () => {
    assert.match(
      html,
      /\[id\^="tab-"\]\.enter \{ animation: none; \}/,
      '入场动画要进 reduced-motion 块（delay 也归零）');
  });

  test('入场 class 必须是「下一帧加」（display 翻转后立即加会被一起渲染，等于没有过渡）', () => {
    const src = stripComments(fnSource('enterTab'));
    assert.match(src, /requestAnimationFrame/, '要用 rAF 隔一帧（否则初始态与终态同帧画出，动画不播）');
  });

  test('入场方向由 logic.js paneEnterShift 单一判定，经 --pane-x 交给 keyframes', () => {
    const logic = logicSrc;
    assert.match(logic, /function (?:[A-Za-z_$][A-Za-z0-9_$]*\.)?paneEnterShift\(/, '方向判定必须在 logic.js（可单测）');
    const tab = stripComments(fnSource('switchTab'));
    assert.match(tab, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?paneEnterShift\(/, 'switchTab 的方向要喂给同一份判定（不得各写一份）');
    assert.match(tab, /enterTab\([\s\S]*?shift\)/, 'switchTab 要把方向一并传给 enterTab');
    const mode = stripComments(fnSource('switchMode'));
    assert.match(mode, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?paneEnterShift\(/, 'switchMode 的方向同样走这份判定');
    assert.match(mode, /switchTab\([^)]*shift\)/, '并透传给内层 switchTab：一次「翻页」只有一个方向');
    assert.match(stripComments(fnSource('enterTab')), /--pane-x/, 'enterTab 把方向写进 --pane-x（CSS 唯一消费点）');
    assert.match(html, /@keyframes paneEnter \{[^}]*var\(--pane-x/, 'keyframes 消费 --pane-x');
  });
});

describe('UI 接线契约：点「当前这一页」时是空点击', () => {
  // 用户实测：「已经在消费分布这个标签下，再次点击它应该不生效，现在还会重新刷新页面」。
  // 空点击 = 不重绘、不重播入场。判定只能有一处：9 个 Tab 按钮各写一份必然漂移。
  test('Tab 按钮一律走 tabClick 单一入口', () => {
    const btns = [...html.matchAll(/<button class="tab-btn[^"]*"[^>]*onclick="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(btns.length >= 9, `两条 Tab 栏的按钮都要被抓到（现抓到 ${btns.length} 个）`);
    assert.deepStrictEqual([...new Set(btns)], ['tabClick(this)'], 'Tab 按钮只能有这一个入口');
    const src = stripComments(fnSource('tabClick'));
    assert.match(src, /classList\.contains\('active'\)[\s\S]*?return/, '已激活 = 空点击（判定即按钮自己的 active 态）');
    assert.match(src, /switchTab\(/, '未激活才真的切');
  });

  test('模式按钮同理：守卫必须早于重绘（迟一步整块已经重画过了）', () => {
    const mode = stripComments(fnSource('switchMode'));
    assert.match(mode, /if \(mode === currentMode\) return;/, '已经在这个模式里：直接返回');
    assert.ok(
      mode.indexOf('mode === currentMode') < mode.indexOf('currentMode = mode'),
      '守卫要在写状态 / 切面板之前，否则等于没守');
  });
});

describe('UI 接线契约：长按满时长自动弹窗', () => {
  test('满时长由 tick 直接弹窗（不再等松手）', () => {
    const src = stripComments(fnSource('tickModePress'));
    assert.match(src, /openAssetGate\(\)/, 'tick 满时长要直接抬闸');
  });

  test('自动弹出必须开守卫闸：紧跟的 pointerup/click 不得把弹窗点掉', () => {
    const logic = logicSrc;
    assert.match(logic, /AUTO_OPEN_GUARD_MS/, '守卫窗常量定义在 logic.js');
    assert.match(html, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?autoOpenGuard\(/, '守卫判定走 logic.js 纯函数（不重写一份）');
    const end = stripComments(fnSource('endModePress'));
    assert.match(end, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?autoOpenGuard\(/, 'pointerup 收尾必须查守卫（否则抬手即关）');
    const overlayBlock = blockFrom(html, '__modalMouseDownTarget = e.target', '__modalMouseDownTarget = null');
    assert.match(overlayBlock, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?autoOpenGuard\(/, '遮罩 click 关闭也必须查守卫');
    const okBtn = blockFrom(stripComments(html), "getElementById('confirm-ok-btn').addEventListener");
    assert.match(okBtn, /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?autoOpenGuard\(/, '确认按钮的 click 也必须查守卫');
  });

  test('弹窗必须真的从 tick 里弹出，而不是把确认框推后到松手', () => {
    const tick = stripComments(fnSource('tickModePress'));
    assert.doesNotMatch(tick, /classList\.add\('armed'\)/, 'armed 停帧态不再需要（满了就弹）');
  });
});

/*
 * 下拉弹层（picker）跟主题走。
 * --------------------------------------------------------------------------
 * 回归背景：用户「我看一下现在下拉框的配色，都是纯白色的，和主题一点不符合」——
 * 闭合态早已是 var(--card)，纯白只可能来自浏览器画的弹层。弹层是系统绘制的，
 * 页面改不了它的底色，只能 opt-in `appearance: base-select` 由页面接管。
 *
 * 这里守三件事，每一件都对应一次实测踩坑：
 *   ① 必须**显式声明** `appearance: none` 作为回落基线。Chromium 的 UA `::picker(select)`
 *      appearance 计算值就是 `none`——若只写 base-select 而没写基线，不支持 base-select 的
 *      浏览器（Firefox/Safari）会撞上「同特异性后写者胜」的 `none`，弹层上色规则白写。
 *      只有先 `none` 再 `@supports (appearance: base-select)` 才两头都对。
 *   ② 弹层配色只能走主题变量。写死 #fff 就是这次要修的东西本身。
 *   ③ 闭合态宽度必须钉住（见 logic.js 的 selectIntrinsicWidth）：opt-in 之后 select 不再
 *      按最长选项取宽，实测 231px 的下拉会随选中项在 160/186/214 之间跳。
 */
describe('UI 接线契约：下拉弹层跟主题（base-select）', () => {
  test('先声明 appearance:none 基线，再在 @supports 里 opt-in（顺序不可颠倒）', () => {
    const none = html.indexOf('appearance: none;');
    const optIn = html.indexOf('@supports (appearance: base-select)');
    assert.ok(none > 0, '必须显式声明 appearance:none 作为不支持 base-select 的回落基线');
    assert.ok(optIn > 0, '必须有 @supports (appearance: base-select) 的能力判定');
    assert.ok(none < optIn, '基线必须在前：Chromium 的 UA 弹层 appearance 就是 none，后写会把上色规则挤掉');
    const block = html.slice(optIn, html.indexOf('\n  }', html.indexOf('body select::picker(select)', optIn)));
    assert.match(block, /body select::picker\(select\)/, '弹层本身要 opt-in（只 opt-in 控件不生效，实测画面不变）');
    assert.match(block, /::picker-icon\s*\{\s*display:\s*none/, '隐掉 UA 的第二枚箭头，统一用自绘 --chevron');
  });

  test('弹层与选项的配色只走主题变量（写死 #fff 就是这次要修的东西）', () => {
    const start = html.indexOf('@supports (appearance: base-select)');
    assert.ok(start > 0, '@supports 块存在');
    const block = html.slice(start, html.indexOf('body input:focus', start));
    assert.ok(block.length > 200, '提取到的块不能是空的（空块会让下面的断言全部假绿）');
    for (const prop of ['background', 'color', 'border']) {
      const re = new RegExp(String.raw`body select::picker\(select\) \{[^}]*${prop}:\s*([^;]+);`);
      const m = block.match(re);
      assert.ok(m, `弹层必须显式给 ${prop}`);
      assert.match(m[1], /var\(--/, `弹层 ${prop} 必须走主题变量，实测值：${m[1]}`);
    }
    assert.doesNotMatch(block, /#fff\b|#ffffff|white/i, '弹层块内不得出现写死的白色');
  });

  test('弹层里的 option 必须显式配色（UA 默认是黑字透明底，暗色下会看不见）', () => {
    assert.match(html, /body select option \{[^}]*color:\s*var\(--fg\)/, 'option 字色必须显式给（暗色下 UA 黑字读不出）');
    assert.match(html, /body select option \{[\s\S]*?padding:[^;]*28px/, '左内边距要给 UA 勾选标记留位置');
    assert.match(html, /body select option:hover[\s\S]{0,80}var\(--accent-soft\)/, '悬停态走 accent-soft');
  });

  test('闭合态宽度由固有宽度测量钉住（不得在页面里另写一套判据）', () => {
    const logic = logicSrc;
    assert.match(logic, /function shouldPinSelectWidth\(/, 'logic.js 定义 shouldPinSelectWidth');
    assert.match(logic, /\n      shouldPinSelectWidth,/, 'logic.js 在 ui 域导出 shouldPinSelectWidth');
    assert.match(fnSource('freezeSelectWidth'), /ui\.shouldPinSelectWidth\(/, '页面调用 logic.js 的判据（不重写一份）');
    assert.match(html, /--sel-w/, '宽度经 CSS 变量落回样式（单一来源）');
    assert.match(html, /body select \{[^}]*width:\s*var\(--sel-w/, 'select 的 width 必须引用 --sel-w');
    // 量本必须剥成原生外观：继承到 base-select 就会量到「被钉过的宽度」（实测 160 而非 231）
    assert.match(fnSource('freezeSelectWidth'), /data-measuring/, '量本必须带 data-measuring');
    assert.match(html, /select:not\(\[data-measuring\]\)/, 'CSS 要给量本排除 base-select');
  });

  test('切 Tab 时重新量一次（隐藏 Tab 里的下拉当时 clientWidth 为 0）', () => {
    const fn = fnSource('switchTab');
    assert.match(fn, /freezeSelectWidths\(/, '切 Tab 后必须重量');
    assert.match(html, /document\.fonts\.ready\.then\(\(\) => \{ freezeSelectWidths\(\)/, '字体就绪后必须重量（回退字体量出的宽会偏）');
  });
});

/*
 * 多语言契约：界面文案的两条通道都必须走词条表。
 * --------------------------------------------------------------------------
 * 单文件 SPA 没法在编译期发现「漏译」：裸中文留在模板里，英文界面上就只是一句中英混排，
 * 不影响功能、也不报错，只有用户看得见。这里把三种漏法都变成红灯：
 *   ① 静态文案没挂 data-i18n；② 脚本里游离的中文字面量；③ 用到的键没有英文词条。
 */
describe('UI 接线契约：导出全在本机', () => {
  const receiptSrc = fs.readFileSync(path.join(__dirname, '..', 'app-receipt.js'), 'utf8');
  const RUNTIME_FILES = ['index.html', ...BOOT_FILES, ...JS_FILES, 'logic.js'];
  const runtimeSrc = RUNTIME_FILES.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');

  // 逐文件钉住两个导出入口不够：新增一个页面脚本就又是一块没人看守的地方。
  // 这里改成对**整份运行时**求值——账本不出机器应当是全局性质，不是两个文件的性质。
  test('全仓只有一处 GET（汇率），没有能带数据的外呼', () => {
    const clean = stripComments(runtimeSrc);
    const fetches = clean.match(/\bfetch\s*\(/g) || [];
    assert.strictEqual(fetches.length, 1, '运行时只允许 fetchRates 一处 fetch；新增外呼必须在这里登记');
    assert.match(clean, /fetch\('https:\/\/[^']*cny\.json',\s*\{\s*cache:\s*'no-store'\s*\}\)/,
      '唯一的那一处必须是取汇率的 GET（无 method / body）');
    assert.doesNotMatch(clean, /\b(?:method|body)\s*:/, '不得构造带方法或请求体的请求');
    assert.doesNotMatch(clean, /XMLHttpRequest|sendBeacon|new WebSocket|FormData|navigator\.send/,
      '不得出现其它能带数据出去的通道');
  });

  test('外部地址只许是登记过的那几个库/字体，纯逻辑里一个都不许有', () => {
    const ALLOWED = [
      'https://cdn.tailwindcss.com',
      'https://cdn.jsdelivr.net/npm/flatpickr',
      'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js',
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
      'https://fonts.googleapis.cn',
      'https://fonts.gstatic.cn',
      'http://www.w3.org/2000/svg', // data: SVG 里的命名空间，不是请求
    ];
    const urls = [...new Set(stripComments(runtimeSrc).match(/https?:\/\/[^"'`)\s>]*/g) || [])];
    const unknown = urls.filter(u => !ALLOWED.some(a => u === a || u.startsWith(a + '/') || u.startsWith(a + '?') || u.startsWith(a + '&')));
    assert.deepStrictEqual(unknown, [], '新增外部地址要在这里登记并说明它带不带账本数据：' + unknown.join(' | '));
    assert.doesNotMatch(logicSrc, /https?:\/\//,
      '纯逻辑层不碰网络');
  });

  test('小票画在画布上，不许任何网络调用', () => {
    assert.doesNotMatch(receiptSrc, /fetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|new Image\s*\(|\.src\s*=/, '导出路径不得有网络/外部资源');
    assert.match(receiptSrc, /createElement\('canvas'\)/, '画在本地画布上');
    assert.match(receiptSrc, /createObjectURL/, '用本地 blob 打开，不过网络');
    assert.match(receiptSrc, /window\.open\(url, '_blank'\)/, '默认在新标签打开');
  });

  test('备份导出也不过网络：文件窗口或下载，加密在本机', () => {
    const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'app-settings.js'), 'utf8');
    assert.doesNotMatch(settingsSrc, /fetch\s*\(/, '导出导入不得向外发送');
    assert.match(settingsSrc, /showSaveFilePicker/, '先走系统文件窗口');
    assert.match(settingsSrc, /new Blob\(/, '回落下载也是本地 blob');
  });
});

describe('UI 接线契约：多语言（默认英文，设置里切中文）', () => {
  const L = require('../logic.js');
  const CJK = /[\u4e00-\u9fff]/;
  const scriptStart = html.indexOf('<script src="logic.js"></script>');
  const inline = js;
  const bodySrc = markup.slice(markup.indexOf('<body'), markup.indexOf('<script src="logic.js">'));

  // 去掉 JS 注释（字符串里的 // 不算注释：按引号状态机走，避免把 URL 当注释截断）
  const stripJsComments = (src) => {
    let out = '';
    let i = 0;
    let mode = null;
    while (i < src.length) {
      const c = src[i];
      const nx = src[i + 1] || '';
      if (!mode) {
        if (c === '/' && nx === '/') {
          const j = src.indexOf('\n', i);
          i = j < 0 ? src.length : j;
          continue;
        }
        if (c === '/' && nx === '*') {
          const j = src.indexOf('*/', i);
          i = j < 0 ? src.length : j + 2;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') mode = c;
        out += c;
        i += 1;
        continue;
      }
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === mode) mode = null;
      out += c;
      i += 1;
    }
    return out;
  };

  // 跳过一次配平的调用（i18n.t(...)），字符串里的括号不参与配平
  const skipCall = (src, i) => {
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const q = c;
        i += 1;
        while (i < src.length) {
          if (src[i] === '\\') {
            i += 2;
            continue;
          }
          if (src[i] === q) {
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      i += 1;
    }
    return i;
  };

  const withoutCalls = (src) => {
    const clean = stripJsComments(src);
    let out = '';
    let last = 0;
    let idx = clean.indexOf('i18n.t(');
    while (idx >= 0) {
      out += clean.slice(last, idx) + "'__t__'";
      last = skipCall(clean, idx + 'i18n.t('.length);
      idx = clean.indexOf('i18n.t(', last);
    }
    return out + clean.slice(last);
  };

  test('默认语言是英文，且是用户设置（随存档落盘）', () => {
    assert.strictEqual(L.i18n.I18N_DEFAULT, 'en');
    assert.match(fnSource('freshAppState'), /lang: 'en'/, '新存档默认英文');
    assert.match(fnSource('loadState'), /migrate\.migrateState\(\)/, '缺失语言由迁移兜底（旧存档也落到英文）');
    assert.match(fnSource('setLang'), /state\.lang = next/, '当前语言写在 state 上（唯一所有者）');
    assert.match(fnSource('setLang'), /saveState\(\)/, '切换后落盘');
  });

  test('语言切换入口唯一在设置弹窗：英文/中文各接线一次，且切换后整页重绘', () => {
    assert.strictEqual(count(/onclick="setLang\('en'\)"/g), 1);
    assert.strictEqual(count(/onclick="setLang\('zh'\)"/g), 1);
    assert.strictEqual(count(/id="settings-modal"[\s\S]{0,3000}?setLang\('zh'\)/g), 1, '语言切换在设置弹窗内');
    const set = fnSource('setLang');
    assert.match(set, /applyI18nDom\(\)/, '静态文案必须重刷');
    assert.match(set, /renderAll\(\)/, '动态文案靠重绘换语言');
    assert.match(
      html,
      /function applyI18nDom\([\s\S]*?document\.documentElement\.lang = i18n\.langTag\(state\.lang\)/,
      'html lang 与静态文案同一出口写'
    );
    assert.match(fnSource('showSettings'), /syncLangSeg\(\)/, '打开设置时回显当前语言');
  });

  test('静态文案：body 里每一段中文都挂在 data-i18n 上（否则英文界面留中文）', () => {
    assert.ok(bodySrc.length > 10000, '应取到 body 全文（切片失效时下面会全绿的假象）');
    const leftovers = [];
    const re = />([^<>]+)</g;
    let m;
    while ((m = re.exec(bodySrc))) {
      const text = m[1].trim();
      if (!CJK.test(text)) continue;
      const tag = bodySrc.slice(bodySrc.lastIndexOf('<', m.index), m.index + 1);
      if (!/data-i18n=/.test(tag)) leftovers.push(text);
    }
    assert.deepStrictEqual(leftovers, [], '未挂 data-i18n 的中文文本节点：' + leftovers.join(' | '));
  });

  test('静态属性（aria-label / placeholder / title）中文必须挂 data-i18n-<attr>', () => {
    const leftovers = [];
    for (const line of bodySrc.split('\n')) {
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        const m = line.match(new RegExp(attr + '="([^"]*)"'));
        if (m && CJK.test(m[1]) && !line.includes('data-i18n-' + attr)) leftovers.push(attr + '=' + m[1]);
      }
    }
    assert.deepStrictEqual(leftovers, [], '未挂 data-i18n-<attr> 的中文属性：' + leftovers.join(' | '));
    assert.match(html, /const I18N_ATTRS = \['aria-label', 'placeholder', 'title', 'content'\]/, '属性通道覆盖这四类');
  });

  test('动态文案：内联脚本里没有游离的中文字面量（全部经 i18n.t）', () => {
    const leftovers = [];
    const re = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`]*)`/g;
    let m;
    while ((m = re.exec(withoutCalls(inline)))) {
      if (CJK.test(m[0])) leftovers.push(m[0].slice(0, 60));
    }
    assert.deepStrictEqual(leftovers, [], '未走 i18n.t 的中文字面量：' + leftovers.join(' | '));
  });

  test('覆盖率：页面与 logic.js 用到的每个键都有英文词条', () => {
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) keys.add(m[1]);
    for (const m of html.matchAll(/i18n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
    for (const m of stripJsComments(logicSrc).matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      keys.add(m[1].replace(/\\'/g, "'"));
    }
    const missing = [...keys].filter((k) => !(k in L.i18n.I18N_EN));
    assert.deepStrictEqual(missing, [], '缺英文词条（英文界面会回落中文）：' + missing.join(' | '));
  });

  test('英文表里没有死词条（动态键白名单显式登记）', () => {
    const used = new Set();
    for (const m of html.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/i18n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) used.add(m[1].replace(/\\'/g, "'"));
    for (const m of stripJsComments(logicSrc).matchAll(/(?<![\w.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      used.add(m[1].replace(/\\'/g, "'"));
    }
    // 这些键由三元表达式按当前状态选，静态扫描看不到；改动它们要同步这份清单
    const DYNAMIC = ['总收益', '现金收益', '每天', '每周', '升序', '降序', '换中文'];
    const dead = Object.keys(L.i18n.I18N_EN).filter((k) => !used.has(k) && !DYNAMIC.includes(k));
    assert.deepStrictEqual(dead, [], '没人用的词条会悄悄腐烂：' + dead.join(' | '));
  });

  test('占位符两边一致：键里的 {pN} 不得在翻译时丢掉或改名', () => {
    const placeholders = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    const bad = [];
    for (const [key, val] of Object.entries(L.i18n.I18N_EN)) {
      const want = placeholders(key);
      for (const s of Array.isArray(val) ? val : [val]) {
        const got = placeholders(s);
        if ([...want].some((p) => !got.has(p)) || [...got].some((p) => !want.has(p))) bad.push(key + ' → ' + s);
      }
    }
    assert.deepStrictEqual(bad, [], '占位符不一致：' + bad.join(' | '));
  });
});

/*
 * 背景冻结（弹窗打开时）：三条通道都得断，且只有一处说了算。
 * --------------------------------------------------------------------------
 * 用户原话：「我把鼠标放在背景下依然可以滚动外面已经模糊的背景，这个不应该」。
 * 遮罩的 blur 已经在视觉上说「停下来了」，交互上却还活着——这是**承诺与实现不一致**，
 * 单测看不出滚动，但能守住「锁只有一处派生」「叠层不会提前解锁」「冻结不误伤延伸层」。
 */
describe('UI 接线契约：弹窗打开时背景冻结', () => {
  test('滚动锁从「还有几层开着」派生，唯一同步点是 openModal / closeModal', () => {
    const sync = fnSource('syncScrollLock');
    assert.match(sync, /openModalStack\(\)/, '锁的状态只能从开着的弹窗集合算（不得另养计数器）');
    assert.match(sync, /classList\.toggle\('modal-open'/, '锁的形态走条件类（CSS 一处声明）');
    assert.strictEqual(count(/syncScrollLock\(\)/g), 3, '定义 1 处 + openModal / closeModal 各一处');
    assert.match(fnSource('openModal'), /syncScrollLock\(\)/, '打开即同步');
    assert.match(fnSource('closeModal'), /syncScrollLock\(\)/, '关闭即同步');
    // 成对 set/unset 在这里是错的：叠层时关上层不能解锁（E2E 有专测）
    assert.doesNotMatch(stripComments(html), /document\.(body|documentElement)\.style\.overflow/, '不得在页面里直接改 overflow（那样成对维护必漏）');
  });

  test('CSS：锁住的形态与滚动条槽位都在样式表里（不靠 JS 量宽度补 padding）', () => {
    assert.match(html, /html\.modal-open, html\.modal-open body \{ overflow: hidden; \}/, '锁住时 html/body 都不可滚');
    assert.match(html, /html \{ scrollbar-gutter: stable; \}/, '槽位常驻：锁定时滚动条消失不会让内容横移');
    const overlay = html.match(/\n  \.modal-overlay \{[\s\S]*?\n  \}/)[0];
    assert.match(overlay, /overscroll-behavior: contain/, '滚到遮罩不再链到背景');
    const content = html.match(/\n  \.modal-content \{[\s\S]*?\n  \}/)[0];
    assert.match(content, /overscroll-behavior: contain/, '弹窗正文滚到头不把滚轮传给背景');
    assert.match(content, /overflow-y: auto/, '弹窗正文仍是自己可滚的（锁的是背景）');
  });

  test('背景 inert：从文档流位置判定延伸层，不维护元素清单', () => {
    const sync = fnSource('syncScrollLock');
    assert.match(sync, /\.\.\.document\.body\.children/, '按 body 子元素全量重算（增量维护必漏）');
    assert.match(sync, /el\.inert = open\.length > 0 && !isActiveLayer\(el\)/, '开与关走同一句表达式');
    const layer = fnSource('isActiveLayer');
    assert.match(layer, /modal-overlay/, '开着的弹窗本身是当前界面');
    assert.match(layer, /getComputedStyle\(el\)\.position/, '延伸层按定位判定（fixed/absolute 挂在 body 下）');
    // 反面：把便条/日历写进白名单就会漏下一个（实测 flatpickr 日历被一起冻住，日期选不了）
    assert.doesNotMatch(layer, /toast-area|flatpickr|tip-bubble/, '不要用元素清单当判据（漏一个就是「弹窗里点不动」）');
  });

  test('台灯在弹窗打开时收起（判定在 logic.js，页面只传当前层数）', () => {
    const logic = logicSrc;
    assert.match(logic, /function lampEnabled\([\s\S]*?!o\.modalOpen/, 'lampEnabled 认 modalOpen');
    assert.match(fnSource('syncLamp'), /modalOpen: openModalStack\(\)\.length > 0/, '页面把「还有几层」传进判定');
    assert.match(fnSource('syncScrollLock'), /syncLamp\(\)/, '冻结/解冻时灯跟着重判');
  });
});

describe('UI 接线契约：假可点（悬停/按压反馈只给真能点的东西）', () => {
  const css = stripComments(html);
  // 取某选择器所在规则块（`{` 到 `}`；本文件的规则都是平铺单层，不含嵌套块）
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
    return m ? m[2] : null;
  };

  test('裸 .card:hover 不得抬升：静态卡片不是按钮', () => {
    // 判据是「.card 自己」（不含 .card-interactive 之类的派生选择器）。
    // 抬升是「可以点」的语言，摆给纯展示卡就是一次空承诺。
    assert.strictEqual(rule('.card:hover'), null, '裸 .card:hover 应保持删除（悬停抬升只留给 .card-interactive）');
    const lift = rule('.card-interactive:hover');
    assert.ok(lift && /--glass-depth-lift/.test(lift), '.card-interactive:hover 仍要抬升（真能点的那几张靠它）');
  });

  test('按压反馈：幽灵按钮 / 危险按钮 / 行内按钮 / 分段按钮同一条规则', () => {
    // 四处各写一遍会漂（有的下沉 1px、有的 2px）；按压是同一档手感，故同一条规则。
    const press = css.match(/(^|\n)\s*([^{}\n]*:active[^{}\n]*)\{([^}]*)\}/g) || [];
    const hit = press.find(
      (r) =>
        r.includes('.btn-ghost:active') &&
        r.includes('.btn-danger:active') &&
        r.includes('.row-btn:active') &&
        r.includes('.seg-btn:active')
    );
    assert.ok(hit, '四个可点控件应在同一条 :active 规则里共享按压反馈（不要各写一份）');
    assert.match(hit, /transform:\s*translateY/, '按压反馈用 transform（不参与布局，不会把邻居顶开）');
  });
});

describe('UI 接线契约：纸纹（一张非周期纤维，纸面与页头共用）', () => {
  const css = stripComments(html);
  const block = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc}[^{}\\n]*\\{([^}]*)\\}`));
    assert.ok(m, `找不到规则 ${sel}`);
    return m[0];
  };

  test('纸纹只有一份定义，且是 feTurbulence 噪声（不是周期网格）', () => {
    assert.strictEqual(count(/--grain:/g), 1, '--grain 只能定义一次（纸面与页头共用同一张）');
    const decl = css.match(/--grain:[^;]*/);
    assert.ok(decl, '找不到 --grain 定义');
    assert.match(decl[0], /feTurbulence/, '纸纤维应由 feTurbulence 生成（非周期）');
    assert.ok(!css.includes('M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4z'), '不得回潮到周期十字纹');
    assert.strictEqual(count(/background-image:\s*url\("data:image\/svg/g), 0, '纸纹不得在别处再写一遍字面 URI');
  });

  test('纸面与页头髹同一张纹（否则页头是不透光的平色，下沿露台阶）', () => {
    assert.match(block('body::before'), /background-image:\s*var\(--grain\)/);
    assert.match(block('.app-header::after'), /background-image:\s*var\(--grain\)/);
    assert.match(css, /(^|\n)\s*\.app-header\s*\{[^}]*position:\s*relative/, '.app-header 需要定位上下文给 ::after');
  });

  test('暗色下纸纹必须另给一档（黑斑叠深棕等于没叠），且两处一起翻', () => {
    const dark = block('.dark body::before');
    assert.match(dark, /\.dark \.app-header::after/, '页头的纸纹也要跟着反相（否则页头与纸面又不一样了）');
    assert.match(dark, /filter:\s*invert\(1\)/);
  });

  test('纸纹强度上限：它是材质，不是一层灰膜', () => {
    // 0.12 是人眼尺度定出来的上限：实测 0.07（亮）/ 0.09（暗）时纸面亮度标准差约 1%——
    // 刚好能看出「齿」；到 0.3 就是 ~4%，看着像磨砂贴膜（探针实测，见提交正文）。
    const decls = css.match(/[^{}\n]*(?:body::before|\.app-header::after)[^{}\n]*\{[^}]*\}/g) || [];
    assert.ok(decls.length >= 2, '应当能扫到纸纹规则');
    for (const d of decls) {
      const m = d.match(/opacity:\s*([0-9.]+)/);
      if (m) assert.ok(Number(m[1]) <= 0.12, `不透明度 ${m[1]} 过高：纸纹会变成均匀雾面（${d.slice(0, 40)}）`);
    }
  });
});

describe('UI 接线契约：系统层（浏览器/系统画的那一圈）', () => {
  test('状态栏颜色跟随应用主题，而不是跟随系统', () => {
    assert.match(html, /<meta name="theme-color"[^>]*>/, 'theme-color 元信息必须存在（手机浏览器地址栏/状态栏的颜色）');
    // 主题是应用内自己切的：用 media=prefers-color-scheme 会让「系统亮、页面暗」时状态栏反色
    const meta = html.match(/<meta name="theme-color"[^>]*>/)[0];
    assert.ok(!/media=/.test(meta), 'theme-color 不得写死一根 media 查询，应由 setTheme 写入');
    assert.match(fnSource('setTheme'), /applyThemeChrome\(\)/, 'setTheme 必须同步状态栏颜色');
  });

  test('触屏原生痕迹：点击高亮 / 插入符 / 原生控件强调色', () => {
    assert.match(html, /-webkit-tap-highlight-color:\s*transparent/, 'iOS/Android 点击时那层灰要走自己的激活态，不能留给系统');
    assert.match(html, /caret-color:\s*var\(--accent\)/, '插入符颜色应跟主题（默认黑色插入符在暖色纸面上是一根黑棍）');
    assert.match(html, /accent-color:\s*var\(--accent\)/, '原生 checkbox/radio 的选中色应跟主题');
  });

  test('placeholder 不能是浏览器默认灰', () => {
    assert.match(html, /::placeholder\s*\{[^}]*color:\s*var\(--muted\)/, 'placeholder 颜色要进主题（否则暖色纸面上是一块系统灰）');
    // 浏览器默认 placeholder 带 opacity，只写 color 会被它拉淡
    assert.match(html, /::placeholder\s*\{[^}]*opacity:\s*1/, 'placeholder 需显式 opacity: 1，否则会被 UA 自带的半透明再摸一层');
  });

  test('视口单位用 dvh：移动端地址栏收缩时不得让弹窗/列表跳高', () => {
    assert.ok(!/\d+vh\b/.test(stripComments(html).replace(/dvh|svh|lvh/g, '')), '不得再用 vh（移动端地址栏一收就跳）');
    assert.match(html, /\d+dvh/, '至少一处 dvh（弹窗上限 / 可选标签列表）');
  });

  test('安全区：刘海与底部横条不得压住内容', () => {
    assert.match(html, /env\(safe-area-inset-/, '必须有 env(safe-area-inset-*)');
    assert.match(html, /padding-inline:[^;]*max\(/, '内容栏的左右边距应与刘海取 max，而不是相加');
  });
});

describe('UI 接线契约：动效节奏（两档微反馈 + 编排档，不得再长出新值）', () => {
  const css = stripComments(html);

  test('不用 transition: all', () => {
    // `all` 会把布局属性（padding/width/left）也纳入过渡：一次重排就开始补间。
    // 更隐蔽的一条：`.tag-pill` 的长按进度是**每帧写内联 box-shadow** 画出来的，
    // `transition: all 0.15s` 会让每一帧都被 0.15s 追一次——进度线会拖在手指后面。
    const all = css.match(/transition:\s*all\b/g) || [];
    assert.deepStrictEqual(all, [], 'transition 必须列名属性（all 会连布局一起过渡，且会拖慢逐帧写入的进度线）');
  });

  test('时长只能落在已知档位（新增一个值是一次决定，不是顺手）', () => {
    // 微反馈 .15s 一档；.12s 是 flatpickr 第三方控件的自有节奏；.2s~.5s 是编排档
    // （弹层/入场/指标条）。历史上 0.12/0.15/0.2/0.25 逐处手调过，肉眼说不出差在哪，只觉得飘。
    const known = new Set(['0s', '0.05s', '0.06s', '0.12s', '0.15s', '0.2s', '0.25s', '0.28s', '0.3s', '0.4s', '0.42s', '0.5s']);
    const decls = css.match(/transition:[^;}]+/g) || [];
    const found = new Set();
    for (const d of decls) {
      for (const m of d.match(/(?:^|[\s,])(\.?\d*\.?\d+m?s)\b/g) || []) {
        const v = m.trim().replace(/^([.,])/, '0$1');
        if (/^\d/.test(v)) found.add(v);
      }
    }
    const unknown = [...found].filter((v) => !known.has(v));
    assert.deepStrictEqual(unknown, [], `这些时长不在档位里：${unknown.join(', ')}（加档位先问一句「哪一档不够用」）`);
  });
});

describe('UI 接线契约：排版细节（断行与中英混排）', () => {
  const css = stripComments(html);
  // 只认行首即该选择器的规则：`html.modal-open body {` 这类组合器不算 `body {`
  const body = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `找不到规则 ${sel}`);
    return m[0];
  };

  test('标题断行要匀（text-wrap: balance），不要最后一行只剩一个字', () => {
    for (const sel of ['.section-head h2', '.modal-title']) {
      assert.match(body(sel), /text-wrap:\s*balance/, `${sel} 需要 text-wrap: balance（长标题的孤字是账页上最显眼的一处毛边）`);
    }
  });

  test('中英混排自动加间隙（text-autospace）', () => {
    // 中文与数字/拉丁字母之间没有词边界，默认挤在一起（「消费记录3笔」）。
    // 不支持该属性的浏览器整条忽略，不影响排版。
    assert.match(body('body'), /text-autospace:/, 'body 需要 text-autospace');
  });
});

describe('UI 接线契约：月度快照提醒', () => {
  test('设置里窗口三态各接线一次，天数在 change 时归一（逐键归一会让输入框没法清空）', () => {
    for (const v of ['off', 'start', 'end']) {
      assert.strictEqual(
        html.split(`onclick="setSnapshotReminderWindow('${v}')"`).length - 1, 1,
        `setSnapshotReminderWindow('${v}') 应恰好接线一次`);
    }
    assert.strictEqual(count(/id="snapshot-reminder-days"/g), 1, '天数只有一个输入框');
    assert.match(html, /onchange="setSnapshotReminderDays\(this\.value\)"/, '天数在 change 时归一');
    // 两个控件落到同一个写入点：分两处赋值迟早一边忘了归一（与 setBackupFreq 同一种收敛）
    assert.match(fnSource('setSnapshotReminderWindow'), /setSnapshotReminder\(\{\s*window:/);
    assert.match(fnSource('setSnapshotReminderDays'), /setSnapshotReminder\(\{\s*days:/);
    assert.strictEqual(count(/state\.snapshotReminder\s*=/g), 1, 'state.snapshotReminder 只能有一个赋值点');
    assert.match(fnSource('showSettings'), /syncSnapshotReminderControls\(\)/, '打开设置要回显当前配置');
  });

  test('提醒弹窗有名字、只有一个「知道了」出口（不跳转、不带入口）', () => {
    const block = blockFrom(html, 'id="snapshot-reminder-modal"', '<!-- Expense Modal -->');
    assert.match(block, /aria-labelledby="snapshot-reminder-title"/, '弹窗要有名字（aria-modal 只说明「这是一层」）');
    assert.strictEqual((block.match(/id="snapshot-reminder-title"/g) || []).length, 1, '标题在同一個 modal-content 里');
    assert.deepStrictEqual(
      block.match(/onclick="[^"]*"/g) || [], ['onclick="closeSnapshotReminder()"'],
      '提醒只是通知：唯一的出口是「知道了」；给入口等于替用户省门槛费');
  });

  test('备份优先：备份框收尾（取消 / 写入结束）之后才弹快照提醒', () => {
    const src = fnSource('maybeAutoBackup');
    assert.match(src, /onCancel:\s*settle/, '取消备份也要接上快照提醒（否则一次取消就吞掉当天的提醒）');
    assert.match(src, /Promise\.resolve\([^)]*\)\.finally\(settle\)/, '写入 promise 收尾后才弹——系统文件窗口仍是模态');
    // 本次启动没有备份要弹时，快照提醒自己走（延后一点，避开首屏入场）
    assert.match(src, /const settle = \(\) => maybeSnapshotReminder\(\)/, 'settle 就是快照提醒');
    assert.match(src, /if \(!backup\.shouldAutoBackup[\s\S]{0,240}setTimeout\(settle/, '没有备份就不必等那 4 秒');
    // 不并存两层模态：备份分支里不直接调 maybeSnapshotReminder
    assert.doesNotMatch(src.slice(src.indexOf('showConfirm(')), /maybeSnapshotReminder\(\)/,
      '备份分支里只留 settle，不在框还开着时另弹一层');
  });

  test('确认框的取消回调每次调用都重置（不能粘到下一个确认框）', () => {
    assert.match(fnSource('showConfirm'), /_confirmCancelCallback\s*=\s*opts\.onCancel/, '每次调用都要重置');
    assert.match(fnSource('confirmCancel'), /_confirmCancelCallback\s*=\s*null/, '取消后清空');
    assert.match(fnSource('confirmCancel'), /if \(onCancel\) onCancel\(\)|onCancel\(\)/, '取消要真的触发回调');
  });
});

/*
 * 清空/删除/覆盖一律二次确认：用户原话「清空或者删除操作需要二次确认」。
 * 判据从页面自身求值，不写死函数清单——新增同类按钮会自动纳入这条巡检。
 * 行为层（取消后内存/存档是否真的没动）由 e2e/confirm-destructive.spec.js 在真实浏览器里验。
 */
describe('UI 接线契约：破坏性入口一律二次确认', () => {
  // 单文件 SPA 没有组件引用可查，内联接线就是入口清单本身。
  // 扫全部 on* 属性的**处理体里所有调用**（不只 onclick/onchange）：ESC 里的清空、
  // 表单提交里的删除同样会落盘，漏一个事件类型就是一道暗门。
  const handlerNames = [...new Set(
    [...html.matchAll(/\son[a-z]+="([^"]*)"/g)]
      .flatMap((m) => [...m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((c) => c[1]))
  )];
  const destructive = handlerNames.filter((n) => /^(clear|delete|remove|import)/.test(n));

  // 豁免：只清视图态（筛选 / 搜索），不落盘、不删账本内容，弹确认只会添堵。
  const VIEW_ONLY = ['clearExpenseSearch', 'clearExpenseFilters'];

  const DELEGATED = { importData: 'confirmImport' };

  // 可撤销的清除：不弹确认，但清除侧必须真的存了、恢复侧必须真的写回（只要求「有个按钮」等于把确认框换成一句承诺）。
  const UNDOABLE = { clearStress: 'restoreStress' };

  test('入口收集器本身有效（扫不到入口就会假绿）', () => {
    assert.ok(destructive.length >= 10, `应扫到一批破坏性入口（实得 ${destructive.length}）`);
    for (const n of VIEW_ONLY) assert.ok(destructive.includes(n), `${n} 应仍在清单里，否则豁免名单已失效`);
  });

  test('所有清空/删除/覆盖入口都经 showConfirm（取消即什么都没发生）', () => {
    const missing = destructive.filter((n) => {
      if (VIEW_ONLY.includes(n)) return false;
      if (UNDOABLE[n]) return false;
      if (DELEGATED[n]) {
        assert.match(fnSource(n), new RegExp(DELEGATED[n] + '\\('), `${n} 应委托给 ${DELEGATED[n]}`);
        return !/showConfirm\(/.test(stripComments(fnSource(DELEGATED[n])));
      }
      return !/showConfirm\(/.test(stripComments(fnSource(n)));
    });
    assert.deepStrictEqual(missing, [], '未二次确认的破坏性入口：' + missing.join(', '));
  });

  test('可撤销的清除：清除侧存旧值，恢复侧写回，且接口接在页面上', () => {
    for (const [clearFn, restoreFn] of Object.entries(UNDOABLE)) {
      assert.match(stripComments(fnSource(clearFn)), /state\.stressLast\s*=/, `${clearFn} 必须把被清掉的情景存进 stressLast`);
      assert.match(stripComments(fnSource(restoreFn)), /state\.stressLast/, `${restoreFn} 必须从 stressLast 取回`);
      assert.match(stripComments(fnSource(restoreFn)), /state\.stress\s*=/, `${restoreFn} 必须写回 state.stress`);
      assert.match(html, new RegExp(`on[a-z]+="[^"]*${restoreFn}\\(`), `${restoreFn} 必须接在页面某个事件上`);
    }
  });

  test('豁免的确实只动视图态（不得写 state / 落盘）', () => {
    for (const n of VIEW_ONLY) {
      const src = stripComments(fnSource(n));
      assert.doesNotMatch(src, /saveState\(|state\.\w+\s*=/, `${n} 一旦落盘就不能再豁免`);
    }
  });

  test('既有的确认框不回潮（快照覆盖 / 两处示例数据 / 编辑框里清空引用）', () => {
    for (const fn of ['promptOverwrite', 'loadDemoData', 'loadExpenseDemoData', 'saveCategory']) {
      assert.match(stripComments(fnSource(fn)), /showConfirm\(/, `${fn} 的确认不得被摘掉`);
    }
  });
});
