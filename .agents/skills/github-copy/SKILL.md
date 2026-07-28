---
name: github-copy
description: Generate concise, directly pasteable Traditional Chinese Summary and Description text for FocusFlow commits, GitHub Desktop, VS Code commit dialogs, pushes, uploads, or pull requests. Use when Codex is asked to draft commit messages or submission copy from the current repository changes.
---

# GitHub Copy

## Workflow

1. Inspect the current repository evidence before writing:
   - Run `git status --short`.
   - Review `git diff --stat`, `git diff --name-status`, and the relevant diff.
   - Include untracked files when they belong to the requested change.
2. Separate the changes into the smallest useful groups:
   - Feature or behavior changes.
   - Fixes and compatibility changes.
   - Documentation, API contracts, schemas, configuration, or indexes.
   - Tests, lint, build, smoke checks, or other verification actually completed.
3. Draft one Traditional Chinese Summary and a 2–4 line Traditional Chinese Description.
4. Keep unrelated dirty-worktree changes out of the copy. If the intended commit scope is ambiguous, state the boundary or ask the user which files will be committed.

## Output Rules

- Write `Summary` in Traditional Chinese, exactly one line.
- Start Summary with a concrete action such as「新增」「修正」「同步」「更新」「完成」「支援」「整合」or「對齊」.
- Keep Summary concise and focused on the primary outcome. Preserve necessary product names, paths, API names, and technical identifiers in English.
- Write `Description` in Traditional Chinese, using 2–4 short lines.
- Put one coherent change group on each Description line.
- Mention tests or verification only when they were actually executed and passed.
- Describe renames, migrations, contract changes, or source synchronization when they materially affect review.
- Do not add `feat:`, `fix:`, `docs:`, `chore:`, or other conventional-commit prefixes unless the user requests them.
- Do not claim deployment, production readiness, test success, or completion beyond the inspected evidence.
- Default to commit-sized copy. Expand into a PR body only when explicitly requested.

## FocusFlow Priorities

- For backend or API work, name the user-visible behavior first, then important contract or security changes.
- For frontend work, name the affected flow or page and the resulting behavior.
- For AI Pipeline or RAG work, distinguish processing, retrieval, quality, recovery, and cost changes.
- For documentation-only work, name the synchronized source and the updated document set or index.
- When a change spans code, documentation, and tests, use the Description lines in that order.
- Keep pre-existing failures separate from verification performed for the current change.

## Response Format

Use this exact structure:

```text
Summary
<繁體中文單行摘要>

Description
<變更重點一>
<變更重點二>
<選填：變更重點三或實際驗證結果>
```

## Examples

### Notion meeting-note synchronization

```text
Summary
同步 Notion 會議紀錄與索引

Description
依 Notion 編號與標題對齊 15 份組內會議紀錄，補上缺失的 Codex 使用報告。
新增教授會議紀錄並整理專案進度、成本與競賽決議。
更新 meeting-notes 索引與各紀錄的 Notion 來源連結。
```

### Backend feature with verification

```text
Summary
完成角色登入、站內通知與私有頭貼

Description
防止跨身分登入並強化註冊錯誤處理。
加入通知查詢、已讀、管理員公告與影片完成通知。
加入私有頭貼上傳與讀取，並補齊相關整合測試。
```

## Defaults

- If the user only asks for commit copy, return the short format immediately after inspecting the changes.
- If the user provides an intended scope, use it to filter the working-tree evidence.
- If the user asks only for wording, do not stage, commit, push, or create a pull request.
