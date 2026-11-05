/*
 * size-budget.test.js — 单文件的体积预算
 * --------------------------------------------------------------------------
 * 单文件是这套架构的代价：没有构建步骤、没有模块边界，index.html 只会一直变大，
 * 而一个 AI 一次能稳妥改动的文件是有限的。预算卡在这里，超了就红，让「再塞一点」
 * 变成一件需要先说明理由的事。
 *
 * 超了先做 AGENTS.md 的两步：逻辑下沉 logic.js → 合并重复结构/收回内联样式；
 * 确实需要时同一 commit 抬预算并写明为什么。只抬不改视为违规。
 *
 * 跑在 node --test 下，只读文件，不碰浏览器。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 预算跟现实走，不跟历史最高走：注释两轮瘦身后 394,539，留 1.5KB 给下一次小幅增改。
// 抬之前先做 AGENTS.md 的两步（下沉 / 合并），抬的时候在同一 commit 里写理由。
const INDEX_BUDGET = 396_000;

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
