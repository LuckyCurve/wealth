/*
 * size-budget.test.js — 单文件的体积预算
 * --------------------------------------------------------------------------
 * 单文件是这套架构的代价：没有构建步骤、没有模块边界，index.html 只会一直变大，
 * 而一个 AI 一次能稳妥改动的文件是有限的。预算卡在这里，超了就红，让「再塞一点」
 * 变成一件需要先说明理由的事。
 *
 * 超了先按 AGENTS.md 的三步走：逻辑下沉 logic.js → 合并重复结构/收回内联样式 →
 * 确实需要时同一 commit 抬预算并写明为什么。只抬不改视为违规。
 *
 * 跑在 node --test 下，只读文件，不碰浏览器。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// index.html 当前 395,859 字节（2026-10-28，图标集落地后）。
// 2026-10-27 从 380,000 抬到 390,000：多语言给每个静态文案节点加了 data-i18n 标记
// （属性本身约 4KB），文案与英文词条已全部下沉 logic.js（那里没有预算，因为它是可单测的纯逻辑）。
// 2026-10-28 从 390,000 抬到 397,000：菜单图标集（15 个 Lucide symbol + 逐按钮接线）。
// 图标只能是标记：symbol 定义与 <use> 无法下沉 logic.js（下沉了就要求页面去拼 SVG）。
// 已做的减量：三个槽子只留 path 数据（描边/尺寸/VB 统一写在 .ico 与 symbol 一次），
// 没用图标库运行时（那会多一个 CDN 依赖与一次外网请求）。
// 视图层没有可合并的重复结构：再抬之前先确认真的无处可沉。
// 2026-10-28 从 397,000 抬到 400,000：纸纹换成 feTurbulence 非周期纤维。
// 抬之前先试了两条减量，都是**字节中性**，不足以抵账：①内联图表尺寸/滚动上限收成
// `.chart-pane` / `.scroll-cap`（两个 19 字节的 class 换两个 32 字节的内联属性）；
// ②`style="display:none"` 共 20 余处 —— 它们是 JS 的开关状态（`el.style.display` 是
// 唯一写入点），改 class 等于把所有显隐路径重写一遍，风险远大于 400 字节。
// 本轮之后同方向的增改请先在这个文件里写「试过什么」。
// 2026-10-28：纸纹修正曾临时抬到 401,000；本轮合并了 toast/badge 的同色规则、收缩了纸纹注释，
// 实际回落到 400,000 以下，故把预算退回 400,000（预算跟现实走，不跟历史最高走）。
// 2026-10-29 从 400,000 抬到 407,000：月度快照提醒（设置里一行控件 + 一个只有一个按钮的弹窗）。
// 抬之前做过的：reminder 的判据/文案/归一全部下沉 logic.js（那里没有预算，可单测）；
// 设置行复用 .setting-row/.setting-actions/.seg-control，弹窗复用 .modal-sm 与既有的 modal-footer，
// 新增 CSS 只有 .snap-days 两条；两个 setter 压成一行。剩下的只能是标记本身。
// 本轮之后同方向的增改请先在这个文件里写「试过什么」。
// 2026-10-29 再从 407,000 抬到 409,000：设置弹窗变宽 + 弹窗四档生效。
// 抬之前的真实原因是注释——四档失效与「控件贴右」都得把 why 写在规则旁（否则下一个人
// 会把档位挪回 .modal-content 前面、或把 margin-left:auto 又收进媒体查询里），
// 这里没有可下沉的纯逻辑（全是级联与盒模型），内联样式也是收回而非新增。
const INDEX_BUDGET = 409_000;

function bytes(name) {
  return fs.statSync(path.join(ROOT, name)).size;
}

describe('体积预算', () => {
  test('index.html 不超过预算', () => {
    const size = bytes('index.html');
    assert.ok(
      size <= INDEX_BUDGET,
      `index.html 已 ${size} 字节，超出预算 ${INDEX_BUDGET}。` +
        `先把纯逻辑下沉 logic.js，再合并重复结构与内联样式；` +
        `确实需要时在同一 commit 抬高 INDEX_BUDGET 并写明原因。`
    );
  });
});
