# Triage 标签

技能用五个规范角色说话；本文件把角色映射到本仓库实际使用的字符串。

| 角色（规范名） | 本仓库取值 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 待评估 |
| `needs-info` | `needs-info` | 等报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 已说清，agent 可脱手实现 |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不做 |

## 在本仓库怎么落

追踪器是本地 markdown（见 `issue-tracker.md`），所以标签不是 platform label，而是票文件顶部的一行：

```
Status: ready-for-agent
```

分类角色（`bug` / `enhancement`）同理写 `Category:` 行。

## 现状

单人项目、无外部报告来源，`/triage` 目前没有输入，这套角色处于待命状态。
哪天开始收外部 bug / 需求再启用；`/tickets` 产出的票**已经**是 agent-ready，不要再丢给 `/triage`。
