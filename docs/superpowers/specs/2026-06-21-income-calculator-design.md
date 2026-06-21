# 收益测算功能 — 设计文档

## 概述

在资产管理 SPA 中新增「收益测算」功能：根据每项资产的总金额和预期年化收益率，计算出年、月、日三个维度的预期收益。

## 数据模型变更

### Asset 新增字段

```
expectedRate: number  // 预期年化收益率（百分比），默认 0
```

示例：`expectedRate: 5` 表示年化 5%。

### 兼容性

- 存量数据加载时，`state.assets` 中缺少 `expectedRate` 的资产自动补 0
- 不涉及 localStorage 结构变更，只是对象新增字段

## 资产表单改动（`openAssetModal / saveAsset`）

在「金额/货币」字段下方新增：

```
预期年利率  [____]  %
type=number, min=0, step=0.1, 默认 0
placeholder="如：5"
```

- 非必填（默认为 0），不影响现有资产登记流程
- 编辑已有资产时回填已有值

## 新 Tab：收益测算

### Tab 位置

在「历史净值」之后，作为第 5 个 Tab：`资产管理 | 标签分类 | 资产分布 | 历史净值 | 收益测算`

### 页面结构

#### 1. 汇总卡片

三个大数字横向并排显示：

| 年收益 | 月收益 | 日收益 |
|---|---|---|
| ¥XX,XXX.XX | ¥X,XXX.XX | ¥XX.XX |

- 仅统计 `expectedRate > 0` 的资产
- 公式：年 = Σ(assetCNY × rate%)，月 = 年 / 12，日 = 年 / 365
- 底部小字：加权平均利率 · 总资产（CNY）
- `formatCNY()` 复用现有金额格式化（自动 万/亿）

#### 2. 资产明细表格

列：名称 | 金额 (CNY) | 预期年利率 | 年收益 | 月收益

- 展示**全部**资产（含 `expectedRate = 0`），方便用户查看哪些未设置
- 默认按月收益降序排列
- `expectedRate = 0` 的行：文字灰色 + "未设置" 标记
- 金额使用 `formatCNY()` 格式化（CNY 换算值）
- 行内利率以 `X.XX%` 格式展示

#### 3. 柱状图

使用已有 ECharts 实例（新实例化，不干扰 sunburst/history）。

- 图表类型：柱状图（垂直），X = 资产名称，Y = 月收益（CNY）
- 仅显示 `expectedRate > 0` 的资产
- 配色：从 `CATEGORY_PALETTE` 逐资产取色
- Tooltip：资产名称 + 月收益 + 年收益
- 如果可显示的资产 = 0，隐藏图表区域
- 新图表实例需加入全局 `resize` 事件监听：`window.addEventListener('resize', ...)`

#### 空状态

当所有资产的 `expectedRate` 均为 0 时：

- 汇总卡片隐藏
- 表格底部显示引导文字：「⚠ 尚未设置预期利率，请先在「资产管理」中编辑资产并填写预期年利率」
- 图表隐藏

## 无侵入原则

- 不修改现有 Tab 的任何逻辑
- 不影响导入/导出功能（`expectedRate` 作为 Asset 字段自动包含）
- 不影响月报快照功能（快照不涉及利率）
- `switchTab` 新增一个分支，渲染收益测算内容

## 计算公式

```
assetCNY = toCNY(asset.amount, asset.currency)   // 复用现有汇率换算
annual   = assetCNY * asset.expectedRate / 100
monthly  = annual / 12
daily    = annual / 365

totalAnnual  = Σ annual    (仅 rate > 0)
totalMonthly = totalAnnual / 12
totalDaily   = totalAnnual / 365

加权平均利率 = Σ(assetCNY × rate%) / Σ(assetCNY)   (仅 rate > 0)
```
