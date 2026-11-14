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
 * 清单只减不增：某条被清理掉后，下面的「白名单已清空」断言会提醒删掉这一行。
 */
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
const isRootDef = (d) => d.root || d.prop.startsWith('--');

function literalsOf() {
  return declarations().filter((d) => {
    if (!groupOf(d.prop) || isRootDef(d)) return false;
    LITERAL.lastIndex = 0;
    return LITERAL.test(d.value);
  });
}

describe('尺度系统：字面量只许出现在 :root 定义里', () => {
  test('spacing / radius / elevation（含 gap、字号、行高、字距）无散落字面量', () => {
    const offenders = literalsOf()
      .filter((d) => !KNOWN_LITERALS.some((k) => k.file === d.file && k.prop === d.prop && k.value === d.value))
      .map((d) => `${d.file}:${d.line} [${d.selector.slice(0, 60)}] ${d.prop}: ${d.value}`);
    assert.deepStrictEqual(offenders, [],
      `这些规则里出现了尺度字面量，请改用 token（确需例外才加进白名单）：\n  ${offenders.join('\n  ')}`);
  });

  test('白名单只减不增：已清理的条目要删掉', () => {
    const live = literalsOf();
    const stale = KNOWN_LITERALS
      .filter((k) => !live.some((d) => k.file === d.file && k.prop === d.prop && k.value === d.value))
      .map((k) => `${k.prop}: ${k.value}`);
    assert.deepStrictEqual(stale, [], `这些白名单条目已不存在，请删除：${stale.join(' / ')}`);
  });

  test('巡检有效：三份 CSS 都扫到目标声明（不是空跑）', () => {
    const all = declarations();
    const seen = [];
    for (const file of CSS_FILES) {
      const n = all.filter((d) => d.file === file && groupOf(d.prop) && !isRootDef(d)).length;
      seen.push(n);
      assert.ok(n >= 3, `${file} 只扫到 ${n} 条目标声明，判据可能空跑`);
    }
    assert.ok(seen.reduce((a, b) => a + b, 0) >= 100, `三份合计只扫到 ${seen.join('+')} 条，判据可能漏了大半`);
  });
});

describe('尺度系统：档位有上限，token 有定义', () => {
  const defs = declarations().filter((d) => d.root && d.prop.startsWith('--'));
  const names = new Set(defs.map((d) => d.prop));
  const defined = (name) => names.has(name);

  test(':root 里的间距 / 圆角 / elevation 档位不超上限', () => {
    const val = (prefix) => new Set(defs.filter((d) => d.prop.startsWith(prefix)).map((d) => d.value));
    const spacing = val('--sp-'), radius = val('--rad-'), elev = val('--elev-');
    assert.ok(spacing.size > 0 && spacing.size <= 10, `间距 ${spacing.size} 档（应 ≤10）`);
    assert.ok(radius.size > 0 && radius.size <= 4, `圆角 ${radius.size} 档（应 ≤4）`);
    assert.ok(elev.size > 0 && elev.size <= 3, `elevation ${elev.size} 层（应 ≤3）`);
    for (const v of spacing) assert.match(v, /^\d+px$/, `间距档 ${v} 不是 4px 网格上的步长`);
    for (const v of radius) assert.match(v, /^\d+px$/, `圆角档 ${v} 不是刻度值`);
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
