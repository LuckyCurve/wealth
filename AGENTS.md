# AGENTS.md — 资产管理 (Wealth Management)

## 项目概述

单文件个人资产管理 SPA。用户在浏览器中登记资产、用自定义标签分类、通过旭日图可视化资产分布，支持实时汇率换算与 JSON 导入/导出。所有数据存储在浏览器 LocalStorage 中，无后端依赖。

**URL**: 直接打开 `index.html` 即可使用。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 结构 | HTML5 | 单文件，包含所有模板 |
| 样式 | Tailwind CSS (CDN) + 自定义 CSS | 暖色调古纸质主题 |
| 图表 | Apache ECharts 5 (CDN) | 旭日图 (sunburst) |
| 字体 | Noto Serif SC (标题), IBM Plex Mono (正文/数字) | Google Fonts CDN |
| 汇率 | @fawazahmed0/currency-api (CDN) | 获取 CNY 对 HKD/USD 实时汇率 |
| 存储 | `localStorage` | Key: `wealth-manager-data` |

## 项目结构

```
wealth-management/
├── index.html          # 唯一的应用文件（~550 行）
├── AGENTS.md           # 本文档
└── .git/
```

`index.html` 内部结构：
- `<style>` — 全局 CSS 变量、组件样式、动画关键帧
- `<header>` — 应用标题 + 汇率状态 + 导入/导出入口
- Tab 切换栏 — 资产 / 标签分类 / 旭日图
- 三个 `<section>` 对应三个 Tab
- 三个模态框 — 资产表单、分类表单、导入/导出
- `<script>` — 全部应用逻辑

## 核心数据模型

```typescript
// 全局状态 (localStorage key: 'wealth-manager-data')
interface AppState {
  categories: Category[];
  assets: Asset[];
  rates: ExchangeRates;
}

// 分类维度
interface Category {
  id: string;       // 如 'currency', 'id_xxx' (genId() 生成)
  name: string;     // 如 "货币类型", "资产类型"
  builtin: boolean; // 内置分类不可删除
  tags: string[];   // 该分类下的标签值，如 ["CNY","HKD","USD"]
}

// 资产
interface Asset {
  id: string;
  name: string;        // 如 "招商银行活期"
  amount: number;
  currency: "CNY" | "HKD" | "USD";
  tags: Record<string, string>;  // { categoryId: tagValue }
                                 // 例: { currency: "CNY", assetType: "现金" }
}

// 汇率
interface ExchangeRates {
  CNY: 1;      // 1 CNY = 1 CNY
  HKD: number; // 1 HKD = ? CNY (实时获取)
  USD: number; // 1 USD = ? CNY
  fetchedAt: string | null; // ISO 时间戳
}
```

**内置分类**: `{ id: 'currency', name: '货币类型', builtin: true, tags: ['CNY','HKD','USD'] }`  
该分类在首次加载时自动创建，不可编辑/删除。资产的 `currency` 字段会自动同步为 `tags.currency` 的值。

## 关键函数速查

### 页面入口
- `DOMContentLoaded` → `loadState()` → `fetchRates()` → `renderAll()`

### 状态管理
| 函数 | 作用 |
|---|---|
| `loadState()` | 从 localStorage 读取状态，确保 currency 分类存在 |
| `saveState()` | 写入 localStorage |

### 汇率
| 函数 | 作用 |
|---|---|
| `fetchRates()` | 调用 currency-api 获取 HKD/USD 对 CNY 汇率，失败时使用缓存 |
| `toCNY(amount, currency)` | 金额换算为 CNY |
| `formatCNY(val)` | 格式化 CNY 显示（万/亿自动缩写） |

### 渲染
| 函数 | 作用 |
|---|---|
| `renderAll()` | 渲染资产列表 + 分类列表 |
| `renderAssets()` | 渲染资产表格，显示标签 pill、计算总额 |
| `renderCategories()` | 渲染分类卡片，含标签列表 + 添加标签输入框 |

### 资产 CRUD
| 函数 | 作用 |
|---|---|
| `openAssetModal(editId?)` | 打开资产模态框，动态生成分类下拉选择器 |
| `saveAsset(e)` | 保存资产（新建/编辑），自动同步 currency 标签 |
| `editAsset(id)` | 编辑资产入口 |
| `deleteAsset(id)` | 确认后删除 |

### 分类 CRUD
| 函数 | 作用 |
|---|---|
| `openCategoryModal(editId?)` | 打开分类模态框 |
| `saveCategory(e)` | 保存分类，更新时同步清理失效标签的资产关联 |
| `editCategory(id)` | 编辑分类入口 |
| `deleteCategory(id)` | 删除分类并移除所有资产的对应标签 |
| `addTag(catId)` | 向分类添加新标签 |
| `removeTag(catId, tagName)` | 删除标签并清理资产引用（至少保留一个） |

### 图表
| 函数 | 作用 |
|---|---|
| `switchTab(tab)` | Tab 切换，切换到 chart 时调用 `populateChartSelect()` + `renderChart()` |
| `populateChartSelect()` | 填充分类选择下拉框 |
| `renderChart()` | 按选中分类聚合资产，渲染 ECharts 旭日图 |

### 导入/导出
| 函数 | 作用 |
|---|---|
| `showImportExport()` | 打开导入/导出模态框 |
| `exportData()` | 下载 JSON 文件（命名含日期） |
| `importData(e)` | 读取文件、合并到 state、覆盖保存 |

### 工具函数
| 函数 | 作用 |
|---|---|
| `genId()` | 生成唯一 ID (`id_` + 时间戳36进制 + 随机串) |
| `esc(str)` | HTML 转义 |
| `toast(msg, type)` | 右下角 toast 提示（success/error） |
| `closeModal(id)` | 关闭模态框 |
| `catColor(catId)` | 按分类索引返回配色方案 |

## 配色体系

暖色调古纸质主题，变量定义：
```css
:root {
  --bg: #faf8f2;      /* 页面背景（纸色） */
  --fg: #1a1712;      /* 主文字色（墨色） */
  --muted: #9a8b65;   /* 次要文字 */
  --accent: #c49a3c;  /* 金色强调 */
  --card: #ffffff;    /* 卡片背景 */
  --border: #e0d9c8;  /* 边框 */
}
```

分类标签 10 色调色板 (`CATEGORY_COLORS`): 陶土 / 鼠尾草绿 / 琥珀蜜 / 藕粉 / 矢车菊蓝 / 焦糖 / 青雾 / 淡紫 / 金麦 / 珊瑚

图表色板也独立维护一套 10 色，与标签色系呼应但用于 ECharts 渐变色。

## 开发注意事项

1. **单文件** — 所有 HTML/CSS/JS 都在 `index.html` 中。修改时注意不要破坏结构。

2. **状态兼容性** — `loadState()` 有容错逻辑：如果 localStorage 数据缺少 `currency` 分类则自动补上。修改数据模型时需考虑向前兼容。

3. **汇率 API** — 使用 `@fawazahmed0/currency-api` 的 `cny.json` 端点。API 返回 `1 CNY = X foreign`，代码中取倒数 `1 / cny.hkd` 得到 `1 HKD = ? CNY`。注意这是免费 API，可能不稳定，有缓存降级机制。

4. **标签关联清理** — 删除分类、移除标签、编辑分类标签列表时，都需要同步清理资产的 `tags` 字段，避免遗留无效引用。

5. **ECharts 实例管理** — `chart` 变量全局持有单例，切换 Tab 或数据变化时调用 `chart.setOption()` 更新而非销毁重建。

6. **内置分类保护** — `currency` 分类的 `builtin: true`，UI 不显示编辑/删除按钮，`deleteCategory()` 中也做了拦截。

7. **表单验证** — 资产表单的标签选择器 `required` 属性强制每个非 currency 分类都必须选择一个标签。

## Git 提交风格

提交使用 Conventional Commits（中文描述）：
- `feat:` — 新功能
- `fix:` — 修复
- 历史：`bd57221`（初始版本）、`ba720fd`（货币符号 + 标签色系）、`c84322c`（SVG favicon）

## 依赖

所有依赖通过 CDN 加载，无需构建工具：
- `tailwindcss.com` — Tailwind CSS
- `echarts@5` (jsdelivr) — ECharts
- `fonts.googleapis.com` — Noto Serif SC + IBM Plex Mono
- `@fawazahmed0/currency-api` (jsdelivr) — 汇率数据
