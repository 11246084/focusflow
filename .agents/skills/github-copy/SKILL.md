---
name: github-copy
description: 依 FocusFlow 指定變更撰寫可貼入 GitHub Desktop、VS Code 或 PR 的繁體中文提交文案。
---

# GitHub 提交文案

以使用者指定範圍的實際 diff 為準，含相關新增檔。先寫主要行為，再補影響審查的契約、遷移或驗證結果。只列實際通過的檢查。

預設交付下列可直接貼上的格式。Summary 用具體動詞開頭，Description 每行一項改動；保留技術識別字。使用者要求時才加 conventional-commit 前綴或展開 PR 內文。

```text
Summary
<單行繁體中文摘要>

Description
<2～4 行繁體中文說明>
```

只要求文案時，直接回覆文字。提交、推送及建立 PR 依另外授權執行。
