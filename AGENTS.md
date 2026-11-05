# AGENTS.md — 资产管理 (Wealth Management)

单文件个人资产管理 SPA：无构建、无后端，直接打开 `index.html` 就能用。纯逻辑抽在 `logic.js`（UMD），
其余全在 `index.html`；这份文件只写「路标 + 不可协商的流程」，为什么这样做读 `LESSONS.md`。

## 目录

```
index.html   # 全部 HTML/CSS/JS（视图与接线）
logic.js     # 与 DOM 无关的纯函数，按域分组；页面经域名调用（text.esc）
test/        # node --test：logic / ui-wiring 契约 / e2e-server / size-budget / e2e-hygiene
e2e/         # Playwright：真实浏览器行为 + fixtures.js（CDN 替身 / 播种 / 入口）
docs/        # code-standards.md（评审规则）、adr/（难以回退的决定）、agents/（技能约定）
```

## 命令

```bash
node --test            # 单测（零依赖）
npx playwright test    # E2E（本地 6 worker，断网可跑）
gh run watch <run-id> --exit-status   # 等 CI，不要 sleep 轮询
```

## 开工前

1. 改哪块先读 [LESSONS.md](LESSONS.md) 的对应小节：每条都对应一次真实翻车或用户原话。
2. 提交前对照 [docs/code-standards.md](docs/code-standards.md)，文末那张表里的规则由测试把守——直接跑测试。

## 记账四份

- `GLOSSARY.md` — 共用的词，只收意思，不当 spec。
- `docs/adr/` — 难以回退的决定（这就是「我拍过的板」，不另建 DECISIONS.md）。
- `LESSONS.md` — 现象、根因、后来靠什么守住。
- `docs/code-standards.md` — 反复踩、又拦不住的那几条，才写成清单。

新增约定先问：**能写成测试吗？** 能就写测试；不能、且会改变决策，才写进 LESSONS。

## 不可协商

- **TDD**：先写失败测试 → 最小实现 → 重构。先改实现再补测试不算。
- **一个独立问题一个 commit**，`node --test` 全绿后提交；大改再跑一遍 E2E。提交后直接 push，不询问。
- **提交信息六项**（复现 / 改了什么 / 兄弟 / 跑过什么 / 没跑什么 / 破坏验证），没有的写「无」。
  不写运行记录视为没跑；「应该没问题」等于没跑。
- **单一来源**：同一逻辑/样式/结构出现 ≥2 次必须收敛；兄弟入口一次查完（改了哪些、哪些确认不用改，写进提交正文）。
- **体积预算**：`index.html` 有字节上限（`test/size-budget.test.js`）。超了先把纯逻辑下沉 `logic.js`、
  合并重复结构、把内联样式收回 `<style>`；确实要抬高，就在同一 commit 里改常量并写明为什么，只抬不改视为违规。
- **迁移唯一入口**：`migrateState()`（`loadState` 与 `importData` 共用）。存档/导入的任何字段都先过它的兜底再进渲染。
- **界面文案两条通道**：静态挂 `data-i18n`，动态走 `i18n.t('中文原文')`；账本内容不翻译。见 [ADR 0002](docs/adr/0002-interface-language-source-keys.md)。
- **进资产页是两段闸**（长按 + 抄箴言），门槛是给「顺手看一眼」定价，不是权限。见 [ADR 0003](docs/adr/0003-asset-entry-copy-gate.md)。
- **文档只写会改变决策的约束与为什么**：不写数值、步骤、UI 细节——那些由代码与测试承担。

## 测试分层

- 纯逻辑 → `test/logic.test.js`；页面接线/单一来源/旧入口 → `test/ui-wiring.test.js`（文本契约，含整段内联脚本的真解析）。
- 计算样式、像素、可访问名、真实点击 → `e2e/`。装置怎么用、有哪些坑，见 [LESSONS.md](LESSONS.md#测试与装置)。
- 失败先读 job 形状再翻日志：`gh api repos/{owner}/{repo}/actions/jobs/<id> --jq '{conclusion,runner_name,steps}'`。
  `runner_name` 为空 = 没分到机器（基础设施），与断言红是两条路。
