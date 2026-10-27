# Domain docs

工程技能在探索代码库前，该按什么规则消费本仓库的领域文档。

## 探索前读这些

- 仓库根目录的 `GLOSSARY.md`
- 仓库根目录的 `GLOSSARY-MAP.md`（若存在）：它指向每个 context 各自的 `GLOSSARY.md`
- `docs/adr/`：读与本次改动区域相关的 ADR

这些文件不存在就**静默跳过**：不要提示缺失，也不要提议先建。
需要时由 `/domain-modeling` 懒创建（经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）。

## 本仓库的补充

- **`LESSONS.md` 不是 ADR。** 它记的是「这么干会怎么坏」的翻车证据与原话，是**改动前必读**的约束来源；
  ADR 记的是「难以回退的决定」。不要把 LESSONS 的条目当决策记录引用，也不要把 ADR 写成第二份 LESSONS。
- **`docs/code-standards.md` 是评审标准，不是领域文档**：`/code-review` 的 Standards 轴读它，其余技能不必读。
- 文档分三层：`AGENTS.md`（路标与流程）/ `LESSONS.md`（为什么）/ `docs/code-standards.md`（评审规则）。
  新增任何文档前先问：能不能写成测试？能就写测试，不写文档。

## 目录结构

单上下文（本仓库就是）：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── index.html, logic.js, test/, e2e/
```

## 使用 GLOSSARY 的词汇

产出里命名领域概念时（票标题、重构提案、假设、测试名），沿用 `GLOSSARY.md` 的定义，不要漂到它明确避开的同义词。

需要用的概念还不在 GLOSSARY 里，本身是个信号：要么在发明项目不用的词（重新考虑），要么是真缺口（记下来交给 `/domain-modeling`）。

## 撞上 ADR 时要说出来

产出与已有 ADR 冲突时显式标出，不要静默覆盖：

> _与 ADR-0007（……）冲突，但值得重开，因为……_
