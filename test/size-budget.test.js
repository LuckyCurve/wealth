/*
 * size-budget.test.js — 每个文件的体积预算
 * --------------------------------------------------------------------------
 * 没有构建步骤、没有模块边界，文件只会一直变大；一个 AI 一次能稳妥改动的文件是有限的。
 * 页面拆成 markup（index.html）/ 样式（styles.css）/ 纯逻辑（logic.js）/ 按界面区域拆的页面脚本之后，
 * 拆文件不再是超预算的逃生口：拆出来的每一份也各有一道上限。
 *
 * 超了先下沉 logic.js，再按界面区域拆脚本；确实需要时同 commit 抬预算并写明为什么。
 * 只抬不改视为违规。
 *
 * 跑在 node --test 下，只读文件，不碰浏览器。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 预算按文件卡：单份不再无限长大，也不再靠「拆出去」绕过预算——拆完照样各有一道上限。
// 再抬之前先问：能不能再拆一层（按界面区域拆脚本）或下沉到 logic.js。
const BUDGETS = {
  'index.html': 82_000,
  'styles.css': 110_000,
  'app-core.js': 26_000,
  'app-assets.js': 74_000,
  'app-charts.js': 53_000,
  'app-settings.js': 38_000,
  // 月份图 + 当天的记录（点一格展开）；明细列表与录入在 app-expenses.js 里。
  'app-calendar.js': 12_000,
  'app-receipt.js': 10_000,
  'app-expenses.js': 42_000,
  'logic.js': 145_000,
};

function bytes(name) {
  return fs.statSync(path.join(ROOT, name)).size;
}

describe('体积预算', () => {
  for (const [name, budget] of Object.entries(BUDGETS)) {
    test(`${name} 不超过预算`, () => {
      const size = bytes(name);
      assert.ok(
        size <= budget,
        `${name} 已 ${size} 字节，超出预算 ${budget}。` +
          `先把纯逻辑下沉 logic.js，再按界面区域拆脚本；` +
          `确实需要时在同一 commit 抬高 ${name} 的预算并写明原因。`
      );
    });
  }
});
