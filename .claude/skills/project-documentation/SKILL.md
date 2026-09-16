---
name: project-documentation
description: Orchestrate FocusFlow documentation by detecting discussion, planning, creation, modification, or review goals; resolving NTUB System Manual context and current repository evidence; and delegating UML work to ooad-uml-diagramming. Use for chapter planning or completion, document review, diagram concerns, and deciding what documentation work should happen next.
---

# Project Documentation Orchestrator

## Scope

Act as the thin, user-facing coordinator for FocusFlow documentation. This MVP prioritizes the NTUB object-oriented System Manual. Own goal detection, document context, evidence discovery, planning, specialist routing, integration, and gap reporting.

Do not redefine OOAD/UML rules or split this MVP into more skills. `ooad-uml-diagramming` owns diagram selection, drawing conventions, traceability, pre-draw checks, review, and artifact-chain rules.

## Modes

Infer and preserve the user's mode:

- **Discuss** — 「先討論」「這樣合理嗎」：explain options; do not edit.
- **Plan** — 「怎麼做」「從哪開始」「先盤點」：inspect and plan; do not make broad edits.
- **Create** — 「幫我製作」「完成第六章」：discover first, then create only requested artifacts.
- **Modify** — 「修改這章」「修正這張圖」：verify the artifact and evidence before editing.
- **Review** — 「這張圖怪怪的」「幫我審查」：diagnose; do not silently turn review into implementation.

For explicit Create or Modify requests, gather available repository and specification evidence before asking questions. Ask only when missing information materially affects correctness or would force a consequential assumption.

## Workflow

### Step 1 — Understand goal

Resolve the deliverable or chapter, mode, UML/non-UML scope, acceptance boundary, and allowed mutations. Infer inspectable context instead of asking the user to repeat it.

### Step 2 — Resolve document context and source of truth

For the NTUB manual, read as applicable:

- `AGENTS.md`, `CLAUDE.md`, and relevant repo rules;
- official sources in `docs/00_Deliverables/System_Manual/source-documents/`;
- `.claude/skills/ooad-uml-diagramming/references/local/ntub-chapter-contract.md`;
- `.claude/skills/ooad-uml-diagramming/references/local/focusflow-conventions.md`.

Use current code, schemas, routes, tests, runtime evidence, and maintained current-state documents for implementation claims. If an official source conflicts with the normalized contract, follow the official source and report contract drift. For other document families, find their contract; do not apply NTUB rules automatically.

### Step 3 — Inspect current project and document state

Inspect the target chapter, relevant diagram sources, exported images, `圖表目錄.md`, related requirements/current-state documents, code, schemas, routes, tests, and current git diff as needed. Preserve user changes.

Classify artifacts as reusable after verification, needs correction, missing, or optional. Existing diagrams, old manuals, drafts, and meeting notes are inputs, not proof of current implementation.

### Step 4 — Plan work

State what the live contract requires, what can be reused, what must be corrected or created, what is optional, the evidence for each artifact, and any specialist or human-confirmation needs. Do not add artifacts merely to increase diagram count.

In Discuss or Plan mode, stop after useful discovery and planning unless the user expands the request. In Create or Modify mode, continue with authorized in-scope work.

### Step 5 — Delegate specialist work (Claude Code)

When UML selection, creation, modification, or review is needed:

1. Use `ooad-uml-diagramming` as the single source of truth.
2. Let its `SKILL.md` route to only the needed references, checklist, and template.
3. Provide the chapter, intent, evidence, existing paths, traceability IDs, and desired artifact.
4. Bring its draft, review result, and unresolved gaps back for integration.

Do not copy or restate its rules. If the specialist or a routed resource is unavailable, report the blocker instead of inventing a parallel standard.

### Step 6 — Validate result and report gaps

Before claiming completion:

- recheck the target chapter against the live contract;
- verify implementation claims against current evidence;
- require UML output to pass the specialist's routed pre-draw, review, and artifact-chain checks;
- when in scope, align chapter text, `.puml`, image, caption/number, body reference, and diagram index;
- separate verified facts, inferences, optional extensions, open issues, and unperformed manual/external validation.

Report changed files, validation performed, unresolved gaps, and draft versus human-accepted status. Generated diagrams and local checks do not prove formal school acceptance.

## E2E: Chapter 6 planning

Example:

```text
/project-documentation 我現在想開始整理系統手冊第六章。請先查看目前第六章內容、現有 UML 圖與專案現況，判斷哪些能沿用、哪些有問題、哪些缺少；接著規劃怎麼完成，需要製作或修改 UML 時使用 ooad-uml-diagramming。
```

Expected behavior:

1. Select Plan mode and inspect the chapter, diagrams, index, live contract, conventions, and relevant implementation.
2. From the live contract, identify 6-1 as sequence **or** communication diagram, 6-2 design class diagram as required, and design object diagram as an extension.
3. Do not treat old diagrams as current-state evidence.
4. Return a reuse/problem/missing inventory and ordered plan before broad edits.
5. Route UML selection, creation, modification, and review to `ooad-uml-diagramming`.

These are E2E assertions, not duplicate governing rules. Re-read the live contract and specialist during execution.
