Generate short GitHub commit copy for this repository.

## Rules

- Write `Summary` in English, exactly one line.
- Write `Description` in Traditional Chinese, 2 to 4 short lines.
- Focus on what changed first; add why only when it improves clarity.
- Do not add `feat:`, `fix:`, or `chore:` prefixes unless the user asks.
- Do not expand into long PR-body sections.
- Keep the output directly pasteable into GitHub Desktop or VS Code commit fields.

## Output Format

```
Summary
<one line in English>

Description
<2 to 4 short lines in Traditional Chinese>
```

Look at the current git diff and staged changes to determine what changed, then produce the output immediately.
