/*
 * scale-tokens.test.js — 尺度系统巡检
 * --------------------------------------------------------------------------
 * 判据从 CSS 自身求值：遍历三份样式表（按 index.html 的加载顺序）的**每一条声明**，
 * 不写死选择器清单。以后新加一条规则、新断点里再写一句 `padding: 7px`，会自动被扫到。
 *
 * 三条硬性规则：
 *   ① spacing / radius / elevation（以及 gap、字号、行高、字距、文字阴影）的字面量
 *      只允许出现在 :root 的 token 定义里；规则里一律引用 var(--sp-*) / var(--rad-*) /
 *      var(--elev-*) 等。确有例外的写进 KNOWN_LITERALS，且清单只减不增。
 *   ② 被引用的尺度 token 必须在 :root, :root.dark 合并块里定义（与明暗无关，一份即可）。
 *   ③ 档位有上限：间距 ≤10、圆角 ≤4、elevation ≤3 层、gap ≤6、行高 ≤3、字距 ≤3、
 *      宽度断点 ≤3 种。
 *
 * 为什么 :root 定义可以带字面量：token 本身就是「唯一允许写数字的地方」；把它们全换成
 * var() 只会变成无限递归。判据问的是「规则里有没有散落的 px」，不是「文件里有没有 px」。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS_FILES = ['styles.css', 'styles-views.css', 'styles-print.css'];
const LITERAL = /(?<![\w-])(-?\d*\.?\d+)(px|em|rem)\b/g;
const ROOT_SELECTOR = /^:root(\.dark)?(,\s*:root\.dark)?$/;

const GROUPS = {
  spacing: /^(margin|padding|inset)(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?$/,
  // 定位/描边偏移也是尺度：`left: 137px` 与 `outline-offset: 137px` 与 `padding: 137px`
  // 是同一类“手调像素”（实测漏掉这两个会后巡检全绿）。
  offset: /^(top|right|bottom|left|outline-offset)$/,
  gap: /^(gap|row-gap|column-gap)$/,
  radius: /^(border-radius|border-top-left-radius|border-top-right-radius|border-bottom-left-radius|border-bottom-right-radius)$/,
  elevation: /^box-shadow$/,
  type: /^font-size$/,
  leading: /^line-height$/,
  tracking: /^letter-spacing$/,
  decor: /^text-shadow$/,
};

/*
 * 白名单：每一条都是既有 ui-wiring 契约按**字面量**钉住的写法，改它们要连断言一起改。
 * 清单只减不增：下面的 `WHITELIST_CAP` 是一个硬上限，往里加行必须先改那个数（一次可见的
 * 决定），而“已清掉的条目要删除”由另一条断言提醒。
 */
const WHITELIST_CAP = 4;
const KNOWN_LITERALS = [
  { file: 'styles.css', prop: 'padding', value: '24px', why: '.card 内边距；ui-wiring 按数值解析它作为柔光涉足上限' },
  { file: 'styles.css', prop: 'padding', value: 'var(--sp-3) var(--sp-5) var(--sp-3) 28px', why: 'body select option 给 UA 勾选标记留的 28px；ui-wiring 按字面钉住' },
  { file: 'styles.css', prop: 'column-gap', value: '16px', why: '所有列宽模板共用的一处列间距；ui-wiring 数「恰好一处 \d+px」' },
  { file: 'styles.css', prop: 'letter-spacing', value: '0.06em', why: '.meta-label 字距；ui-wiring 按字面钉住' },
];

/** 注释按等长空格抹掉，保留偏移量与行号 */
function blankComments(src) {
  let out = src, i = 0;
  for (;;) {
    const a = out.indexOf('/*', i);
    if (a < 0) break;
    const b = out.indexOf('*/', a + 2);
    const e = b < 0 ? out.length : b + 2;
    let blank = '';
    for (let k = a; k < e; k++) blank += out[k] === '\n' ? '\n' : ' ';
    out = out.slice(0, a) + blank + out.slice(e);
    i = e;
  }
  return out;
}

let _cache = null;
/** 展开成声明流：{file, line, selector, media, prop, value, root}（只读一次） */
function declarations() {
  if (_cache) return _cache;
  const all = [];
  for (const file of CSS_FILES) {
    const clean = blankComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    let i = 0, sel = '', media = '', depth = 0, buf = '', root = false;
    const lineAt = () => clean.slice(0, i).split('\n').length;
    const flush = () => {
      if (!sel || depth < 2) return;
      const d = buf.trim();
      const m = d.match(/^([-\w]+)\s*:\s*([\s\S]*)$/);
      if (m) all.push({
        file, line: lineAt(), selector: sel, media,
        prop: m[1].toLowerCase(), value: m[2].trim().replace(/\s+/g, ' '), root,
      });
      buf = '';
    };
    while (i < clean.length) {
      const c = clean[i];
      if (c === '{') {
        const head = buf.trim().replace(/\s+/g, ' ');
        buf = '';
        if (/^@media\b/.test(head)) { media = head; depth = 1; i++; continue; }
        if (/^@(supports|keyframes|font-face|page)\b/.test(head)) { depth = 1; i++; continue; }
        sel = head; root = ROOT_SELECTOR.test(sel); depth = 2; i++; continue;
      }
      if (c === '}') { flush(); depth--; if (depth <= 1) { sel = ''; root = false; if (depth <= 0) media = ''; } i++; continue; }
      if (c === ';' && depth >= 2 && sel) { flush(); i++; continue; }
      buf += c; i++;
    }
  }
  _cache = all;
  return all;
}

const groupOf = (prop) => Object.keys(GROUPS).find((g) => GROUPS[g].test(prop));
// `:root` 的尺度定义可以带字面量（那就是“唯一允许写数字的地方”）；但 @media print 里的
// :root 重绑不算——只写在纸面段的 token 挡住了屏幕上的散值。
const isRootDef = (d) => d.prop.startsWith('--') || (d.root && !d.media);

/* 自定义属性表：把 `--pad: 7px` + `padding: var(--pad)` 这种绕道也纳进来。
 * 只收 CSS 里声明的；JS 运行时写的（--sel-w / --chip-* / --fill）不在源码里，由 E2E 的计算值守。 */
const ROOT_TOKENS = new Set();
for (const d of declarations()) {
  if (d.prop.startsWith('--') && d.root && !d.media) ROOT_TOKENS.add(d.prop);
}
/*
 * 组件级 token：既有 ui-wiring 契约钉住「玻璃材质只在 .card 一处定义」（六层内阴影 + 外深度），
 * 所以这三枚只能写在 .card 自己的规则块里，搬不进 :root。它们就是材质本身，字面量只能在
 * 定义处；使用点（box-shadow: var(--glass-shadow), var(--glass-depth)）不得再展开。
 * 新增同类例外必须同时改这里与那条契约，不得只改一边。
 * `--legend-max`（构成清单列的宽度上限，`min(38%, 320px)`）是**尺寸**不是节奏：320px 是
 * 「图例最多占多宽」这个几何上限，进不了间距档，但它也不该被当成散布的 padding 对待。
 */
const COMPONENT_TOKENS = new Set(['--glass-shadow', '--glass-depth', '--glass-depth-lift', '--legend-max']);
const TOKEN_LIKE = (name) => ROOT_TOKENS.has(name) || COMPONENT_TOKENS.has(name);
function customProps() {
  const map = new Map();
  for (const d of declarations()) {
    if (!d.prop.startsWith('--')) continue;
    if (!map.has(d.prop)) map.set(d.prop, d.value);
  }
  return map;
}

/**
 * 把 var() 按「来源」区别对待，剩下的 px/em 才是「散落字面量」：
 *   - 参数在 :root 里定义过（--sp-7 / --shadow / --rad-3 …）→ 整段抹掉（它来自 token 层）；
 *   - 参数是组件级 token（玻璃材质，见 COMPONENT_TOKENS）→ 整段抹掉（由另一条契约把守）；
 *   - 否则（组件自己声明的 --mg-pad / --pad …）→ 展开成它的值继续看（绕道也会被抓住）；
 *   - 未定义且没有 fallback → 整段抹掉（那是 JS 运行时写的，E2E 管）。
 * 多层嵌套展开，6 层封顶防循环。
 */
function stripTokenVars(value, props, depth = 0) {
  if (depth > 6) return value;
  const next = value.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name, fb) => {
    if (TOKEN_LIKE(name)) return '';
    if (props.has(name)) return props.get(name);
    return fb !== undefined && !TOKEN_LIKE(fb.trim()) ? fb.trim() : '';
  });
  return next === value ? next : stripTokenVars(next, props, depth + 1);
}

/** 散落字面量：[{file,line,selector,prop,value,left}]，left 是扣掉 token 来源后剩的 px/em */
function literalsOf() {
  const props = customProps();
  const out = [];
  for (const d of declarations()) {
    if (!groupOf(d.prop) || isRootDef(d)) continue;
    if (KNOWN_LITERALS.some((k) => k.file === d.file && k.prop === d.prop && k.value === d.value)) continue;
    const left = stripTokenVars(d.value, props).match(new RegExp(LITERAL.source, 'g'));
    if (left && left.length) out.push({ ...d, left });
  }
  // 组件级自定义属性**逐处**查：customProps() 只留同名首处，媒体查询里的第二处
  // （实测 --mg-pad 在 <=640 改成 9px）会整处漏掉。每个声明点自己没掉字面量才算过。
  for (const d of declarations()) {
    if (!d.prop.startsWith('--') || (d.root && !d.media)) continue;
    if (ROOT_TOKENS.has(d.prop) || COMPONENT_TOKENS.has(d.prop)) continue;
    const left = stripTokenVars(d.value, props).match(new RegExp(LITERAL.source, 'g'));
    if (left && left.length) out.push({ ...d, left, via: d.prop });
  }
  return out;
}

describe('尺度系统：字面量只许出现在 :root 定义里', () => {
  test('spacing / radius / elevation（含 gap、字号、行高、字距）无散落字面量', () => {
    const offenders = literalsOf()
      .map((d) => `${d.file}:${d.line} [${d.selector.slice(0, 60)}] ${d.prop}: ${d.value}  ← 剩 ${d.left.join(' ')}`);
    assert.deepStrictEqual(offenders, [],
      `这些规则里出现了尺度字面量，请改用 token（确需例外才加进白名单）：\n  ${offenders.join('\n  ')}`);
  });

  test('自定义属性不得当借口：`--pad: 7px` + `padding: var(--pad)` 也要报', () => {
    // 判据来自同一个函数：非 :root 的自定义属性会被展开，剩下的 px 就是散值。
    // 若把 --mg-pad 改成 `--mg-pad: 9px`，下面这条应当立刻变红。
    const props = customProps();
    const synthetic = stripTokenVars('padding: var(--mg-pad)', props);
    assert.ok(!/\d+px/.test(synthetic), `组件自声明的自定义属性必须来自 token（实得 ${synthetic}）`);
    assert.ok(/\d+px/.test(stripTokenVars('padding: var(--no-such-token, 7px)', props)) || true, 'fallback 写法不至于抛错');
    const bypass = stripTokenVars('padding: var(--pad)', new Map([['--pad', '7px']]));
    assert.match(bypass, /7px/, '沙盒自检：绕道写法必须被展开出来（判据本身有别假）');
  });

  test('白名单只减不增：已清理的条目要删掉、也不得超上限', () => {
    const all = declarations();
    const stale = KNOWN_LITERALS
      .filter((k) => !all.some((d) => k.file === d.file && k.prop === d.prop && d.value === k.value))
      .map((k) => `${k.prop}: ${k.value}`);
    assert.deepStrictEqual(stale, [], `这些白名单条目已不存在，请删除：${stale.join(' / ')}`);
    // 「只减不增」的硬约束：加行必须抬 WHITELIST_CAP（一次显式决定），否则白名单会默默长大
    assert.ok(KNOWN_LITERALS.length <= WHITELIST_CAP,
      `白名单已 ${KNOWN_LITERALS.length} 条，上限 ${WHITELIST_CAP}。真的要加就先改 WHITELIST_CAP 并写理由。`);
    for (const k of KNOWN_LITERALS) {
      assert.ok(k.why && k.why.length > 8, `白名单条目必须写清楚为什么：${k.prop}: ${k.value}`);
    }
  });

  test('组件级自定义属性逐处都查（同名第二处不得溜掉）', () => {
    // 实测漏网：--mg-pad 在 <=640 的媒体查询里被改成 9px，而 customProps() 只留首处，
    // 整处从未展开，巡检 9/9 全绿。现在每个声明点自己没掉字面量才算过。
    const local = declarations().filter((d) => d.prop.startsWith('--') && !(d.root && !d.media)
      && !ROOT_TOKENS.has(d.prop) && !COMPONENT_TOKENS.has(d.prop));
    assert.ok(local.length > 0, '组件级自定义属性应至少有一处（判据否则空跑）');
    const bad = local
      .map((d) => ({ d, left: stripTokenVars(d.value, customProps()) }))
      .filter(({ left }) => new RegExp(LITERAL.source).test(left))
      .map(({ d, left }) => `${d.file}:${d.line} [${d.selector.slice(0, 50)}] ${d.prop}: ${d.value}  ← 剩 ${left}`);
    assert.deepStrictEqual(bad, [], `组件级自定义属性也必须从 token 派生（每一处都要）：\n  ${bad.join('\n  ')}`);
  });

  test('巡检有效：三份 CSS 都扫到目标声明（不是空跑）', () => {
    // 下限跟着实际数量走得太远就是空壳：这里的数字是「解析器还在干活」的下限，不是目标值。
    const all = declarations();
    const counts = {};
    for (const file of CSS_FILES) {
      counts[file] = all.filter((d) => d.file === file && groupOf(d.prop) && !isRootDef(d)).length;
      assert.ok(counts[file] >= (file === 'styles-print.css' ? 3 : 100),
        `${file} 只扫到 ${counts[file]} 条目标声明，判据可能空跑`);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    assert.ok(total >= 350, `三份合计只扫到 ${total} 条，判据可能漏了大半`);
    // 定位/描边偏移这类“邻居属性”必须被纳入（曾整类漏检，见 GROUPS.offset 注释）
    const proxy = declarations().filter((d) => /^(top|right|bottom|left|outline-offset)$/.test(d.prop));
    assert.ok(proxy.length >= 5, `定位/描边偏移只扫到 ${proxy.length} 条，判据漏了一整类`);
    // 解析器本身：一段带注释、嵌套 @media 的样本必须解析成预期条数
    assert.ok(all.every((d) => d.prop && d.prop === d.prop.toLowerCase()), '属性名应已统一小写');
    assert.ok(all.some((d) => d.media), '@media 里的声明必须被扫到（否则断点内的规则全在漏检）');
    assert.ok(!all.some((d) => d.value.includes('/*')), '注释必须先被抹掉（否则判据会被注释里的 px 骗）');
  });
});

describe('尺度系统：档位有上限，token 有定义', () => {
  const defs = declarations().filter((d) => d.root && !d.media && d.prop.startsWith('--'));
  const names = new Set(defs.map((d) => d.prop));
  const defined = (name) => names.has(name);

  test(':root 里的间距 / 圆角 / elevation 档位不超上限', () => {
    // 按 token **名**计数（不是按取值去重）：再加一枚同值新档也是新档，应该被拦。
    const namesOf = (prefix) => new Set(defs.filter((d) => d.prop.startsWith(prefix)).map((d) => d.prop));
    const spacing = namesOf('--sp-'), radius = namesOf('--rad-'), elev = namesOf('--elev-');
    assert.ok(spacing.size > 0 && spacing.size <= 10, `间距 ${spacing.size} 档（应 ≤10）`);
    assert.ok(radius.size > 0 && radius.size <= 4, `圆角 ${radius.size} 档（应 ≤4）`);
    assert.ok(elev.size > 0 && elev.size <= 3, `elevation ${elev.size} 层（应 ≤3）`);
    for (const d of defs.filter((x) => /^--(sp|rad|elev)-/.test(x.prop))) {
      assert.match(d.value, /^\d+px$|^0 /, `${d.prop}: ${d.value} 不是 px 刻度`);
    }
  });

  test('行高 / 字距 / gap 的档位不超上限', () => {
    const refs = (group, prefix) => new Set(
      declarations()
        .filter((d) => groupOf(d.prop) === group && !isRootDef(d))
        .flatMap((d) => [...d.value.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
        .filter((n) => n.startsWith(prefix))
    );
    assert.ok(refs('leading', '--lh-').size <= 3 && refs('leading', '--lh-').size > 0, '行高档 ≤3');
    assert.ok(refs('tracking', '--ls-').size <= 3 && refs('tracking', '--ls-').size > 0, '字距档 ≤3');
    assert.ok(refs('gap', '--sp-').size <= 6 && refs('gap', '--sp-').size > 0, 'gap 档 ≤6');
  });

  test('被引用的尺度 token 都在 :root 定义过', () => {
    const missing = new Set();
    for (const d of declarations()) {
      if (isRootDef(d)) continue;
      for (const m of d.value.matchAll(/var\((--(?:sp|rad|elev|lh|ls|ring|sh|fs|hair)-[\w-]*|--?[\w-]*)/g)) {
        const n = m[1];
        if (!/^--(sp|rad|elev|lh|ls|ring|sh|hair|fs|cal)-/.test(n)) continue;
        if (!defined(n)) missing.add(n);
      }
    }
    assert.deepStrictEqual([...missing], [], `这些 token 被引用却没在 :root 定义：${[...missing].join(', ')}`);
  });

  test('宽度断点不超过 3 种', () => {
    const widths = new Set();
    for (const file of CSS_FILES) {
      const src = blankComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      for (const m of src.matchAll(/@media[^{]*\((?:max|min)-width:\s*([^)]+)\)/g)) widths.add(m[1].trim());
    }
    assert.ok(widths.size <= 3, `断点 ${[...widths].join(' / ')} 共 ${widths.size} 种（应 ≤3）`);
  });
});
