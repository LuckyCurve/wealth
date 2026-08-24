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
// 取某顶层函数的完整源码段（函数体不含顶格的 "}"，故非贪婪匹配到行首 "}" 即函数结尾）
const fnSource = (fn) => {
  const m = html.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
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

  test('syncBackupControls 是备份控件同步的唯一入口，四条路径都走它', () => {
    assert.match(html, /function syncBackupControls\(\)/);
    for (const fn of ['showImportExport', 'showSettings', 'setBackupFreq', 'exportData']) {
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
