# 消费记账功能 — 设计规格

## 概述

在现有资产管理 SPA 中新增消费记账功能，与资产管理并列，拥有独立的分类体系、数据存储、旭日图分布和消费趋势。资产关注当下，消费追踪历史。

## 模式架构

在 Tab 栏上方增加模式切换器，资产 / 消费两个模式完全独立。

```
[ 资产管理 ] [ 消费记账 ]                    ← 模式切换

资产模式 Tab: 资产管理 | 标签分类 | 资产分布 | 历史净值 | 收益测算
消费模式 Tab: 消费记录 | 标签分类 | 消费分布 | 消费趋势
```

## 数据模型

### 消费记录 (Expense)

```typescript
interface Expense {
  id: string;                    // genId()
  date: string;                  // "2025-06-15" ISO date string
  amount: number;                // 金额（统一 CNY，消费不涉及多币种）
  note: string;                  // 备注（可选）
  tags: Record<string, string>;  // { catId: tagVal }
}
```

### 消费分类 (ExpenseCategory)

```typescript
interface ExpenseCategory {
  id: string;
  name: string;
  builtin: boolean;
  tags: string[];
}
```

### 内置消费分类

首次加载自动创建：

```
{ id: 'expense-type', name: '消费类别', builtin: true,
  tags: ['餐饮', '交通', '购物', '住房', '娱乐', '医疗', '教育', '其他'] }
```

### 扩展后的 AppState

```typescript
interface AppState {
  categories: Category[];                // 资产分类（不变）
  assets: Asset[];                       // 资产（不变）
  snapshots: Snapshot[];                 // 快照（不变）
  rates: Rates;                          // 汇率（不变）
  expenseCategories: ExpenseCategory[];  // 消费分类（新增）
  expenses: Expense[];                   // 消费记录（新增）
}
```

### 数据迁移

- `loadState()` 自动初始化 `expenseCategories`（内置消费分类）和 `expenses`（空数组）
- 不影响现有用户的资产数据
- localStorage key 不变：`wealth-manager-data`

## Tab 功能详情

### 1. 消费记录（对应资产管理）

- **列表展示**：日期、金额 (CNY)、备注、标签药丸
- **表头**：日期 | 金额 | 备注 | 标签 | 操作
- **排序**：按日期、按金额
- **CRUD 弹窗**：
  - 日期：`<input type="date">`
  - 金额：`<input type="number" min="0" step="0.01">`
  - 备注：文本输入（可选）
  - 标签选择器：为每个消费分类渲染下拉选择器（required）
- **顶部汇总**：总消费金额 (CNY)，格式 `¥X`
- **空状态提示** + 「导入示例数据」按钮
- **颜色**：标签药丸复用 `CATEGORY_COLORS` + HSL 深浅算法，函数名 `expenseCatColor()`

### 2. 标签分类（对应资产标签分类）

- 完全复刻资产侧的 `renderCategories()`
- 操作对象：`expenseCategories`
- 内置「消费类别」不可编辑/删除
- 支持：新增分类、编辑/删除自定义分类、添加/删除标签
- 标签变更时同步清理 `expenses[].tags` 中的无效引用

### 3. 消费分布 — 旭日图 + 月份选择器

与资产旭日图的核心差异：支持按时间范围筛选。

```
月份选择器:  [ 全部时间 ▼ ]  分类维度: [ 消费类别 ▼ ]
```

- **月份选择器选项**：全部时间 → 本月 → 上月 → 各历史月份（从 `expenses` 中提取）
- 选择「全部时间」：聚合所有消费记录
- 选择具体月份：只聚合 `expenses[].date` 在该月的记录
- 旭日图：外层 = 所选分类维度的标签，内层 = 消费条目名称（同标签下同名合并金额）
- tooltip：金额 + 占比百分比
- 空数据时显示占位提示

### 4. 消费趋势 — 堆叠柱状图

不需要手动快照，直接从消费日期按月聚合。

- 自动提取 `expenses` 中所有月份的 `YYYY-MM`
- 按选定分类维度分层堆叠
- 支持「金额 / 占比」模式切换按钮组
- 至少 1 条记录即可显示图表
- X 轴：月份标签（`YYYY年M月`），按时间升序
- Y 轴：金额（千分位）或百分比（0-100%）
- Legend 底部展示

## 代码组织

所有代码继续在单文件 `index.html` 中。

### 新增 JS 模块

- **状态管理**：`expenseCategories`, `expenses`, `expenseSortBy`, `expenseSortDir`
- **模式切换**：`switchMode('assets' | 'expenses')` 控制 Tab 和内容区域显示
- **消费渲染**：`renderExpenses()`, `renderExpenseCategories()`, `renderExpenseChart()`, `renderExpenseTrend()`
- **CRUD**：`openExpenseModal()`, `saveExpense()`, `deleteExpense()`
- **分类 CRUD**：`openExpenseCategoryModal()`, `saveExpenseCategory()`, `deleteExpenseCategory()`, `addExpenseTag()`, `removeExpenseTag()`
- **图表**：`expenseChart` (旭日图 echarts 实例), `expenseTrendChart` (柱状图 echarts 实例)
- **辅助**：`expenseCatColor(catId, tagName)` — 复用 `CATEGORY_COLORS` 数组 + HSL 算法
- **初始化**：`expenseLoadState()` 初始化消费数据

### HTML 新增内容

- 模式切换按钮组（Header 下方）
- 消费模式下的 4 个 Tab 按钮和内容区域
- 消费 Modal（消费记录表单 + 分类表单）
- 消费示例数据按钮（独立的，不影响资产侧）

### 初始化数据分离

- 资产的「导入示例数据」按钮只初始化 `categories` + `assets` + `snapshots`
- 消费的「导入示例数据」按钮只初始化 `expenseCategories` + `expenses`
- 两者互不干扰

## 颜色与风格

- 消费标签颜色与资产共用 `CATEGORY_COLORS` 10 色调色盘
- 同一分类下不同标签用 HSL 深浅区分（复用 `catColor` 算法）
- 旭日图使用 `CATEGORY_PALETTE` 10 色调色盘
- 暗色模式完全兼容（CSS 变量驱动）

## 导入 / 导出

- 导出：`state` 中包含 `expenseCategories` 和 `expenses`
- 导入：完整替换，包括消费数据
- 向后兼容：导入缺少 `expenseCategories`/`expenses` 的旧版数据时，自动初始化

## 非功能性

- 无构建工具、无测试、无后端
- 单文件 `index.html`，所有代码内嵌
- Tailwind CSS CDN + ECharts 5 CDN + Google Fonts
- 暗色模式 / 响应式基本支持
