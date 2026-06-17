# 标签药丸同色系深浅方案

## 需求

资产列表中，同一分类下的不同标签目前颜色完全一样（例：货币分类的 CNY/HKD/USD 全是同一个土色调），无法区分。需要**同一分类内不同标签使用同一色系的不同深浅**，既可区分又视觉统一。

## 方案：HSL 动态生成（选定的方案 A）

### 改动范围

只改 JS 逻辑，不动 HTML 结构。

### 新增工具函数

- `hexToHsl(hex)` → `{ h, s, l }`
- `hslToHex(h, s, l)` → hex string

### 修改 `catColor(catId, tagName?)`

| 参数 | 行为 |
|---|---|
| `catColor(catId)` | 返回该分类的 base 色（原逻辑，兼容无需区分标签的场景） |
| `catColor(catId, tagName)` | 在该分类色系内，按标签在 `tags[]` 中的位置均匀分配深浅 |

### 色阶生成规则

- 提取 `CATEGORY_COLORS[i].bg` 的色相 (hue) 作为该分类色系
- 饱和度随深度递增：浅色 ~30% → 深色 ~55%
- 明度随深度递减：
  - `bg`: 92% → 72%（浅→深）
  - `border`: 82% → 55%
  - `fg`: 保持 ~45%（始终可读）

例如货币分类 3 个标签：
| 标签 | 明度 | 视觉效果 |
|---|---|---|
| CNY | 最浅 (L=92%) | 浅色调背景 |
| HKD | 中间 (L=82%) | 中等色调背景 |
| USD | 最深 (L=72%) | 较深色调背景 |

### 调用点更新

3 处需要传入 `tagName`:

1. `renderAssets()` L520 — 每个资产的标签药丸 `catColor(cat.id, tagVal)`
2. `renderCategories()` L546 — 分类管理页面每个标签 `catColor(cat.id, t)`
3. `viewSnapshot()` L973 — 快照详情 `catColor(catId, val)`

### 不变的部分

- `CATEGORY_COLORS` 数据结构不变
- `CATEGORY_PALETTE`（图表色板）不变
- 旭日图着色逻辑不变
- 分类本身（非标签）的颜色兜底不变
