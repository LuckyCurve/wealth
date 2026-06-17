# 历史净值月度改造设计

## 概述

将历史净值 TAB 从"用户可任意高频记录快照"改为"以月为单位记录"，减少记录频次，让用户关注大趋势而非每日波动。

## 数据模型变更

### 旧模型

```js
snapshot: {
  id: string,             // 'id_xxx'
  date: string,           // ISO '2026-06-17T12:34:56.789Z'
  note: string,
  totalCNY: number,
  currencyRates: object,
  assets: Asset[]
}
```

### 新模型

```js
snapshot: {
  month: string,          // '2026-06' (YYYY-MM)
  note: string,
  totalCNY: number,
  currencyRates: object,
  assets: Asset[],
  updatedAt: string       // ISO timestamp, 记录最后更新时刻
}
```

- `month` 为主键，同月只有一条记录
- 去掉 `id` 字段，由 `month` 替代唯一标识
- 增加 `updatedAt` 用于内部记录（但不对外展示精确时间）

## 交互流程

### TAB 顶部区域

根据当前月份是否存在记录分为两种状态：

**状态 A — 本月无记录：**

```
[📸 记录本月数据]    ← 金色主按钮
```

点击按钮 → 弹出备注弹窗 → 用户填写备注（可选）→ 确认 → 创建当月快照 → 切换为状态 B

**状态 B — 本月已记录：**

```
📅 2026年6月 已记录 ✓
页面顶部显示提示条："本月数据已记录，下月再来看看吧"
```

提示条下方有一个不显眼的文字链接：「覆盖更新」，点击后弹确认 → 确认后覆盖当月数据。

### 无弹窗拦截

- 状态 B 的提示直接展示在 UI 上，用户一进入 TAB 即可看到
- 不弹出模态框来阻止用户操作，把知情权和控制权交给用户

## 快照列表展示

按月份倒序排列（最近在前）：

```
┌──────────────────────────────────────┐
│  2026年6月  ·  ¥12.35万              │
│  备注：工资到账后                     │
│  [查看详情]                    [删除] │
├──────────────────────────────────────┤
│  2026年5月  ·  ¥11.80万              │
│  备注：无                             │
│  [查看详情]                    [删除] │
└──────────────────────────────────────┘
```

- 只显示月份、总净值、备注
- "查看详情" 点击弹出当前快照的资产明细（与现有 `viewSnapshot` 逻辑一致）

## 图表改动

### X 轴

从：

```
6月17日  6月18日  6月19日  ...
```

改为：

```
2026-04  2026-05  2026-06  ...
```

使用 `new Date(s.month + '-01').toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })` 生成标签。

### 堆叠柱状图不变

- 分类维度下拉选择器保持不变
- 堆叠柱状图的系列逻辑不变
- 数据源直接使用 snapshot 的 `assets` + `currencyRates`

### 空状态提示更新

从 "至少需要 2 次快照才能显示趋势" 改为 "至少需要 2 个月的数据才能显示趋势"。

## 数据迁移

`loadState()` 中检测旧数据格式并自动迁移：

```js
// 检测旧格式：snapshots[0] 有 'id' 字段
// 按 YYYY-MM 分组
// 同月多条保留最后一条（按日期排序取末）
// 转换为新格式：{ month, note, totalCNY, currencyRates, assets, updatedAt }
// 覆盖 state.snapshots
```

迁移逻辑只执行一次，执行后 snaphosts 写回 localStorage。

## 函数变更清单

| 函数 | 变更 |
|---|---|
| `takeSnapshot()` | 获取当前月份，检查是否存在 → 区分新增/覆盖流程 |
| `confirmSnapshot()` | 接受 `overwrite` 参数；写入 `month` + `updatedAt` |
| `deleteSnapshot(id)` | 改为接收 `month` |
| `viewSnapshot(id)` | 改为接收 `month` |
| `renderHistoryTab()` | 按月展示，日期显示改为月份 |
| `renderHistoryChart()` | X 轴改为月份标签 |
| `loadState()` | 增加旧数据迁移逻辑 |
| 新增 `getCurrentMonth()` | 返回 `new Date().toISOString().slice(0, 7)` |

## 不做的事

- 不改资产/分类/旭日图等其余 TAB
- 不改数据导出格式（JSON 中 snapshots 结构变了但导出/导入依然能用）
- 不增加后端或同步逻辑
- 不增加任何额外的图表类型
