# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA。无构建工具、无测试、无后端。直接打开 `index.html` 即可使用。

## 项目结构

```
index.html   # 全部 HTML/CSS/JS (~1230行)
AGENTS.md
```

## 技术栈

| 技术 | 用途 |
|---|---|
| Tailwind CSS (CDN) + 自定义 CSS | 暖色调古纸质主题 + 暗色模式 |
| Apache ECharts 5 (CDN) | 旭日图 (sunburst) + 堆叠柱状图 (历史净值) |
| @fawazahmed0/currency-api (CDN) | 汇率 (`1 CNY = ? HKD/USD`) |
| Noto Serif SC / IBM Plex Mono (Google Fonts) | 标题 / 正文+数字 |

## 核心数据模型 (localStorage key: `wealth-manager-data`)

```typescript
interface AppState {
  categories: Category[];  // [{ id, name, builtin, tags[] }]
  assets: Asset[];         // [{ id, name, amount, currency, tags: { catId: tagVal } }]
  snapshots: Snapshot[];   // [{ id, date, assets: Asset[] }]  — 月度快照
  rates: { CNY: 1, HKD: number, USD: number, fetchedAt: string | null };
}
```

**内置分类 `currency`**: `{ id:'currency', builtin:true, tags:['CNY','HKD','USD'] }` — 首次加载自动创建，不可编辑/删除。资产的 `tags.currency` 自动同步 `currency` 字段。

## 关键发现

- **所有代码在单文件中** — 修改时注意保持 HTML → CSS → JS 结构
- **标签关联清理** — 删除分类/标签或编辑分类标签列表时，必须同步清理 `assets[].tags` 中的无效引用
- **汇率 API 需取倒数** — API 返回 `1 CNY = X foreign`，取 `1 / cny.hkd` 得 `1 HKD = ? CNY`
- **ECharts 全局单例** — `chart` 变量持有旭日图实例，`histChart` 持有柱状图实例，均用 `setOption(data, true)` 更新
- **颜色系统** — CSS 变量 (`--bg`, `--fg`, `--muted`, `--accent` 等) + `CATEGORY_COLORS` (10 色数组) + 标签药丸在同分类内用 HSL 深浅色区分
- **资产表单验证** — 非 `currency` 分类在下拉选择器中均 `required`
- **美元/港币货币符号** — 代码中用 `HKD $` / `USD $` 区分
- **月度快照** — 同月仅保留一条记录，快照详情的标签颜色与资产管理列表保持一致
- **暗色模式** — 通过 `document.documentElement.classList.toggle('dark')` 切换 CSS 变量
- **旭日图只显示名称** — 数值和百分比在 tooltip 中，标签只展示分类/标签名称

## 开发

无构建步骤。修改后直接刷新浏览器即可生效。

## Git 提交风格

Conventional Commits，中文描述：`feat:` / `fix:` / `refactor:` / `docs:`
