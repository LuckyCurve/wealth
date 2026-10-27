# Issue tracker：本地 Markdown

本仓库的 issue 与规格都以 markdown 文件存在 `.scratch/` 下，**不进 git**（见 `.gitignore`）。
单人项目，不需要公开 issue 列表；票做完即删，结论留在 commit 正文里。

## 约定

- 一个特性一个目录：`.scratch/<feature-slug>/`
- 规格：`.scratch/<feature-slug>/spec.md`
- 实现票：一票一文件 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 编号，绝不合并成单个大文件
- 每张票顶部一行 `Status:` 记状态（取值见 `triage-labels.md`）
- 对话与补记追加到文件末尾 `## Comments` 之下

## 技能说「发布到 issue tracker」时

在 `.scratch/<feature-slug>/` 下新建文件（目录不存在就创建）。

## 技能说「取那张票」时

直接读该路径的文件。用户通常会直接给路径或编号。

## 生命周期（本仓库特例）

- 票做完**删除文件**。GitHub issue 对应的动作是「关闭」（保留为可搜归档）；本地 markdown 是删除。
- 整个特性交付后，连同 `spec.md` 一起删掉 `.scratch/<feature-slug>/`
- 删除前确认结论已写进提交正文，否则下一个会话读不到「为什么」

## Wayfinding 操作（供 `/wayfinder`）

**地图**与**子票**都还是文件。

- **地图**：`.scratch/<effort>/map.md`（Destination / Notes / Decisions-so-far / Fog）
- **子票**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，正文是那个待解的问题；`Type:` 行记类型（`research`/`prototype`/`grilling`/`task`），`Status:` 行记 `claimed`/`resolved`
- **依赖**：顶部 `Blocked by: NN, NN`。所列文件全部 `resolved` 才算解锁
- **前沿**：扫 `.scratch/<effort>/issues/`，取「未关、无阻塞、未被认领」中编号最小的一张
- **认领**：动手前先写 `Status: claimed`
- **结题**：`## Answer` 之下写答案、置 `Status: resolved`，再把一条上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far
