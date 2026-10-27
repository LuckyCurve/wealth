/*
 * e2e-hygiene.test.js — E2E 用例的卫生契约
 * --------------------------------------------------------------------------
 * 这条约定原先只活在 AGENTS.md 与两处注释里（「E2E 禁止 waitForTimeout」），
 * 没有任何东西会变红——下一份 spec 照抄一个固定睡眠也照样全绿。
 *
 * 固定睡眠是「不知道什么时候真的好了」的替代品：它让每个用例按最坏情况计时
 * （主题巡检这类全 Tab 遍历曾因此多吃数秒），而且 sleep 之后断言失败的原因
 * 会从「状态不对」变成「睡少了」，排查成本翻倍。同步的状态翻转用可见性断言，
 * 异步渲染用 expect.poll。
 *
 * 跑在 node --test 下，只读文件，不碰浏览器。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const E2E_DIR = path.join(__dirname, '..', 'e2e');

// 剥掉注释：解释这条规则的注释本身不算违规。
// 行注释用 (^|[^:\w]) 前缀规避 URL 里的 `//`（https://…）。
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w])\/\/.*$/gm, '$1');

const specs = fs
  .readdirSync(E2E_DIR)
  .filter((f) => f.endsWith('.spec.js'))
  .sort();

describe('E2E 卫生：不用固定睡眠等渲染', () => {
  test('e2e/*.spec.js 不出现 waitForTimeout', () => {
    // 目录读错/过滤写错会让本契约永久假绿，先钉住「确实扫到了东西」。
    assert.ok(specs.length >= 5, `应扫到全部 spec，实际 ${specs.length} 个：${specs.join(', ')}`);

    const offenders = [];
    for (const name of specs) {
      const lines = stripComments(fs.readFileSync(path.join(E2E_DIR, name), 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (/\.waitForTimeout\s*\(/.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      });
    }

    assert.deepStrictEqual(
      offenders,
      [],
      `固定睡眠等渲染会把「状态不对」变成「睡少了」。同步翻转用可见性断言，异步渲染用 expect.poll：\n${offenders.join('\n')}`
    );
  });
});
