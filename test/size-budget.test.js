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
  // <head> 的首帧引导（开屏两态 + 暗色）与 Tailwind CDN 的主题扩展：从 index.html 拆出的
  // 两段引导/配置脚本。它们只在首帧跑一次，长大了就该问「是不是又往引导里塞了页面逻辑」。
  'boot.js': 3_000,
  'tailwind-config.js': 2_500,
  // 年化换算 Tab 的章节头与输入卡骨架（净值换算器独立成页，不挂在资产下）
  'index.html': 84_000,
  // 年化换算的输入行与分段表（两列网格 + 窄屏两行式）落在纯 CSS，按约定同 commit 抬上限。
  // 页头改为自有 flex 布局（不再依赖 Tailwind 工具类），CDN 拉不到时也不会竖排；
  // 同一 commit 再抬 2KB 收下这段布局与窄屏规则。
  // 打印形态：隐藏操作件、明细默认展开、去掉空出来的操作列、标签不截断、分页避断；
  // 同一 commit 再抬 3KB 收下这段纸面规则。
  // 结构类收口：页头/内容栏/表格/表单栅格等骨架从 Tailwind 工具类搬进自有 CSS，
  // 同一 commit 再抬 3KB 收下这批语义类。
  // 月份图重做：发丝线网格、四层状态（空/染墨/今天/选中）与窄屏规则，
  // 同一 commit 再抬 2KB 收下这批日历规则。
  'styles.css': 122_000,
  // 页内版块（报头/图表/读数条/月份图）与打印形态：从 styles.css 原样切出的连续两段，
  // 只做版块归类、不改规则；各有一道上限，免得以后再长回去。
  'styles-views.css': 28_000,
  'styles-print.css': 8_000,
  // 资产页解锁冷却：sessionStorage 时间戳的读写与「冷却内直接进门」接在门槛入口，
  // 纯判定已下沉 logic.js（gateCooldownActive），这里只剩接线。同 commit 抬 2KB。
  'app-core.js': 28_000,
  'app-assets.js': 74_000,
  // 分类与标签管理（资产/消费共用）：分类卡片、分类弹窗 CRUD、长按胶囊改名。
  // 从 app-assets.js 整段切出，两个文件各有一道上限。
  'app-categories.js': 26_000,
  'app-charts.js': 53_000,
  // 设置里的「解锁冷却」回显、改档与「立即锁定」入口（时间戳的写/清在 app-core.js）。
  // 同 commit 抬 1KB。
  'app-settings.js': 39_000,
  // 全站 UI 基元（气泡定位/弹窗开关/确认框/焦点陷阱/便条/分类色/金额输入）：
  // 从 app-settings.js 整段切出，两份各有一道上限。
  'app-ui.js': 14_000,
  // 月份图 + 当天的记录（点一格展开）；明细列表与录入在 app-expenses.js 里。
  'app-calendar.js': 12_000,
  'app-receipt.js': 10_000,
  // 净值 → 年化的独立换算器：列表与编辑两个视图（记录随存档导出）。纯计算在 logic.js，
  // 这里只剩两屏的渲染、flatpickr 接线与保存/删除。
  'app-yield.js': 14_000,
  // 对比差额「图形优先」在趋势行的「较平常」句前挂零轴小条，多出的模板串超了 42000；
  // 纯逻辑（cmpDeltaBarModel）已下沉 logic.js，剩下的只是这一行渲染，按约定同 commit 抬上限。
  'app-expenses.js': 42_400,
  // 数据校验（缺标签补齐，资产/消费共用）：从 app-expenses.js 整段切出。
  'app-tag-check.js': 9_000,
  // 消费「较平常」基线（窗口 / 逐标签 / 涨跌榜三个纯函数）下沉后越线：无构建步骤，
  // 纯逻辑不另开文件，按约定同 commit 抬上限并写明用途；年化换算的净值/年化两个口径也在这里。
  // 英文词条表（键 = 中文原文的纯数据）已拆到 logic-i18n-en.js，这一份只剩纯逻辑。
  'logic.js': 160_000,
  // 英文词条表：中文原文为键、纯数据，与 logic.js 同一套 UMD 壳（浏览器挂全局 / Node require）。
  // 它只会随新增文案长大，增长是线性的，故上限按「一张表」给足。
  'logic-i18n-en.js': 44_000,
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
