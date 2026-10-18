# Phase 2-2 Limited Rollout Control Implementation

Status: offline implementation and validation only. No live rollout is authorized.

## Architecture

`hierarchicalRollout.service.js` owns deterministic policy and routing. `qa.service.js` supplies the authenticated user, course, authorized video scope, active Parent contract status, the existing query vector, and retrieval dependencies. The global Gate remains the highest-priority kill switch.

## Configuration

- `HIERARCHICAL_RETRIEVAL_ENABLED=false`
- `HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE=off|shadow|serve`
- `HIERARCHICAL_RETRIEVAL_ALLOWED_COURSE_IDS`
- `HIERARCHICAL_RETRIEVAL_ALLOWED_VIDEO_IDS`
- `HIERARCHICAL_RETRIEVAL_ALLOWED_USER_IDS`

Identifiers are comma-separated canonical 24-hex values. Whitespace and duplicates are normalized. Invalid mode or allowlist input fails closed without crashing QA.

## Eligibility and authorization boundary

Eligibility requires the global Gate, a non-off valid mode, valid allowlists, a compatible declared active Parent embedding contract, configured course/user matches when those lists are non-empty, and a non-empty intersection between authorized videos and rollout-supported videos. Configured IDs never add authorization.

Parent Vector Search receives the supported intersection as an additional video restriction, so the existing course-or-mounted-video bridge cannot select Parent documents outside the rollout scope.

## Shadow behavior

Shadow mode reuses the query vector already created by QA. The foreground Leaf result is retained unchanged. Parent Search, Child Expansion, and safe diagnostics execute separately; Hierarchical Context never reaches Answer Generation or Citation Assembly. Shadow errors are reduced to safe codes and cannot fail the foreground response.

The shadow path does not import or call UsageLog, Question, FAQ, or Clip write services. The normal QA request retains its existing business writes exactly once.

## Serve behavior

Eligible serve requests use the existing Hierarchical Retrieval orchestrator and Leaf fallback contract. Non-eligible requests remain Leaf-only. Fallback=false retains the existing safe 503 contract.

## Embedding contract check

Eligibility consumes the existing runtime compatibility status produced from centralized embedding constants and `QA_ACTIVE_PARENT_EMBEDDING_CONTRACT_JSON`. `not_declared` and `incompatible` fail closed. Query and Parent roles may use different canonical text while sharing the stable contract family.

## Diagnostics

The additive `runtime.hierarchicalRollout` object reports mode, eligibility, reason, authorization/support counts, shadow execution, Parent score summary, Child counts, latency, and safe error code. It excludes user identity, question text, embeddings, transcript, prompts, credentials, and raw Child IDs.

## Safety

- Shared Gate default remains false.
- Rollout mode default remains off.
- No `.env`, Atlas, Parent/Leaf data, index, or production traffic change is part of this implementation.
- Empty video authorization or empty supported intersection fails closed.

## Offline routing matrix

| Gate | Mode | Course | User | Video intersection | Result |
|---|---|---|---|---|---|
| false | serve | allowed | allowed | yes | Leaf-only |
| true | off | allowed | allowed | yes | Leaf-only |
| true | shadow | denied | allowed | yes | Leaf-only |
| true | shadow | allowed | denied | yes | Leaf-only |
| true | shadow | allowed | allowed | no | Leaf-only |
| true | shadow | allowed | allowed | yes | Leaf response plus isolated shadow diagnostics |
| true | serve | allowed | allowed | yes | Hierarchical with existing fallback |
| true | serve | allowed | allowed | no | Leaf-only |
| true | shadow/serve | allowed | allowed | yes, contract incompatible | Leaf-only |

## Remaining blockers

- Database bootstrap camelCase source synchronization.
- Live shadow validation and performance baseline.
- Relevance dataset and threshold policy.
- Broader Parent coverage.
- Human review before any shared configuration change.
