# AGENTS.md

```bash
node --test                            # 单测，零依赖
npx playwright test                    # E2E，断网可跑
gh run watch <run-id> --exit-status    # 等 CI，别 sleep 轮询
```

提交：中文主题（`feat:` / `fix:` / `refactor:` / `style:` / `docs:`），正文六项
（复现 / 改了什么 / 兄弟 / 跑过什么 / 没跑什么 / 破坏验证），没有的写「无」；
先红后绿；提交后直接 push，不询问。

账本：`DECISIONS.md`（拍过的板与得失）、`LESSONS.md`（踩过的坑）、`GLOSSARY.md`（词）、
`docs/code-standards.md`（评审规则）。

## 配色：一套语义 token，不写死色值

- **金（主强调）**：品牌、主按钮 `.btn-gold`、今天、焦点环。亮 `#8f6713`，暗 `#d9b25e`。
- **青蓝（次强调）**：选中/当前页签、日期范围、编辑态、链接与次级操作。亮 `#3d5a7a`，暗 `#9ab6d6`。
- **语义色**：成功 `--verdigris`、警示 `--warning`、危险·支出 `--down`。提示条与徽章纸面走中性 token，只让文字带语义。
- 每处只取一个角色；新颜色先加进 `:root` 与 `:root.dark`，再引用。打印形态在 `@media print` 统一回亮色档。
- 分类调色板（`CATEGORY_COLORS` / 图表）是另一套并列色，不算强调色。`e2e/theme.spec.js` 守着写死色值，白名单只减不增。
