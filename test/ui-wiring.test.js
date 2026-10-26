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

  test('syncBackupControls 是备份控件同步的唯一入口，各处路径都走它', () => {
    assert.match(html, /function syncBackupControls\(\)/);
    for (const fn of ['showImportExport', 'showSettings', 'setBackupFreq', 'exportData',
      'restoreBackupDir', 'chooseBackupDirAsync', 'clearBackupDirAsync', 'applyBackupResult']) {
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
    // 响应形状校验与取倒数同源：直接在页面里 1/cny.hkd，脏响应会把 NaN/Infinity 写进存档
    assert.match(src, /ratesFromApi\(/, '汇率响应须经 logic.js ratesFromApi 校验后写入');
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
    assert.match(src, /sortAriaLabel\(/, '取值必须走 logic.js 单一判据');
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
    assert.match(src, /toastLiveMode\(type\)/, '档位取值必须来自 logic.js 的单一判据');
  });

  test('播报档位走 logic.js toastLiveMode（不在页面里重写一份判据）', () => {
    const src = fnSource('toast');
    assert.match(src, /toastLiveMode\(/, 'toast() 必须复用 logic.js 的单一判据');
    assert.match(src, /aria-live/, '必须把档位真的写到 DOM 属性上');
  });
});

describe('UI 接线契约：Tab 滑动指示条', () => {
  // 用户要求：从「消费记录」切到「消费分布」时，小黄条应从左边**滑**过去，不是跳变。
  // 实现：指示条不再是每个按钮自己的 border-bottom，而是 Tab 栏里**唯一的**一个元素，
  // 切换时用 transform 移动到目标按钮下方（transform 有过渡 = 滑动）。
  test('每条 Tab 栏里必须有且只有一个滑动指示条元素', () => {
    assert.match(html, /class="tab-bar[^"]*"[^>]*>\s*<span class="tab-indicator"/, '指示条必须是 tab-bar 的第一个子元素（单一元素）');
    // 按钮自己的 border-bottom 不再承担「指示当前」的职责
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
      // 取「监听体**内**（不是文件后续巧遇的字样）调 moveTabIndicator」的那个 resize 段：
      // 每段是“resize( 后的全部余文”，会包含后面所有代码。指示条那个监听的特征：
      // 段内**同时**含 moveTabIndicator 与 .tab-btn.active（从 active 按钮读当前 tab）。
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
    assert.match(openSrc, /\.focus\(\)/, 'openModal 必须真的 focus 第一个可聚焦元素');
    assert.match(html, /function modalFocusables\(/, '「弹窗内可聚焦元素」须有单一实现（打开与陷阱共用一份）');
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
    assert.match(html, /trapFocus\(/, 'Tab 陷阱必须复用 logic.js 的纯函数');
    assert.match(html, /e\.key !== 'Tab'/, '必须拦截 Tab 键');
    assert.match(stripComments(html), /e\.shiftKey/, 'Shift+Tab 反方向要一并接管（只做正向 = 往回一按就逃出去）');
  });

  test('所有隐藏弹窗的路径都走 closeModal：否则焦点管理被绕过（只改 display 而不还焦点）', () => {
    // ESC 与遮罩点击原先各自写 `style.display = 'none'`，绕过了 closeModal。
    const escBlock = blockFrom(html, "if (e.key !== 'Escape') return;", '});');
    assert.doesNotMatch(escBlock, /top\.style\.display = 'none'/, 'ESC 关弹窗必须走 closeModal（否则焦点不还）');
    assert.match(escBlock, /closeModal\(top\.id\)|confirmCancel\(\)/, 'ESC 应统一走 closeModal / confirmCancel');

    const overlayBlock = blockFrom(html, '__modalMouseDownTarget = e.target', '__modalMouseDownTarget = null');
    assert.doesNotMatch(overlayBlock, /e\.target\.style\.display = 'none'/, '遮罩点击关弹窗必须走 closeModal');
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
    // chart click 只允许出现在两个「单一接线函数」里：堆叠柱下钻 + 旭日选中分类。
    // 散落在 render* 里的内联 chart.on('click') 仍不允许（那正是这条要防的）
    assert.strictEqual(count(/\.on\('click'/g), 2, 'chart click 仅限 wireStackedBarDrill / wireSunburstDrill 内各一处');
    const inlineOn = html.split(String.fromCharCode(10))
      .filter((l) => l.indexOf(".on('click'") >= 0 && !/^\s*(\/\/|\*)/.test(l))
      .filter((l) => l.indexOf("chartObj.on('click'") < 0);
    assert.deepStrictEqual(inlineOn, [], 'render* 里不得内联注册 click');
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
    // 双负向断言前先给一条正向锚点：否则提取到别的/空的块时，两条「不再…」都会假绿
    assert.match(fnSource('renderMasthead'), /masthead-sub/, '报头副行由 renderMasthead 渲染（证明拿到的是真实现）');
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
    assert.match(src, /backupPromptText\(/, '确认框文案走 logic.js 单一来源');
    assert.match(src, /showConfirm\(/, '自动备份必须先弹确认框：定时器没有用户手势，直接开文件窗口必然失败');
    assert.ok(src.indexOf('await ratePromise') < src.indexOf('showConfirm('),
      'await ratePromise 必须排在弹框之前，否则确认框里的文件名/汇率是旧的');
    assert.doesNotMatch(src, /showSaveFilePicker|downloadBackupJSON|backupJSONText/,
      '确认框只负责问：落盘必须交给 saveBackupToFile 唯一出口');
    // 确认回调就是那次手势：回调体里出现 await（或写成 async 回调）都会让文件窗口打不开
    const cb = src.slice(src.indexOf('showConfirm('));
    const cbBody = cb.slice(cb.indexOf('=> {'), cb.indexOf('}, prompt.title'));
    assert.ok(cbBody.length > 0, '确认回调体必须能被定位（改形会让这条断言静默失效）');
    assert.doesNotMatch(cbBody, /await|async/, '确认回调里不得有 await：手势会被消耗，文件窗口打不开');
  });

  test('确认框与文件窗口之间不得有 await：一旦 await，用户手势就被消耗、窗口打不开', () => {
    const src = stripComments(fnSource('saveBackupToFile'));
    const pickerIdx = src.indexOf('window.showSaveFilePicker(');
    assert.ok(pickerIdx > 0, '必须直接调 showSaveFilePicker（仅 Chromium 支持；其余走 fallback）');
    // 只允许写盘那一段 await（try 块内），函数入口到「弹窗口」之间一步都不许停
    const head = src.slice(src.indexOf('try {'), pickerIdx);
    // 入口到「弹窗口」之间只允许一个 await —— 就是打开窗口本身那一个
    assert.strictEqual((head.match(/await/g) || []).length, 1,
      'showSaveFilePicker 之前不得先 await 别的：自动备份的唯一手势来自确认框那次点击');
    assert.match(head, /await\s*$/, '唯一那个 await 必须紧贴打开窗口这一句');
    assert.match(src.slice(pickerIdx), /await writeFileHandleText\(/,
      '窗口确认后才写内容（close() 成功才算写完）');
    assert.match(src, /startIn: backupDirHandle/, '文件窗口必须从设置里选的目录打开');
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
    const logicSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'logic.js'), 'utf8');
    const fnSrc = logicSrc.match(/function backupJSONText\([\s\S]*?\n {2}\}/);
    assert.ok(fnSrc, 'logic.js 必须有 backupJSONText');
    assert.match(stripComments(fnSrc[0]), /delete sn\.totalCNY/,
      '导出前必须逐条剥离 totalCNY：它的唯一真相是 assets × currencyRates，写进文件后一旦导入端不重算就会留下与资产脱节的旧值');
    for (const fn of ['downloadBackupJSON', 'saveBackupToFile']) {
      assert.match(stripComments(fnSource(fn)), /backupJSONText\(state\)/,
        `${fn} 必须用同一份 backupJSONText 生成内容`);
    }
    assert.match(stripComments(fnSource('exportDataAsync')), /saveBackupToFile\(/,
      '手动导出必须汇到同一落盘出口，不得另写一份写盘');
  });

  test('导入合并后必须走 migrateState()（与 loadState 共用同一套迁移/兜底）', () => {
    const src = stripComments(fnSource('importData'));
    const mergeIdx = src.indexOf('state = { ...state, ...data }');
    const migrateIdx = src.indexOf('migrateState()');
    assert.ok(mergeIdx >= 0, '导入应先合并顶层字段');
    assert.ok(migrateIdx > mergeIdx,
      '合并后必须调用 migrateState（旧 expectedRate、旧快照格式、缺字段、孤儿标签的兜底唯一入口）');
  });
});

describe('UI 接线契约：备份文件夹', () => {
  test('设置弹窗必须有备份文件夹行，且回显走 syncBackupControls', () => {
    assert.strictEqual(count(/id="settings-backup-dir-note"/g), 1);
    assert.match(html, /id="backup-dir-choose"[^>]*onclick="chooseBackupDir\(\)"/);
    assert.match(html, /id="backup-dir-clear"[^>]*onclick="clearBackupDir\(\)"/);
    const src = stripComments(fnSource('syncBackupControls'));
    assert.match(src, /settings-backup-dir-note/);
    assert.match(src, /backupDirNoteText\(/);
    assert.match(src, /backup-dir-clear/);
  });

  test('onclick 只挂同步入口，异步实现单独命名（内联名收集器不认 async function）', () => {
    assert.match(html, /function chooseBackupDir\(\) \{ chooseBackupDirAsync\(\); \}/);
    assert.match(html, /function clearBackupDir\(\) \{ clearBackupDirAsync\(\); \}/);
    assert.match(html, /function exportData\(\) \{\n {2}syncBackupControls\(\);[\s\S]*?exportDataAsync\(\);/);
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
    const logicSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'logic.js'), 'utf8');
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
    assert.match(stripComments(fnSource('fetchRates')), /refreshVisibleCharts\(\)/, '汇率刷新后图表跟随重绘');
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
    assert.match(stripComments(fnSource('setTheme')), /refreshVisibleCharts\(\)/, '主题切换与汇率刷新共用同一入口');
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
    // id 由「前缀 + 分类 id」拼成，两者都可能来自导入的 JSON：属性里必须转义
    const input = html.match(/<input type="text" id="\$\{esc\(cfg\.newTagPrefix \+ cat\.id\)\}"[^>]*>/);
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

describe('UI 接线契约：标签改名（迁移引用，不是清空）', () => {
  test('改名入口单一来源：renameTagGeneric 一份 + 两个单侧包装，均走同一 startTagRename', () => {
    assert.strictEqual(count(/function renameTagGeneric\(/g), 1, '改名实现只定义一次');
    assert.strictEqual(count(/function renameTag\(/g), 1, '资产侧包装只定义一次');
    assert.strictEqual(count(/function renameExpenseTag\(/g), 1, '消费侧包装只定义一次');
    assert.strictEqual(count(/function startTagRename\(/g), 1, '就地重命名交互只定义一次');
    // 两个单侧包装都只是把 side 定死，交同一 startTagRename（不再各自写一遍交互）
    for (const [fn, side] of [['renameTag', 'asset'], ['renameExpenseTag', 'expense']]) {
      const src = fnSource(fn);
      assert.ok(src.includes(`startTagRename(`) && src.includes(`'${side}'`), `${fn} 走同一 startTagRename`);
      assert.strictEqual((src.match(/startTagRename\(/g) || []).length, 1, `${fn} 只调一次`);
    }
    assert.strictEqual(count(/renameTag: '[a-zA-Z]+'/g), 2, '两侧 CAT_SIDES 各声明一次入口名');
  });

  test('改名迁移引用而非删除：走 logic.js migrateTagRefs，读数卡选择同迁移，不出现 delete', () => {
    const src = fnSource('renameTagGeneric');
    assert.match(src, /migrateTagRefs\(cfg\.items\(\), catId, oldName, newName\)/, '引用迁移下沉纯函数');
    assert.doesNotMatch(src, /delete [\w.]*\.tags\[/, '改名不得按「旧名已失效」删除引用（那正是丢数据的路径）');
    assert.match(src, /state\.runwayTags = migrateRunwayTagRefs\(state\.runwayTags, catId, oldName, newName\)/,
      '读数卡所选标签同按名字引用，改名必须一并迁移');
    assert.doesNotMatch(src, /pruneRunwayTags\(/, '改名不需要 prune（新名已存在，选择不该被清）');
  });

  test('改名守卫与落盘：内置分类拒改、重名拒绝、随后保存并两处重绘', () => {
    const src = fnSource('renameTagGeneric');
    assert.match(src, /cat\.builtin/, '内置分类（货币类型）不可改名');
    assert.match(src, /cat\.tags\.includes\(newName\)/, '新名已存在则拒绝（不得产生同名双标签）');
    assert.match(src, /saveState\(\)/);
    assert.match(src, /renderCategoryCards\(side\)/, '分类卡片重绘（胶囊回到新名）');
    assert.match(src, /cfg\.renderItems\(\)/, '列表上的 pill 同步');
    assert.ok(src.indexOf('saveState()') < src.indexOf("toast('标签已重命名'"), '先落盘再提示');
  });

  test('就地重命名输入框：IME 组字守卫、Esc 取消、提交前防重入（blur 不再二次提交）', () => {
    const src = fnSource('startTagRename');
    assert.match(src, /e\.isComposing/, '中文输入法确认候选字也是回车，无守卫会在组字中途提交');
    assert.match(src, /Escape/, 'Esc 取消（重绘即还原）');
    assert.match(src, /blur/, '点开就走提交，与行内金额编辑同习惯');
    assert.match(src, /let done = false|let done=false/, '防重入标记');
    assert.match(src, /if \(done\) return/, 'Esc 取消后 input 被重绘移除会触发 blur，必须防二次提交');
    assert.strictEqual(count(/renameTagGeneric\(/g), 2, '定义一处 + startTagRename 提交处一处（不再有第二条改名路径）');
  });

  test('胶囊上不再有 ✎：长按胶囊即改名（长按状态机与资产入口同源）', () => {
    assert.strictEqual(count(/class="tag-pill"/g), 1, '胶囊模板只允许一处');
    const pill = fnSource('tagPillHtml');
    // ✎ 图标去掉：它太小、还把每一枚胶囊都变成「带控件的样子」；改成长按整枚胶囊
    assert.doesNotMatch(pill, /pill-edit/, '不再渲染 ✎ 图标');
    assert.doesNotMatch(pill, /✎/, '标记里不得再出现 ✎ 字形');
    assert.strictEqual(count(/✎/g), 0, '全页不留 ✎（提示文案里也不要再指路到图标）');
    // 长按接线：胶囊挂 press 事件，落点仍走那唯一的改名实现
    assert.match(pill, /data-rename/, '胶囊带改名所需的分类/标签数据');
    assert.match(html, /startTagPress\(/, '按下即开始计时');
    assert.match(html, /endTagPress\(/, '松手判定');
    // 阈值与进度走 logic.js（与资产入口同一套状态机，只换阈值）
    const logicSrc = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logicSrc, /function pressDecision\(heldMs, threshold\)/, '判定参数化（不复制第二份阈值逻辑）');
    assert.match(html, /pressDecision\([^)]*TAG_PRESS_MS/, '改名用 TAG_PRESS_MS 那一档');
    assert.strictEqual(count(/renameTagGeneric\(/g), 2, '定义一处 + startTagRename 提交处一处（不再有第二条改名路径）');
    // 键盘/读屏器仍要能改名：长按是手势，不是权限（与资产入口同一原则）
    assert.match(pill, /tabindex="0"/, '胶囊可聚焦');
    assert.match(html, /onkeydown="[^"]*renameTagFromKey/, '键盘必须有一条直达改名的路');
  });

  test('长按满时长即进编辑态：先收尾再开输入框，中继态一并删掉', () => {
    const src = fnSource('startTagPress');
    // 旧实现满时长只加一枚 armed 就停下，用户还得自己松手（实测「松开才能编辑」）；
    // 现在与「进资产页」同一处置：满时长那一帧输入框就在原地出现
    const tick = src.slice(src.indexOf('const tick = ()'));
    assert.match(tick, /pressDecision\(held, TAG_PRESS_MS\)/, '判定仍与资产入口同源，只换阈值');
    assert.ok(tick.indexOf('resetTagPress()') < tick.indexOf('startTagRename('),
      '先收尾再开输入框：不先收尾的话，紧跟的松手会让 endTagPress 再开一次（同一次长按两个入口）');
    assert.doesNotMatch(src, /add\('armed'\)/, '不再有「按满但还没进去」的中继态');
    assert.strictEqual(count(/\.tag-pill\.armed/g), 0, '中继态的样式随行为一起删（死样式不留）');
    // 样式表里也不得留「只减不加」的死规则：.mode-press.armed 从未被 add 过（只有 remove），
    // 留着会让下一个人以为按住时真有这一态
    assert.strictEqual(count(/\.mode-press\.armed/g), 0, '.mode-press.armed 是死规则（无任何代码 add）');
    // 长按胶囊的进度靠 JS 按实宽写 box-shadow；CSS 里的 --tag-press 伪进度宽度恒为 0，且会被内联覆盖
    assert.strictEqual(count(/var\(--tag-press/g), 0, '--tag-press 没有任何视觉出口，不得留在样式中');
    // 松手早于下一帧那一线：判定同源，够长就仍然进编辑态
    assert.match(fnSource('endTagPress'), /startTagRename\(/, '手势够长不该因为少一帧而作废');
  });

  test('内置分类整张卡片只读：不接改名与删除入口（写死的逻辑不摆可点的样子）', () => {
    // 币种代码是写死的逻辑：改名/删除在守卫里都会被拒绝，但拒绝路径只是 return，没人收走
    // 那个输入框——用户实测「长按内置的货币类型，然后点其他地方不能取消编辑」。
    const src = fnSource('renderCategoryCards');
    assert.match(src, /const tagOpts = cat\.builtin/, '只读由 builtin 单一判定');
    assert.match(src, /cat\.builtin[\s\S]{0,60}?\? \{ showKey: false \}/, '内置分类只给纯展示选项');
    assert.strictEqual(count(/removeFn: cfg\.removeTag/g), 1, '入口只在这一处按 builtin 收口');
    assert.match(src, /tagPillHtml\(cat, t, cfg\.colorFn, tagOpts\)/, '两侧共用同一份 opts（不各写一遍）');
    // 守卫照旧：只读是「不给入口」，不是把守卫当挡箭牌
    assert.strictEqual(count(/toast\('内置分类不可修改'/g), 3, '改名/删除/保存分类三处守卫不漏');
  });

  test('编辑框必须有归宿：拒绝路径只 return，收尾由 finish 兜住', () => {
    const src = fnSource('startTagRename');
    assert.match(src, /if \(input\.isConnected\) renderCategoryCards\(side\)/,
      'renameTagGeneric 的每条早退（分类已删/内置/重名/旧名过期）都不重绘，输入框必须有人放回去');
    assert.ok(src.indexOf('renameTagGeneric(') < src.indexOf('input\.isConnected'),
      '先提交再兜底：提交成功那条自己重绘，兜底就成空操作（不会重绘两遍）');
  });

  test('移除标签前先告知将清空的引用数：确认框与直接保存共用同一段 apply', () => {
    const src = fnSource('saveCategoryGeneric');
    assert.match(src, /countTagRefs\(cfg\.items\(\), editId, removed\)/, '引用数走 logic.js 口径');
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
    assert.match(fnSource('renderTagCheckBar'), /missingTagGroups\(cfg\.items\(\), cfg\.cats\(\)\)/, '计数走 logic.js 缺口口径，两侧同一实现');
  });

  test('面板唯一 #tagcheck-modal，打开走 openModal；四个入口共 5 处接线', () => {
    assert.strictEqual(count(/id="tagcheck-modal"/g), 1, '面板弹窗应唯一（资产/消费不各造一套）');
    assert.strictEqual(count(/id="tagcheck-groups"/g), 1);
    assert.strictEqual(count(/function openTagCheck\(/g), 1, '打开入口只定义一次');
    assert.match(fnSource('openTagCheck'), /openModal\('tagcheck-modal'\)/, '走通用弹窗路径');
    // 定义一处 + 两条校验条「去校验」+ 分类卡片提示条 + 新建分类后自动打开
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
    assert.match(src, /cfg\.renderItems\(\)/, '列表 pill 与校验条跟着刷新（两侧各自重绘自己的列表）');
    assert.match(src, /renderTagCheckGroup\(catId\)/, '只重绘命中分组，保留面板滚动位置');
    assert.match(fnSource('renderTagCheckGroup'), /outerHTML/, '局部替换而非重建整个面板');
    // 取消选择（再点已选项）不得改数据：按数据回滚盖印状态
    assert.match(src, /if \(!val\) \{ renderTagCheckGroup\(catId\); return; \}/, '取消选择只回滚 UI');
  });

  test('缺口口径 missingTagGroups 单一来源，四处调用；两侧都接线，资产侧说明快照口径', () => {
    assert.strictEqual(count(/missingTagGroups\(/g), 4, '校验条 + 面板打开 + 分类卡片 + 新建后检测');
    const card = fnSource('renderCategoryCards');
    assert.match(card, /cfg\.tagCheck \? missingTagGroups/, '卡片提示条必须带 cfg.tagCheck 闸门');
    // 侧别必须在**生成时**插值成字面量：onclick 是别名里的字符串，内联处理器在全局作用域求值，
    // 写成 `openTagCheck(side, …)` 会在点击时抛 ReferenceError（弹窗根本不开，且不报错到界面上）
    assert.match(card, /openTagCheck\('\$\{jsAttr\(side\)\}', '\$\{jsAttr\(cat\.id\)\}'\)/, '卡片入口聚焦该分类，侧别按生成时插值（不得把模板参数写进 onclick）');
    // 两侧各声明一次：资产与消费都接线（按侧块取，避免只靠同行注释辨认是哪一侧）
    assert.strictEqual(count(/tagCheck: (true|false)/g), 2);
    const assetCfg = html.match(/\n  asset: \{[\s\S]*?\n  \},/)[0];
    const expenseCfg = html.match(/\n  expense: \{[\s\S]*?\n  \},/)[0];
    assert.match(assetCfg, /tagCheck: true,/, '资产侧接线');
    assert.match(expenseCfg, /tagCheck: true,/, '消费侧接线');
    assert.strictEqual(count(/tagCheckHint: /g), 2, '面板顶部提示两侧各一条');
    assert.match(assetCfg, /tagCheckHint: '[^']*快照[^']*'/, '资产侧需说明「历史快照不随补」');
    assert.doesNotMatch(expenseCfg, /快照/, '消费侧没有快照概念，不照抄说明');
    assert.match(fnSource('openTagCheck'), /tagcheck-hint/, '提示文案由 openTagCheck 按侧别写入（不造两套弹窗）');
    assert.match(fnSource('tagCheckGroupHtml'), /isUntaggedItem\(/, '组内待归类计数与 logic.js 同口径');
  });

  test('新建分类后自动打开面板：带 createdId && cfg.tagCheck 守卫，且在关掉分类弹窗之后', () => {
    const src = fnSource('saveCategoryGeneric');
    assert.match(src, /if \(createdId && cfg\.tagCheck\)/, '只有启用校验的一侧且确为新建时才打开');
    assert.match(src, /openTagCheck\(side, createdId\)/, '聚焦新建的那个分类，并带侧别');
    assert.ok(
      src.indexOf('closeModal(m.id)') < src.indexOf('openTagCheck(side, createdId)'),
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

  test('拼进 id / data-* 的元素 id 也要转义（属性截断 = 注入）', () => {
    // id 来自导入的 JSON，不经用户手：一个双引号就能截断属性并插进新标签。
    // 实测 id = `a"><img src=x onerror="window.__xss=1">` 时，校验面板真的执行了脚本。
    const picker = fnSource('tagPickerHtml');
    assert.match(picker, /const hidId = esc\(/, 'hidden input 的 id 与 data-target 须走同一个转义后的串');
    assert.doesNotMatch(picker, /id="\$\{idPrefix\}/, '不得把未转义的前缀直接插进 id');
    for (const fn of ['startInlineEdit', 'commitInlineEdit']) {
      assert.match(fnSource(fn), /CSS\.escape\(id\)/, `${fn} 的属性选择器要转义 id`);
    }
  });

  test('用户字段插值一律经 esc：日期不是「安全形状」，它同样来自导入的 JSON', () => {
    // 备注/标签名都转了，日期却是裸插值——而 migrateState 对 date 只补空值、不校验形状。
    // 精确到「插值里出现的裸用户字段」，不搞全站一刀切（`${formatCNY(x)}` 这类无需转义）。
    assert.strictEqual(count(/\$\{e\.date\}/g), 0, '日期插值必须走 esc（月度明细/分类构成两处曾裸插）');
    assert.strictEqual(count(/\$\{(?:e|exp|it|a|asset|s)\.(?:date|note|name)\}/g), 0,
      '用户输入字段不得裸插值进 innerHTML');
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

describe('UI 接线契约：行级可点元素必须键盘可达（可点即键盘可达）', () => {
  test('行级激活键位走 logic.js activateKeyAction，不在内联里各自判键名', () => {
    // 只认 Enter 是常见的半吊子实现：Space 是屏幕阅读器用户最惯用的激活键。
    assert.strictEqual(
      (html.match(/function activateKeyAction/g) || []).length,
      0,
      'index.html 不应重复定义键位判定（单一来源在 logic.js）');
    assert.match(
      html,
      /onkeydown="if\(activateKeyAction\(event\.key\)\)/,
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
    // 表头是 role=button，只认 Enter 会让 Space 落空；aria-sort 让读屏器知道当前排序列。
    const sortHeads = html.match(/<div[^>]*onclick="toggle(Sort|ExpenseSort)[^>]*>/g) || [];
    assert.strictEqual(sortHeads.length, 6, '资产 4 列 + 消费 2 列排序表头');
    for (const head of sortHeads) {
      assert.match(
        head,
        /activateKeyAction\(event\.key\)/,
        '排序表头的键位应走单一口径（Enter 与 Space 同义）');
      assert.match(head, /aria-sort="none"/, '初始 aria-sort 应为 none');
      // 一个标签里写两遍 class：浏览器只认第一个，第二个（这里是 .row-hit）被静默丢弃——
      // 金额表头于是少了 cursor:pointer 与焦点环，而文本断言（只查 class 出现过）照样绿。
      assert.strictEqual((head.match(/\bclass="/g) || []).length, 1,
        `排序表头只能有一个 class 属性（重复的那个会被丢弃，导致 .row-hit 静默失效）：${head}`);
      assert.match(head, /\bclass="[^"]*\brow-hit\b/, '排序表头必须带上 .row-hit（指针样式与焦点环的来源）');
      // 数值列（金额族）另要 .num；名字/货币/日期是左对齐的标识文本，不在此列
      if (/金额/.test(head)) assert.match(head, /\bclass="[^"]*\bnum\b/, '数值列表头还要带 .num（右对齐与等宽数字）');
    }
    assert.match(
      fnSource('updateSortIndicators'),
      /sortAriaSort\(/,
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
        // 处理体在浏览器里就是这样被包成函数体的；能构造即语法正确
        // eslint-disable-next-line no-new-func
        new Function('event', body);
      } catch (e) {
        bad.push(`${e.message} :: ${raw}`);
      }
    }
    assert.deepStrictEqual(bad, [], '内联事件属性存在语法错误（浏览器里表现为「按了没反应」）');
  });

  test('行级激活的守卫必须包住整段动作，而不是只包住 preventDefault', () => {
    // if(cond)A;B 只守卫 A——这是上面那条语法错误的成因，单独立一条说得更清楚。
    const hits = [...html.matchAll(/onkeydown="if\(activateKeyAction\(event\.key\)\)([^"]*)"/g)];
    assert.strictEqual(hits.length, 9, `行级激活共 9 处（资产 4 列排序 + 消费 2 列排序 + 清单行 + 快照行 + 趋势月份行）`);
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
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    const declared = new Set();
    const collect = (src, indent) => {
      // `async function` 同样是**顶格声明**（函数声明提升，内联处理器能直接调用），
      // 漏掉它会把「图表渲染改成 async」这种正常重构误报成「名字不存在」。
      const re = new RegExp(`^${indent}(?:async\\s+)?(?:function|let|const|var)\\s+([A-Za-z_$][\\w$]*)`, 'gm');
      for (const m of src.matchAll(re)) declared.add(m[1]);
      // `let a = 1, b = 2;` 这类同行多声明（同样只认顶层）
      const re2 = new RegExp(`^${indent}(?:let|const|var)\\s+[^;=]+=[^;]*;`, 'gm');
      for (const m of src.matchAll(re2)) {
        for (const n of m[0].matchAll(/(?:^|[,\s])([A-Za-z_$][\w$]*)\s*=/g)) declared.add(n[1]);
      }
    };
    collect(html, '');      // 内联脚本：顶格声明
    collect(logic, '  ');   // logic.js：UMD 工厂内两格缩进

    // 浏览器内建（window 上的构造器/全局函数）与事件处理器自带的 event/this
    const builtins = new Set([
      'event', 'this', 'document', 'window', 'console', 'Math', 'Date', 'JSON', 'Number', 'String',
      'Array', 'Object', 'Set', 'Map', 'Boolean', 'isNaN', 'isFinite', 'parseInt', 'parseFloat',
      'Infinity', 'NaN', 'undefined', 'if', 'else', 'return', 'true', 'false', 'null',
    ]);
    const bad = [];
    for (const [, attr, raw] of html.matchAll(/\son([a-z]+)="([^"]*)"/g)) {
      // ${...} 占位由生成时求值，换成 '0'；字符串字面量先剥干净，免把参数名当标识符。
      const body = raw.replace(/\$\{[^}]*\}/g, '0').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      // 只取「前面不是 . 或标识符字符」的裸标识符（属性访问/字符串里的不查）
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
    // 子 Tab 栏与模式按钮都不再有 keydown 接管：Tab 恢复浏览器默认焦点顺序
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

  test('合成长按不再放行：只有 detail 为 0 的激活（键盘/读屏器）才直通确认框', () => {
    assert.match(html, /id="mode-assets"[^>]*onclick="modePressClick\(event\)"/, 'click 走单一处置函数');
    assert.match(fnSource('modePressClick'), /e\.detail === 0/, '只有合成激活直通；鼠标/触摸的 detail 是 1，被挡住');
    // detail 的取值不是猜的：app.spec.js 用真实触摸与键盘各跑一遍把它钉住
    assert.match(html, /if \(e\.detail === 0\) enterAssets\(\)/, '不在页面里重写第二套判据');
  });

  test('右键不参与长按（option+点击是「想开菜单」，不是想进门）', () => {
    assert.match(fnSource('startModePress'), /e\.button !== 0/, '忽略非主按键');
    assert.match(fnSource('endModePress'), /e\.button !== 0/, '非主按键松开不替主键的按住收尾');
  });

  test('已在资产页时入口整体失效（再问一次「现在确实要看？」是荒谬的）', () => {
    const src = fnSource('assetsEntryOpen');
    assert.match(src, /currentMode !== 'assets'/, '判据单一来源');
    assert.match(fnSource('startModePress'), /assetsEntryOpen\(\)/, '按下前先问这道闸');
    assert.match(fnSource('enterAssets'), /assetsEntryOpen\(\)/, '进门链路也得问（键盘通直也不例外）；重入路径不留缺口');
  });

  test('收尾后的残留帧不报错（cancel 排在下一帧之前时 rAF 仍会跑到）', () => {
    assert.match(fnSource('tickModePress'), /modePressStart === null/, '推进帧先查按下是否还在');
  });

  test('消费按钮仍是一次点击直达（成本只加在资产侧）', () => {
    assert.match(html, /id="mode-expenses"[^>]*onclick="switchMode\('expenses'\)"/, '回消费不受惩罚');
    assert.strictEqual(count(/onclick="switchMode\('expenses'\)"/g), 1);
  });

  test('满时长判定与进度走 logic.js 单一来源，不得内联重写阈值', () => {
    assert.match(fnSource('endModePress'), /modePressDecision\(/, '送达判定下沉 logic.js');
    assert.match(fnSource('tickModePress'), /modePressProgress\(/, '进度比例下沉 logic.js');
    // 阈值只在 logic.js 定义一次；页面脚本里不得出现裸的毫秒字面量（文案里的「1 秒」由常量派生）
    const src = ['startModePress', 'tickModePress', 'endModePress', 'cancelModePress', 'enterAssets']
      .map(fnSource).join('\n');
    assert.ok(!/\b\d{3,}\b/.test(src), '按下/松手链路不得内联毫秒阈值');
    assert.strictEqual(count(/MODE_PRESS_MS\s*=/g), 0, '常量定义只在 logic.js');
  });

  test('长按有可见进度反馈（填充完全由 CSS 画，JS 只同步一个变量）', () => {
    assert.match(html, /\n  \.mode-press::after \{[^}]*width: calc\(var\(--mode-press, 0\) \* 100%\)/, '墨线宽度换算在 CSS 一处，不逐帧写 style.width');
    assert.match(fnSource('tickModePress'), /style\.setProperty\('--mode-press'/, 'JS 只同步 CSS 变量，不逐帧改 class');
  });

  test('长按满时长自动弹窗（按满即弹，不必再松手）', () => {
    // 旧决策「弹窗只能松手时出现」是为了躲「抬手指落到刚出现的遮罩上」；
    // 现由 autoOpenGuard 守卫窗解决（弹出后一小段时间内的指针事件一律忽略），
    // 行为改为按满即弹——更自然。
    const tick = fnSource('tickModePress');
    assert.match(tick, /enterAssets\(/, '满时长由推进帧直接弹窗（不必等松手）');
    assert.match(tick, /__autoOpenedAt = performance\.now\(\)/, '弹出时刻要记下（守卫窗的起点）');
    // 收尾函数只处理短按提示；守卫窗内紧跟的松手要被忽略
    const end = fnSource('endModePress');
    assert.match(end, /decision === 'hint'/, '短按仍要教一句');
    assert.match(end, /autoOpenGuard\(/, 'pointerup 收尾必须查守卫（否则抬手即关）');
  });

  test('送达前有过一次确认：挡住「顺手点开看看」', () => {
    const src = fnSource('enterAssets');
    assert.match(src, /showConfirm\(/, '送达资产页前必须确认');
    assert.match(src, /switchMode\('assets'\)/, '确认回调里才真正切换');
    assert.ok(src.indexOf('showConfirm(') < src.indexOf("switchMode('assets')"), '切换只能发生在确认回调内');
  });

  test('确认框的按钮文案/色调每次重置（金调不得粘到下一个删除确认上）', () => {
    const src = fnSource('showConfirm');
    assert.match(src, /ok\.textContent = opts\.okLabel \|\| '确认'/, '文案默认回「确认」');
    assert.match(src, /ok\.className = opts\.tone === 'gold' \? 'btn-gold' : 'btn-danger'/, '色调默认回危险色');
  });
});

describe('UI 接线契约：弹窗可访问性', () => {
  test('每个 modal-overlay 都要有名字（aria-labelledby 指向本弹窗内的可见标题）', () => {
    // role="dialog" + aria-modal 只说明「这是一层模态」，没说明「这是哪一层」。
    // 原先 15 个弹窗一个名字都没有，读屏器打开后只念「对话框」。
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
    // 展示条件改由 JS 加 .placed（气泡展示时要搬到 body 下，见 placeTipBubble 注释）
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
    // 定位在 logic.js（纯函数，可单测），页面只做一次赋值
    // 定位换算是纯函数（在 logic.js，可单测）；页面只负责量尺寸并写两个 CSS 变量
    const logicSrc = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logicSrc, /function tipBubblePos\(/, '定位换算有单一入口（logic.js 纯函数）');
    assert.match(html, /function placeTipBubble\(/, '页面只做「量尺寸 + 写变量」这一件事');
    assert.match(html, /--tip-x/, '坐标经 CSS 变量写入');
    assert.doesNotMatch(html, /bubble\.style\.(left|top)\s*=/, '不得直接写 left/top（与 CSS 变量两套来源）');
    assert.match(html, /document\.addEventListener\('mouseout'/, '收起时把气泡搬回原处（否则它会一直显示）');
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
    assert.match(html, /<h3 class="font-display modal-title" id="runway-modal-title">标签与月消费/, '标题已改名');
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

  test('内容栏宽度与左右边距单一来源（页头 / 子 Tab / 正文共用一套 token）', () => {
    // 原先 max-w-6xl + px-6 在 4 处各写一遍：改一处就会让某一行单独错位。
    // 而且 Tailwind 走 CDN、在 E2E 里是空壳——工具类根本不可测，版式不能建在它上面。
    assert.strictEqual(count(/class="[^"]*max-w-6xl/g), 0, '内容栏宽度不得再由 Tailwind 工具类承担');
    for (const sel of ['.app-header-inner', '.content-column']) {
      assert.match(html, new RegExp(`\\.${sel.slice(1)}\\b[^{]*\\{[^}]*max-width: var\\(--content-max\\)`), `${sel} 走内容栏 token`);
    }
    assert.match(html, /--content-max: \d+rem;/, '宽度 token 存在');
    assert.match(html, /--content-pad: [\d.]+rem;/, '边距 token 存在');
    // 四个用法处都挂同一个类（页头 / 两个模式的 Tab 栏 / 正文）
    assert.strictEqual(count(/class="app-header-inner/g), 1, '页头走内容栏');
    assert.strictEqual(count(/class="content-column/g), 3, '两个 Tab 栏与正文都走内容栏');
  });

  test('原生控件明暗由页面的 color-scheme 决定（不跟随系统）', () => {
    // 主题是应用内自己切的：写 light dark 会让「系统暗 + 页面亮」时弹出反色下拉面板
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
      ['cols-expenses', '96px 108px minmax(0, 1fr) minmax(0, 1.6fr) 148px'],
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
    // 表头与数据行必须引用同一个常量/类名，而不是各自写一遍
    for (const name of ['cols-segment', 'cols-compare', 'cols-expense-segment']) {
      assert.match(html, new RegExp(`const cols = '${name}'`), `${name} 走常量`);
    }
  });

  test('旭日图的高度由列宽决定（不写死像素，否则清单只有一行时右侧塌成一片空白）', () => {
    // 实测：消费分布卡高 619px，其中图纸写死 520px，而右侧构成清单只有 35px（一行）。
    // 图纸是正圆形，高度写死就与「这张卡实际有多少内容」脱钩——分类少时整卡被空白撑起。
    // 圆在 CSS 里没有确定尺寸（由 ECharts 按容器算），故高度只能由列宽推出来。
    const heights = html.match(/id="(sunburst-chart|income-chart|expense-sunburst-chart)"[^>]*style="[^"]*height:\s*(\d+)px/g) || [];
    assert.strictEqual(heights.length, 0,
      `图纸高度不得写死像素：${heights.map((h) => h.slice(0, 60)).join(' / ')}`);
    // 三张旭日图共用同一套宽高比（同类结构同一实现）
    assert.match(html, /\.chart-canvas \{[^}]*aspect-ratio/, '高度由列宽与宽高比推出');
    assert.strictEqual((html.match(/class="chart-canvas[ "]/g) || []).length, 3, "三张旭日图都走同一个容器类（高度比例只在类里定义）");
  });

  test('新增标签的输入框按标签体量给宽（不靠 flex-1 撑满整行）', () => {
    // 实测：这一行输入框占满卡片整宽（约 990px），而它只用来敲一个 2–4 字的标签；
    // 「添加」按钮还被推到整页右端——一件控件被拉成两半。
    // flex-1 是 Tailwind 类：CDN 空壳下既不生效也不可测，必须换成自有 CSS 的宽度上限。
    assert.strictEqual(count(/placeholder="新增标签（回车添加）"[^>]*flex-1/g), 0,
      '新增标签输入框不得再靠 flex-1 撑满（Tailwind 空壳下不可测）');
    assert.match(html, /\n  \.new-tag-row \{[^}]*max-width/, '宽度上限在自有 CSS 里定义');
    assert.match(html, /class="new-tag-row"/, '那一行挂上同一套 class（资产/消费两侧共用）');
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
    // 日期栏定宽：日期是定长文本（YYYY-MM-DD），按 fr 分配就永远贴着内容宽
    assert.match(html, /\n  \.cols-expense-month \{ grid-template-columns: 96px 1fr 2fr 1\.5fr; \}/, '月度明细的日期栏定宽');
    assert.match(html, /\n  \.cols-expense-segment \{ grid-template-columns: 96px 1fr 0\.8fr 2\.6fr; \}/, '构成明细的日期栏定宽');
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
    // 旧写法：消费分布自己 reduce 合计（与扇区口径分家）
    assert.ok(!/filtered\.reduce\(/.test(expenseSrc), '消费分布不得再自己 reduce 合计');
    assert.match(expenseSrc, /sumAmountCNY\(/, '消费分布走同一纯函数');
    // 报头净资产也委托同一纯函数：不得再自写一遍 reduce
    assert.match(fnSource('totalAssetsCNY'), /sumAmountCNY\(/, '净资产合计与分布总数同源');
    // 总数渲染收在同一 helper，避免两处 DOM 副作用漂移
    assert.match(fnSource('renderChart'), /renderChartTotal\(/);
    assert.match(expenseSrc, /renderChartTotal\(/);
  });

  test('显示的总数与 tooltip 百分比分母是同一个变量（曾两套口径各算各的）', () => {
    // 曾一边显示「已归类合计」、一边用「全局净资产」做分母：同一张卡上两个总数，
    // 扇区百分比之和对不上显示的总数（口径分裂）。这里钉死「只用同一个 total 变量」。
    for (const fn of ['renderChart', 'renderExpenseChart']) {
      const src = fnSource(fn);
      // 取金额变量，不是 DOM 元素变量（totalEl = document.getElementById(...) 要先排除）
      const decl = src.match(/const (\w*[Tt]otal\w*) = (?!document\.)[^;]+;/);
      assert.ok(decl, `${fn} 应有一个金额合计变量（实测 ${JSON.stringify(src.slice(0, 60))}）`);
      const name = decl[1];
      // 分母经 sunburstDrillView 派生（下钻时换成该分类合计），但**仍然只有一个变量**：
      // 卡片总数、tooltip、清单三处都读 view.total，不再各算一遍
      assert.match(src, new RegExp(`sunburstDrillView\\(data, ${name}, `), `${fn}: 派生以该筛选合计为起点`);
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
      // 每个 showChartOrEmpty(..., false) 所在行之后紧跟一次收起（同一分支里）
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
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logic, /function lampPos\(/, '坐标换算下沉 logic.js');
    assert.match(logic, /function lampEnabled\(/, '开关判定下沉 logic.js');
    // 页面里只允许出现「读坐标 → 调 lampPos → 写变量」这一种写法，不允许自己算百分比
    const src = fnSource('flushLamp');
    assert.match(src, /lampPos\(/, '走纯函数换算');
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
    assert.strictEqual(count(/lampEnabled\(/g), 1, '页面只调用、不重写判定');
    assert.match(html, /prefers-reduced-motion/, '减动效有出口');
    assert.match(html, /pointer: coarse/, '触屏不跟（无悬停可言）');
    assert.match(fnSource('syncLamp'), /lampEnabled\(/, '开关走纯函数');
  });

  test('还没收到指针坐标前不亮灯（首帧在正中先亮一团光再跳走，不像灯）', () => {
    const src = fnSource('syncLamp');
    assert.match(src, /_lampLast !== null/, '未收到坐标时不得点亮');
    assert.match(fnSource('setLampAt'), /syncLamp\(\);/, '首枚坐标到达时点亮');
  });

  test('掠光是纸面光学，不该给卡片/行另加一套悬停渐变（各部件各有自己的 hover 语义）', () => {
    // 表格行的 hover 是「当前行」的指示，曾经就是纯底色；不得被光晕改写
    assert.match(html, /\n  \.asset-row:hover \{ background: var\(--card-2\); \}/, '行悬停语义不变');
    // 不允许再出现第二套「跟随指针的光晕」（如逐卡片的 radial-gradient hover）
    const mats = html.match(/radial-gradient\(\d+px \d+px at var\(--lamp-x/g) || [];
    assert.strictEqual(mats.length, 1, '指针处的小圆芯只此一处');
    const lampCss = html.match(/\.lamp-layer \{[^}]*\}/)[0];
    assert.match(lampCss, /var\(--lamp-x, 50%\)/, '未收到指针时停在居中兜底值');
    // 光带靠 calc(--lamp-x ± …) 跟随指针横扫；写成固定角度的死值就退化成「装饰条纹」而非「掠光」
    assert.match(lampCss, /transparent calc\(var\(--lamp-x, 50%\) [-+]/, '光带位置随指针（而非固定条纹）');
    // 大半径圆霍 = 「一圈发光背景」（模板式），不是打在纸上的光
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
    // theme.spec.js 的两套变量一一对应巡检只扫 :root / :root.dark，
    // 这三条正在这两块里（漏定义会让暗色下回落到亮色的暖白灯——一片刺眼白斑）
  });

  test('关键动效均可在减动效下关停（光晕在减动效下直接不画）', () => {
    // 光晕靠 pointermove + rAF 驱动，必须有一条 CSS 侧的硬出口
    // （logic.js 的 lampEnabled 是另一道闸，两重保险：JS 不写 + CSS 不画）
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{ \.lamp-layer \{ display: none; \} \}/, '光晕在减动效下直接不画');
    assert.match(fnSource('syncLamp'), /lampEnabled\(/, 'JS 侧也走同一道判定');
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
describe('UI 接线契约：内联脚本必须能通过解析', () => {
  const inlineScript = () => {
    const i = html.lastIndexOf('<script>');
    const j = html.lastIndexOf('</script>');
    return html.slice(i + '<script>'.length, j);
  };

  test('内联脚本可解析（顶层声明重名会在此现形）', () => {
    const src = inlineScript();
    assert.ok(src.length > 10000, '应取到内联脚本全文（正则/切片是否失效？）');
    assert.doesNotThrow(() => new Function(src), '内联脚本存在语法错误（顶层声明重名等）——整段脚本都不会执行');
  });

  test('logic.js 可解析', () => {
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.doesNotThrow(() => new Function(logic));
  });

  test('顶层声明去重检查本身有效（对重名样本报错）', () => {
    // 自检：确认这层防护不是空转
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
    assert.match(src, /sunburstLegendRows\(/, '排序/占比/选中口径下沉 logic.js');
    // 占比不得在页面里再算一遍（同一张卡上两个「占比」各算各的口径就是 bug）
    assert.ok(!/\/\s*total\s*\*\s*100/.test(stripComments(src)), '不得内联重写百分比');
    assert.match(src, /formatCNY\(/, '金额走统一格式化');
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
      // 下钻后分母换成该分类合计，但派生只有一个来源（sunburstDrillView），
      // 卡片总数 / tooltip / 清单三处都读同一个 view.total
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
    // 重抄就会出现第二处材质定义，往后改材质必漏一处
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
    // 故它只允许待在内边距带里（实测：正文首行的实取色对比仍有 6.4:1，见 AGENTS）。
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
    // 两态：booting:not(.ready) = 未落定（透明/下移），ready = 过渡到最终态。
    assert.match(html, /html\.booting:not\(\.ready\) \.app-header-inner/, '未落定那一态存在');
    assert.match(html, /html\.ready \.app-header-inner \{[^}]*transition:/, '落定那一态带过渡');
    assert.match(html, /html\.booting:not\(\.ready\) \.lamp-layer \{[^}]*opacity: 0/, '第二拍：未落定时按住台灯');
    // 关键：隐藏内容的规则只能挂在 booting 上（脚本不跑时 booting 不存在 → 内容正常可见）
    const hiding = html.match(/html\.booting:not\(\.ready\)[^{]*\{[^}]*opacity:\s*0[^}]*\}/g) || [];
    assert.ok(hiding.length > 0, '未落定态确实在隐藏纸面');
    // 不得用 display/visibility 藏（那会让巡检与读屏器真的一无所见）
    for (const r of hiding) assert.doesNotMatch(r, /display:\s*none|visibility:\s*hidden/, r.slice(0, 60));
    // 不得用 @keyframes 做入场：隐藏容器里的元素会卡在 from 帧（实测过的坑）
    assert.doesNotMatch(html, /@keyframes settle/, '入场不得回到 keyframes 写法');
  });

  test('booting 与看门狗写在 <head>，ready 在首屏渲染完成后加', () => {
    const head = html.slice(0, html.indexOf('<style>'));
    assert.match(head, /classList\.add\('booting'\)/, '首帧前就进入未落定态（否则会先看见内容再跳一下）');
    assert.match(head, /setTimeout\(function \(\) \{[\s\S]*?classList\.add\('ready'\)/, '看门狗自己放行（脚本万一没跑到就绪，页面不得空白）');
    // 就绪点在「渲染完成之后」：DOMContentLoaded 里 renderAll 之后才翻转，否则落纸先于内容
    const boot = html.match(/document\.addEventListener\('DOMContentLoaded'[\s\S]*?classList\.add\('ready'\)/);
    assert.ok(boot, 'ready 由启动流程翻转');
    assert.ok(boot[0].indexOf('renderAll()') < boot[0].indexOf("classList.add('ready')"), '先渲染完，再落纸');
  });

  test('减动效要连延迟一起关（只关时长的话，带 delay 的入场会先停在未落定态）', () => {
    // 闸门本身是那条「一把关掉全部动效」的全局规则（不写死行号，只认它的形态）
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
  test('每个 echarts.init 都紧跟一次 observeChartSize（新增第六张图不能漏登记）', () => {
    const inits = (html.match(/echarts\.init\(/g) || []).length;
    // 数「紧跟」而不是数全局出现次数：observeChartSize 自己的定义也算一次出现
    const paired = (html.match(/echarts\.init\([^)]*\);\s*observeChartSize\(/g) || []).length;
    assert.ok(inits >= 5, `本应用现有 5 个图表面（实得 ${inits}）`);
    assert.strictEqual(paired, inits, `init ${inits} 处、紧跟登记 ${paired} 处：每张图都要盯住容器`);
  });

  test('尺寸只以容器的可见尺寸为准（隐藏时不 resize，那才是把图做废的那一步）', () => {
    const src = fnSource('syncChartSize');
    assert.match(src, /clientWidth/, '读容器宽');
    assert.match(src, /clientHeight/, '读容器高');
    assert.match(src, /if \(!w \|\| !h\) return/, '容器不可见（尺寸 0）时不动它');
    // 旧的 window resize 统一登记不再保留：它覆盖不到「切 Tab 的 display 翻转」
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
    assert.match(src, /sunburstLegendRows\(/, '选中态/分母口径下沉 logic.js');
    assert.ok(!/\/\s*sub\s*\*\s*100/.test(stripComments(src)), '不得在页面里重写百分比');
  });

  test('高亮定位经 sunburstNodePath 换算（dataIndex 是扁平树下标，不是顶层下标）', () => {
    const src = fnSource('renderSunburstLegend');
    assert.match(src, /sunburstNodePath\(/, '下标换算下沉 logic.js');
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
    // 三个图各自接一次（资产/消费/收益分布）
    assert.strictEqual(count(/wireSunburstDrill\(/g), 4, '定义一处 + 三张图各接一次');
    const src = fnSource('wireSunburstDrill');
    assert.match(src, /drillSunburst\(/, '点击扇区 → 选中该分类');
    assert.match(src, /treePathInfo/, '用 ECharts 给的祖先路径判层级（顶层分类才下钻）');
    // 清单行的点击入口在 renderSunburstLegend 里（DOM 归它管），但也只能调 drillSunburst
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

  /*
   * 图本身也要下钻，且与清单同一套状态。
   * ------------------------------------------------------------------------
   * 修的真 bug：ECharts 自带 nodeClick:'rootToNode' 会维护自己的 view root，
   * 与清单的 sunburstLegendSel 是两套状态。于是「‹ 全部分类」只清了清单，
   * 图还停在下钻层（用户原话：「返回到整个全景的时候，依然展示的是具体分类的值」）。
   * 修法：关掉原生下钻，图的数据由选中态派生（sunburstDrillView）。
   */
  test('关掉 ECharts 原生下钻（nodeClick:false），否则图上会有第二套视图状态', () => {
    const src = fnSource('buildSunburstOption');
    assert.match(src, /nodeClick: *false/, '必须显式关掉原生下钻');
    // 回潮即报错：两个原生入口（点击下钻、内环点击返回）都只由 nodeClick 驱动
    assert.doesNotMatch(src, /nodeClick: *'rootToNode'/, '不得交回 ECharts 自己管视图');
    assert.doesNotMatch(stripComments(html), /sunburstRootToNode/, '不得到处 dispatch 原生下钻动作');
  });

  test('三张旭日图的数据都经 sunburstDrillView 派生（图与清单同一套选中态）', () => {
    assert.strictEqual(count(/function sunburstDrillView\(/g), 0, '派生逻辑下沉 logic.js，页面不另写一份');
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart']) {
      const src = fnSource(fn);
      assert.match(src, /sunburstDrillView\(/, `${fn}: 喂给图的数据必须由选中态派生`);
    }
    // 派生结果必须是**同一个变量**同时喂给图、tooltip、清单（否则又是一处口径分裂）
    const src = fnSource('renderChart');
    assert.match(src, /const view = sunburstDrillView\(/, '派生结果收在 view 里');
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
    // 监听器累积的实际症状：点一下触发 N 次下钻，N 为偶数时 toggle 回原位 =「点了没反应」。
    // 与堆叠柱下钻同惯例：wire 在 if (!chart) 分支里。
    for (const [fn, id] of [['renderChart', 'chart-legend'], ['renderIncomeChart', 'income-chart-legend'], ['renderExpenseChart', 'expense-chart-legend']]) {
      const src = fnSource(fn);
      const initBlock = src.slice(src.indexOf('echarts.init'), src.indexOf('}', src.indexOf('echarts.init')));
      assert.ok(initBlock.includes(`wireSunburstDrill(`), `${fn}: 接线放在 init 分支内（只注册一次）`);
      assert.strictEqual(count(new RegExp(`wireSunburstDrill\\([^)]*'${id}'\\)`, 'g')), 1, `${id}: 接线只出现一次`);
    }
  });

  test('setOption 前先清掉强调态（否则 blur 会粘在新扇区上）', () => {
    // 真实 ECharts 5 实测：下钻/返回后，setOption 重建的扇区会继承上一帧的 blur(0.2)，
    // 表现为几个扇区一直是灰的。三张旭日图都必须在 setOption 前 downplay。
    for (const fn of ['renderChart', 'renderIncomeChart', 'renderExpenseChart']) {
      const src = stripComments(fnSource(fn));
      const downplay = src.indexOf("dispatchAction({ type: 'downplay' })");
      const setOption = src.indexOf('setOption(');
      assert.ok(downplay >= 0, `${fn}: 重绘前应清强调态`);
      assert.ok(downplay < setOption, `${fn}: downplay 必须在 setOption 之前（否则清的是旧扇区）`);
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
    assert.match(fnSource('moveAsset'), /moveAssetIndex\(/, '数组操作复用 logic.js 纯函数');
    assert.match(fnSource('moveAsset'), /sortBy = ''/, '移动后清空排序状态（与拖拽 drop 同一套收尾）');
    const h = stripComments(fnSource('renderAssets'));
    assert.match(h, /moveAsset\(/, '把手 keydown 必须调 moveAsset');
  });
});

describe('UI 接线契约：Tab/模式切换的过渡动画', () => {
  // 用户要求页面切换有顺滑过渡（精致感）。约束：display 翻转没法过渡，
  // 所以用「显示后下一帧加 .enter」两步走；减动效时 delay/时长一起归零
  // （只关时长的话带 delay 的入场会停在「还没出来」——开屏那条的教训）。
  test('入场过渡挂在会动画的内层面板上：switchTab 触发，switchMode 只透传方向', () => {
    assert.match(fnSource('switchTab'), /enterTab\([\s\S]*?shift\)/, 'switchTab 要触发内层面板的入场过渡');
    const mode = stripComments(fnSource('switchMode'));
    assert.doesNotMatch(mode, /enterTab\(/,
      'switchMode 不得对 content-* 调 enterTab：动画选择器只认 [id^="tab-"] 内层面板，那是无人消费的死接线');
    assert.match(mode, /switchTab\([^)]*shift\)/, '方向经 switchTab 透传给真正入场的面板（一次翻页一个方向）');
  });

  test('入场过渡在 CSS 里统一定义（不逐处内联）', () => {
    // pane 元素没有 tab-pane 类（section 只有 id），选择器用 [id^=tab-] 前缀
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
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logic, /function paneEnterShift\(/, '方向判定必须在 logic.js（可单测）');
    const tab = stripComments(fnSource('switchTab'));
    assert.match(tab, /paneEnterShift\(/, 'switchTab 的方向要喂给同一份判定（不得各写一份）');
    assert.match(tab, /enterTab\([\s\S]*?shift\)/, 'switchTab 要把方向一并传给 enterTab');
    const mode = stripComments(fnSource('switchMode'));
    assert.match(mode, /paneEnterShift\(/, 'switchMode 的方向同样走这份判定');
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
    assert.match(src, /enterAssets\(\)/, 'tick 满时长要直接 enterAssets()');
  });

  test('自动弹出必须开守卫闸：紧跟的 pointerup/click 不得把弹窗点掉', () => {
    const logic = fs.readFileSync(path.join(__dirname, '..', 'logic.js'), 'utf8');
    assert.match(logic, /AUTO_OPEN_GUARD_MS/, '守卫窗常量定义在 logic.js');
    assert.match(html, /autoOpenGuard\(/, '守卫判定走 logic.js 纯函数（不重写一份）');
    // 收尾函数要查守卫
    const end = stripComments(fnSource('endModePress'));
    assert.match(end, /autoOpenGuard\(/, 'pointerup 收尾必须查守卫（否则抬手即关）');
    // 遮罩关闭也要查守卫
    const overlayBlock = blockFrom(html, '__modalMouseDownTarget = e.target', '__modalMouseDownTarget = null');
    assert.match(overlayBlock, /autoOpenGuard\(/, '遮罩 click 关闭也必须查守卫');
    // 确认按钮在守卫窗内的点击也要忽略（那是抬手余波，不是用户真点）
    const okBtn = blockFrom(stripComments(html), "getElementById('confirm-ok-btn').addEventListener");
    assert.match(okBtn, /autoOpenGuard\(/, '确认按钮的 click 也必须查守卫');
  });

  test('弹窗必须真的从 tick 里弹出，而不是把确认框推后到松手', () => {
    const tick = stripComments(fnSource('tickModePress'));
    assert.doesNotMatch(tick, /classList\.add\('armed'\)/, 'armed 停帧态不再需要（满了就弹）');
  });
});
