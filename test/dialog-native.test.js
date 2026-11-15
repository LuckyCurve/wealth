/*
 * dialog-native.test.js — 弹窗的底层机制是原生 <dialog>，不是手写遮罩
 * --------------------------------------------------------------------------
 * 这条迁移把五件事交给了平台：顶层叠放、背景 inert、Tab 关在弹窗里、Esc 与返回手势、
 * 关闭后把焦点还给打开它的控件（见 docs 与 DECISIONS.md 里那一条）。
 * 手写的那套（焦点陷阱 / 返回焦点栈 / html.modal-open 滚动锁 / 遮罩 click 命中）
 * 一旦悄悄长回来，就会和平台抢同一个位置——这里逐条堵住，判据从文件自身求值。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const markup = read('index.html');
const CSS_FILES = ['styles.css', 'styles-views.css', 'styles-print.css'];
const css = CSS_FILES.map(read).join('\n');
const JS_FILES = ['app-core.js', 'app-gate.js', 'app-assets.js', 'app-categories.js', 'app-charts.js',
  'app-stress.js', 'app-settings.js', 'app-ui.js', 'app-expenses.js', 'app-tag-check.js',
  'app-calendar.js', 'app-receipt.js', 'app-yield.js'];
const js = JS_FILES.map(read).join('\n');
const all = markup + '\n' + css + '\n' + js;
const count = (re) => (all.match(re) || []).length;
const stripComments = (src) =>
  String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fnSource = (fn) => {
  const m = all.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `fnSource 未匹配到函数 ${fn}（改名会让断言静默失效，此处必须报错）`);
  return m[0];
};

describe('原生弹窗：骨架', () => {
  test('20 个弹窗都是 <dialog>，遮罩与纸合并成一层（不再有 div.modal-overlay / .modal-content）', () => {
    assert.strictEqual(count(/<dialog id="[^"]+" class="modal-overlay[^"]*"/g), 20, '弹窗数量（实得 ' + count(/<dialog id="/g) + '）');
    const bare = stripComments(all);
    assert.strictEqual((bare.match(/<div[^>]*class="modal-overlay/g) || []).length, 0, 'div 版遮罩不得回潮');
    assert.strictEqual((bare.match(/modal-content/g) || []).length, 0, '.modal-content 已并入 .modal-overlay，不得回潮');
  });

  test('语义由元素本身给：没有 role="dialog"、aria-modal、内联 display:none', () => {
    const bare = stripComments(all);
    assert.strictEqual((bare.match(/role="dialog"/g) || []).length, 0, '原生 <dialog> 已给角色，再写一遍就是两份真相');
    assert.strictEqual((bare.match(/aria-modal/g) || []).length, 0, '原生模态已承诺 inert，再写一遍会与平台打架');
    assert.strictEqual((bare.match(/<dialog[^>]*style="display:none/g) || []).length, 0, '开关交给 showModal/close，不得内联 display');
  });

  test('每个弹窗都显式选 closedby="any"（本项目的语义是「点遮罩空白可关」）', () => {
    const tags = markup.match(/<dialog id="[^"]+"[^>]*>/g) || [];
    const bad = tags.filter((t) => !/ closedby="any"/.test(t)).map((t) => (t.match(/id="([^"]+)"/) || [])[1]);
    assert.deepStrictEqual(bad, [], '这几个弹窗没声明 closedby：' + bad.join(', '));
  });

  test('每个弹窗标题都带 tabindex="-1"：showModal 的初始焦点落在标题（顶部、不滚动）', () => {
    const titles = markup.match(/<h3 class="font-display modal-title"[^>]*>/g) || [];
    assert.strictEqual(titles.length, 20, '弹窗标题数量');
    const bad = titles.filter((t) => !/tabindex="-1"/.test(t)).map((t) => (t.match(/id="([^"]+)"/) || [])[1]);
    assert.deepStrictEqual(bad, [], '这些标题还不可聚焦：' + bad.join(', '));
  });
});

describe('原生弹窗：开关只有一条路', () => {
  test('打开只走 showModal()，关闭只走 close()', () => {
    assert.match(fnSource('openModal'), /\.showModal\(\)/, 'openModal 必须调 showModal()');
    assert.match(fnSource('closeModal'), /\.close\(\)/, 'closeModal 必须调 close()');
    assert.strictEqual(count(/\.showModal\(\)/g), 1, '打开入口只有一个');
    assert.strictEqual(count(/modal\.close\(\)/g), 1, '关闭入口只有一个');
    assert.strictEqual(count(/\.show\(\)/g), 0, 'show() 不是模态，不得使用');
  });

  test('撤销式关闭接在平台的 cancel 上（Esc / 点遮罩 / 返回手势三条路一条收尾）', () => {
    assert.match(all, /addEventListener\('cancel', onModalDismiss\)/, '每个弹窗都要接 cancel');
    const dismiss = fnSource('onModalDismiss');
    assert.match(dismiss, /preventDefault\(\)/, '先拦下平台自己的关闭，让「关」只有一条路');
    assert.match(dismiss, /confirmCancel\(\)/, '确认框要清回调');
    assert.match(dismiss, /cancelAssetGate\(\)/, '门槛弹窗要作废本次');
    assert.match(dismiss, /cancelPassImport\(\)/, '导出密码弹窗要复位');
    assert.match(dismiss, /__pressAt/, '「按下早于弹窗打开」的那次手势不算点了遮罩');
  });

  test('手写机构一件都不许长回来', () => {
    const bare = stripComments(all);
    for (const [re, why] of [
      [/trapFocus/, '手写焦点陷阱'],
      [/__modalReturnFocus/, '手写返回焦点栈'],
      [/syncScrollLock/, '手写滚动锁'],
      [/html\.modal-open/, 'html.modal-open 滚动锁'],
      [/e\.key !== 'Tab'/, 'Tab 键盘接管'],
      [/e\.key !== 'Escape'/, 'Esc 键盘接管'],
      [/__modalMouseDownTarget/, '遮罩命中的按下点记录'],
      [/el\.inert =/, '逐元素 inert 切换'],
    ]) {
      assert.strictEqual((bare.match(re) || []).length, 0, why + ' 不得回潮（平台已经给了）');
    }
  });
});

describe('原生弹窗：CSS 的两条强制项', () => {
  test('dialog:modal 与 dialog::backdrop 都收住滚动链', () => {
    assert.match(css, /dialog:modal \{ overscroll-behavior: contain; \}/, '缺它：在弹窗里滚到头会接着滚背景');
    assert.match(css, /dialog::backdrop \{ overflow: hidden; overscroll-behavior: contain; \}/,
      '::backdrop 默认不是滚动容器，overflow 那半句不能省');
  });

  test('顶层元素的过渡：overlay 进列表、allow-discrete 单独一行、@starting-style 只给入场', () => {
    const rule = css.match(/\n  \.modal-overlay \{[\s\S]*?\n  \}/)[0];
    assert.match(rule, /transition-property:[^;]*\boverlay\b/, 'transition 列表必须含 overlay');
    assert.match(rule, /^\s*transition-behavior: allow-discrete;/m, 'allow-discrete 必须单独一行');
    assert.match(css, /@starting-style \{ opacity: 0; \}/, '入场起步态写在 @starting-style 里');
    assert.match(css, /prefers-reduced-motion: no-preference\) \{\s*\.modal-overlay \{ transform: translateY\(20px\); \}/,
      '位移只给没要求减动效的人');
  });

  test('遮罩是 ::backdrop（磨砂留在 dialog 身上会连正文一起糊）', () => {
    const backdrop = css.match(/\n  \.modal-overlay::backdrop \{[\s\S]*?\n  \}/)[0];
    assert.match(backdrop, /background: var\(--scrim\)/, '遮罩色走 --scrim');
    assert.match(backdrop, /backdrop-filter: blur\(8px\)/, '磨砂在遮罩上');
    const dialog = css.match(/\n  \.modal-overlay \{[\s\S]*?\n  \}/)[0];
    assert.doesNotMatch(dialog, /backdrop-filter/, '磨砂不得留在 dialog 自己身上');
  });
});
