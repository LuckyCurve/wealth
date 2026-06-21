# 预期年化收益率区间化 — 设计文档

## 概述

将收益测算中 `expectedRate` 从单值改为区间（min/max），并在资产列表中直观展示填写状态，收益测算 Tab 新增最低/最高全局切换。

涉及变更：`index.html` 中约 6 处独立改动（数据模型、表单、资产列表、收益测算、快照、resize 监听）。

---

## 数据模型变更

### Asset 字段

```
// 旧
{ expectedRate: number }

// 新
{ expectedRateMin: number,   // 最低年化收益率 (%)
  expectedRateMax: number }  // 最高年化收益率 (%)
```

- 默认值均为 `0`（表示未设置）
- 未填写时 `min = max = 0`
- 填写单值时 `min = max = 值`
- 填写区间时 `min < max`
- 验证约束：`0 <= min <= max`

### 迁移（`loadState`）

```js
state.assets.forEach(a => {
  if (a.expectedRate != null) {
    a.expectedRateMin = a.expectedRate;
    a.expectedRateMax = a.expectedRate;
  }
  if (a.expectedRateMin == null) a.expectedRateMin = 0;
  if (a.expectedRateMax == null) a.expectedRateMax = 0;
});
```

### 快照兼容

旧快照 asset 只有 `expectedRate`，读取时：

```js
const rateMin = a.expectedRateMin ?? a.expectedRate ?? 0;
const rateMax = a.expectedRateMax ?? a.expectedRate ?? 0;
```

### 内置分类 `currency` 不受影响

`currency` 分类的资产（现金类）预期利率通常为 0 或极低，无特殊处理。

---

## 表单编辑

### 资产编辑弹窗

原单输入框改为并排双输入框：

```
预期年化收益率 (%)
[最低 ____]  —  [最高 ____]
```

- 两个 `<input type="number" step="0.1" min="0">`
- 中间用 `—` 分隔
- 填写单个输入框时，未填的一方自动补为相同值（如只填最低 3，最高自动 3）
- 验证：`min <= max`，否则提示「最低不能高于最高」
- 编辑回填：`min = expectedRateMin, max = expectedRateMax`
- `value` 为 0 时空显示（placeholder = "0"）

### saveAsset 调整

```js
const rateMin = parseFloat(document.getElementById('asset-rate-min').value) || 0;
const rateMax = parseFloat(document.getElementById('asset-rate-max').value) || 0;
// 保存时 auto-fill: 只填了一个则同步
asset.expectedRateMin = rateMin;
asset.expectedRateMax = rateMax || rateMin;
```

---

## 资产列表

### 新增「预期年化」列

```
┌──────┬────────────┬────────┬──────────┬──────────┬────────┐
│ 名称 │ 金额(CNY)  │ 货币   │ 预期年化 │ 标签     │ 操作   │
├──────┼────────────┼────────┼──────────┼──────────┼────────┤
│ 茅台 │ ¥20,000    │ CNY    │ 3-15%   │ 白酒     │ […][…] │
│ 存款 │ ¥50,000    │ CNY    │ 2%      │ 储蓄     │ […][…] │
│ 现金 │ ¥50,000    │ CNY    │ 未设置  │ CNY      │ […][…] │
└──────┴────────────┴────────┴──────────┴──────────┴────────┘
```

- 在「货币」列之后、「标签」列之前插入
- `min > 0 && min == max` → `"X%"`
- `min > 0 && min < max` → `"X-Y%"`
- `min == 0 && max == 0` → `"未设置"`（灰色文字）
- `min == 0 && max > 0` → `"0-Y%"`（罕见，但逻辑正确）

---

## 收益测算 Tab — 全局模式切换

### 切换开关

在汇总卡片上方新增：

```
[使用最低 ▾]   ← 按钮，点击切换
```

- 当前模式高亮，点击切换至另一种
- 两种状态：`"使用最低"` / `"使用最高"`
- 模式状态变量：`let incomeMode = 'min'`

### 切换影响范围

- 汇总卡片（年/月/日收益）→ 全部使用 `mode` 对应的 rate 重算
- 加权平均利率 → 使用 `mode` 对应的 rate 重算
- 明细表格「年收益」「月收益」列 → 用 `mode` 对应的 rate 重算
- 旭日图 → 用 `mode` 对应的 rate 重新构建数据
- 模式变更时调用 `renderIncomeTab()` 整体刷新

### 不随模式变化的内容

- 表格中「年利率」列始终显示区间 `"3-5%"`
- 表格排序逻辑不变（按当前 mode 的月收益降序）

### 核心计算调整

```js
function getAssetRate(a, mode) {
  const min = a.expectedRateMin ?? a.expectedRate ?? 0;
  const max = a.expectedRateMax ?? a.expectedRate ?? 0;
  return mode === 'min' ? min : max;
}

function calcAssetIncome(a, mode) {
  const rate = getAssetRate(a, mode);
  const cny = toCNY(a.amount, a.currency);
  const annual = cny * rate / 100;
  return { cny, annual, monthly: annual / 12, daily: annual / 365 };
}
```

- 汇总卡片的 `Σ` 仅统计 `rate > 0` 的资产（依当前 mode）
- 加权平均同理

---

## 快照详情

快照详情弹窗增加「预期年化」列：

- 新快照：直接读取 `expectedRateMin / expectedRateMax`
- 旧快照：回退读取 `expectedRate`，显示为单值 `"X%"`
- 格式规则与资产列表一致

---

## 附带修复

- **resize 监听**：补上 `if (incomeChart) incomeChart.resize();`
- **step 修复**：表单 `step` 从 `1` 改为 `0.1`（原设计文档意图）

---

## 无侵入原则

- 不修改现有 Tab 逻辑
- 不影响导入/导出功能（新字段自动序列化）
- 不影响汇率获取
- 不涉及 ECharts 实例新增（复用现有 `incomeChart`）
