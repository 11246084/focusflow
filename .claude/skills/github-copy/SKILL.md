---
name: github-copy
description: Generate short Traditional Chinese GitHub commit, upload, push, or PR Summary and Description text. Use when Claude needs concise GitHub Desktop or VS Code submission copy grounded in the current repository changes.
---

# Github Copy

## Overview

Use this skill to produce short GitHub submission copy for this repository. Keep the output directly pasteable into GitHub Desktop or VS Code commit fields.

## Usage

呼叫方式：在對話中輸入 `/github-copy`，Claude 會根據目前的修改內容自動產出 Summary 與 Description。

```
/github-copy
```

也可以附上說明，讓輸出更精準：

```
/github-copy 這次新增了 LINE 綁定 API 和修正 webhook GET handler
```

輸出範例：

```
Summary
新增 LINE 綁定 API 並修正 webhook GET handler

Description
新增 POST /api/v1/line/bind-token，讓前端可為學生發放 10 分鐘有效的綁定 token。
補上 GET /api/v1/line/webhook，通過 LINE Developers Console Verify 驗證。
```

## Output Rules

- Write `Summary` in Traditional Chinese, exactly one line.
- Start `Summary` with a concrete action such as「新增」「修正」「同步」「更新」「完成」「支援」「整合」or「對齊」.
- Preserve necessary product names, paths, API names, and technical identifiers in English.
- Write `Description` in Traditional Chinese, 2 to 4 short lines.
- Default to short-form output.
- Focus on what changed first; add why only when it improves clarity.

## Style Rules

- Keep the wording direct and readable.
- Do not expand into long PR-body sections unless the user explicitly asks.
- Do not add `feat:`, `fix:`, or `chore:` prefixes unless the user asks.
- Prefer wording that can be pasted without further editing.

## Response Format

Use this exact structure unless the user requests another format:

```text
Summary
<繁體中文單行摘要>

Description
<2 至 4 行繁體中文變更重點>
```

## Defaults

- If the user only asks for GitHub upload copy, return the short version immediately.
- If the user mentions GitHub Desktop or the VS Code commit dialog, optimize for copy-paste brevity.
- If the user asks for a PR body, expand only then.
