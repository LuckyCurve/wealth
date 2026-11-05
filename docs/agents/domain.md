# Domain docs

工程技能在探索代码库前，该按什么规则消费本仓库的领域文档。

## 探索前读这些

- 仓库根目录的 `GLOSSARY.md`
- 仓库根目录的 `GLOSSARY-MAP.md`（若存在）：它指向每个 context 各自的 `GLOSSARY.md`
- `DECISIONS.md`：读与本次改动区域相关的决定与得失

这些文件不存在就**静默跳过**：不要提示缺失，也不要提议先建。
需要时由 `/domain-modeling` 懒创建（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）。

## 本仓库的补充

- **`DECISIONS.md` 与 `LESSONS.md` 分工**：前者记「我拍过什么板、得到与失去什么」（功能层），
  后者记「这么干会怎么坏」（翻车证据与原话）。不要把 LESSONS 的条目当决策引用，也不要把决策写成第二份 LESSONS。
- **`docs/code-standards.md` 是评审标准，不是领域文档**：`/code-review` 的 Standards 轴读它，其余技能不必读。
- 文档分三层：`AGENTS.md`（路标与流程）/ `LESSONS.md`（为什么）/ `docs/code-standards.md`（评审规则）。
  新增任何文档前先问：能不能写成测试？能就写测试，不写文档。

## 目录结构

单上下文（本仓库就是）：

```
/
├── GLOSSARY.md, DECISIONS.md, LESSONS.md
├── docs/code-standards.md
└── index.html, logic.js, test/, e2e/
```

## 使用 GLOSSARY 的词汇

产出里命名领域概念时（票标题、重构提案、假设、测试名），沿用 `GLOSSARY.md` 的定义，不要漂到它明确避开的同义词。

需要用的概念还不在 GLOSSARY 里，本身是个信号：要么在发明项目不用的词（重新考虑），要么是真缺口（记下来交给 `/domain-modeling`）。

## 撞上已拍过的板时要说出来

产出与 `DECISIONS.md` 里某条冲突时显式标出，不要静默覆盖：

> _与「压测是全局视图叠加」冲突，但值得重开，因为……_
