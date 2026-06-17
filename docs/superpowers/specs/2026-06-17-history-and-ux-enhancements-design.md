# 历史净值与交互优化设计

## 目标

在现有单文件资产管理 SPA 中增量添加：(1) 历史净值堆叠柱状图，(2) 资产排序，(3) 暗色模式，(4) 数据统计卡片。

## 数据模型

### AppState 扩展

于 `AppState` 新增 `snapshots[]`：

```typescript
interface Snapshot {
  id: string;
  date: string;         // ISO datetime
  note: string;         // 可选备注
  totalCNY: number;     // 快照时总净值
  currencyRates: { CNY: 1, HKD: number, USD: number }; // 当时汇率
  assets: Asset[];      // 全量资产拷贝
}
```

设计决策：
- 存全量副本，确保历史数据不受后续修改影响
- 记录当时汇率，历史净值换算更准确
- 不存分类副本，分类维度用于图表时按当时标签分组

### Snapshot CRUD

- **创建**：点击「记录快照」→ 弹窗可选备注（非必填）→ 保存当前资产全量 + 汇率
- **删除**：快照列表删除按钮 + 确认
- **查看**：点击快照项弹出详情 modal，显示当时资产清单
- 无「编辑」— 快照不可修改，保证历史完整性

## 功能设计

### 1. 历史净值堆叠柱状图

新增 tab「历史净值」（位于旭日图之后）。

**布局：**
- 顶部：标题 + 「记录快照」按钮 + 分类维度选择器（复用旭日图的选项）
- 中间：ECharts 堆叠柱状图（新实例，变量名 `historyChart`）
- 底部：快照列表（按日期倒序，每项显示日期/备注/总净值/删除按钮）

**图表行为：**
- X 轴：快照日期（升序）
- Y 轴：折合 CNY 总净值
- 每根柱子按所选分类的标签堆叠
- 无快照 / 仅 1 条快照时显示引导提示
- tooltip 悬浮显示各分类数值
- 颜色系统复用现有 CATEGORY_COLORS / categoryPalette

**堆叠逻辑：**
```
按所选分类 cat:
  for 每个快照:
    for 每个标签 in cat.tags:
      sum = 快照资产中 tags[cat.id] == 该标签 的 toCNY 总和
      series.push({ 分类, sum })
```

### 2. 资产排序

资产列表表头点击排序：
- 表头：名称↑↓ / 金额↑↓ / 货币↑↓
- 箭头指示当前排序列和方向
- 默认：按创建顺序（数组索引，新资产在末尾）

排序状态变量：
```typescript
let sortBy: 'name' | 'amount' | 'currency' = 'name';
let sortDir: 'asc' | 'desc' = 'asc';
```

排序在 `renderAssets()` 中 `state.assets` 渲染前执行。

### 3. 暗色模式

**CSS：**
```css
:root { --bg, --fg, --card, --border 等 }
:root.dark { --bg: #1a1712; --fg: #f7f5f0; --card: #302a1f; --border: #473f2b; ... }
```

**切换逻辑：**
- header 右侧新增 ☀/☾ 按钮
- 点击切换 `document.documentElement.classList.toggle('dark')`
- 偏好存 localStorage key `dark-mode`
- 页面加载时读取 preference
- body 背景和字体颜色用 CSS 变量自动适配
- 所有 card / input / tag-pill / modal 均用 CSS 变量

### 4. 数据统计卡片

资产列表上方 4 张卡片横向排列（响应式：小屏折行）：

| 卡片 | 内容 |
|---|---|
| 📦 资产总数 | `state.assets.length` |
| 💰 总净值 | `formatCNY(total)` |
| 🏷️ 分类覆盖 | 有标签的独立分类数 |
| 💱 货币分布 | 分布字符串如 "CNY ¥100万 · HKD $5万 · USD $1万" |

## 影响范围

仅修改 `index.html`：
- HTML：新增 tab、快照 modal、排序指示器、暗色按钮、统计卡片
- CSS：暗色变量、统计卡片样式、排序箭头
- JS：~150-200 行新增代码

不涉及外部依赖变更。ECharts 已包含堆叠柱状图支持。

## 实施顺序

1. 数据模型 + 快照 CRUD
2. 历史净值 tab 和堆叠柱状图
3. 资产排序
4. 暗色模式
5. 统计卡片
