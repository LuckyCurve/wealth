/*
 * e2e-hygiene.test.js — E2E 用例的卫生契约
 * --------------------------------------------------------------------------
 * 这两条约定原先只活在 AGENTS.md 与注释里（「E2E 禁止 waitForTimeout」「不访问外网」），
 * 没有任何东西会变红——下一份 spec 照抄一个固定睡眠、或临时放行一次外网，也照样全绿。
 *
 * 固定睡眠是「不知道什么时候真的好了」的替代品：它让每个用例按最坏情况计时
 * （主题巡检这类全 Tab 遍历曾因此多吃数秒），而且 sleep 之后断言失败的原因
 * 会从「状态不对」变成「睡少了」，排查成本翻倍。同步的状态翻转用可见性断言，
 * 异步渲染用 expect.poll，固定定时器（便条退场、备份提示、看门狗）用 page.clock 快进。
 *
 * 跑在 node --test 下，只读文件，不碰浏览器。
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const E2E_DIR = path.join(__dirname, '..', 'e2e');
const NL = String.fromCharCode(10);

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
      const lines = stripComments(fs.readFileSync(path.join(E2E_DIR, name), 'utf8')).split(NL);
      lines.forEach((line, i) => {
        if (/\.waitForTimeout\s*\(/.test(line)) offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      });
    }

    assert.deepStrictEqual(
      offenders,
      [],
      `固定睡眠等渲染会把「状态不对」变成「睡少了」。同步翻转用可见性断言，异步渲染用 expect.poll：${NL}${offenders.join(NL)}`
    );
  });
});

/*
 * 第二条卫生契约：spec 里不得放行外网。
 * --------------------------------------------------------------------------
 * 曾经有一条用例为了拿「真的 flatpickr」，写了 route.continue() 放行 cdn.jsdelivr：
 * 每轮为它多花 3~4s，断网即红，而它要验的东西（日历被库挂到 body 下、不该被 inert）
 * 完全可以用本地那份同版本 dist 证明。替代物看不见的部分要承认，但**不能靠连外网来补**。
 */
describe('E2E 卫生：不放行外网', () => {
  test('e2e/ 下不出现 route.continue / unroute（外网替身只进不出）', () => {
    const files = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5, `应扫到 e2e/ 全部文件，实际 ${files.length} 个`);
    const offenders = [];
    for (const name of files) {
      const lines = stripComments(fs.readFileSync(path.join(E2E_DIR, name), 'utf8')).split(NL);
      lines.forEach((line, i) => {
        // .continue( / .unroute( 都是「把请求交还真实网络」（参数名 r / route / routeHandler 都见过）
        if (/\.\s*(?:continue|unroute)\s*\(/.test(line)) {
          offenders.push(`${name}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `E2E 不访问外网：需要真库就从 node_modules 读同一份 dist（见 modal-scroll 的 flatpickr）。${NL}${offenders.join(NL)}`
    );
  });
});
