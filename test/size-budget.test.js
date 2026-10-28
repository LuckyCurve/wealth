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

// index.html 当前 389,759 字节（2026-10-28，资产页门槛改成抄写闸后）。
// 2026-10-27 从 380,000 抬到 390,000：多语言给每个静态文案节点加了 data-i18n 标记
// （属性本身约 4KB），文案与英文词条已全部下沉 logic.js（那里没有预算，因为它是可单测的纯逻辑）。
// 视图层没有可合并的重复结构：再抬之前先确认真的无处可沉。
const INDEX_BUDGET = 390_000;

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
