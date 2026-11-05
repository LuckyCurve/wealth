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
