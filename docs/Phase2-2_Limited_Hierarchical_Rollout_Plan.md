# Phase 2-2 Limited Hierarchical Rollout Plan

Planning date: 2026-08-09

Status: planning only. The shared `HIERARCHICAL_RETRIEVAL_ENABLED` Gate remains `false`; this document does not authorize a live rollout.

## 1. Scope

This plan converts the Gate Review decision `READY_FOR_LIMITED_HIERARCHICAL_ROLLOUT` into a controlled implementation sequence. It covers rollout routing, shadow execution, Parent coverage, relevance evidence, observability, rollback, and release prerequisites. It does not implement a rollout control, change `.env`, mutate Atlas, publish the remaining 44 Parents, or enable production traffic.

The currently validated data scope is:

- course: `6a6da68456dd124511ec5196`;
- video: `6a6da69556dd124511ec51eb`;
- three stable Parent documents and nine resolved Leaf documents;
- stable Gemini text-search contract, 3072 dimensions and null task type.

## 2. Current readiness

Technical readiness is proven for Stable Query Embedding, Parent Vector Search, Child Expansion, Leaf Context, Answer Generation, Citation Assembly, fallback, and the zero-write E2E path. The live `chunkId_1` lookup uses IXSCAN and the three isolated Parents pass stable-contract validation.

Limited rollout is ready for implementation planning, not activation. The Backend currently has only one global boolean Gate. There is no course, video, user, allowlist, percentage, or shadow-mode router.

## 3. Why full rollout is blocked

- Live Parent coverage is limited to three Parents for one video.
- The QA request carries `courseId` and question, not an explicit requested `videoId`.
- Database bootstrap still defines Leaf `chunk_id` and `video_id` indexes although live Atlas uses camelCase.
- Active Leaf and Parent embedding-contract JSON declarations are empty in the current runtime.
- Four E2E questions are insufficient for a relevance threshold.
- There is no production latency p50/p95, fallback-rate, or capacity evidence.
- Runtime diagnostics are useful per response but are not yet aggregated into rollout metrics.
- The frontend remains primarily based on `result.matches`, although the additive Citation contract is compatible.

## 4. Recommended rollout strategy

Recommendation: `RECOMMEND_ALLOWLIST_WITH_SHADOW`.

The first implementation should execute Hierarchical Retrieval in shadow mode only for explicitly allowlisted test users within the validated course, with Parent Search restricted to the intersection of authorized videos and supported-video coverage. The user-visible answer, matches, and citations must remain Leaf-only during initial evidence collection.

This combines the low user impact of shadow mode with the cost containment of an allowlist. Global shadow traffic is not recommended because Parent coverage is sparse and it would add Gemini and Atlas load without useful evidence for most requests.

## 5. Allowlist design

### Available runtime identifiers

The production QA path has access to:

- authenticated `user.id` and role;
- validated `courseId` and the loaded Course;
- authorized course/video scope and `allowedVideoIds`;
- request source (`api` or another caller-provided source).

The public QA request does not directly include a canonical `videoId`. Therefore a video-only request allowlist cannot safely infer which video the user intended.

### Suggested configuration

Names should follow the existing uppercase environment-variable style:

- `HIERARCHICAL_RETRIEVAL_ROLLOUT_MODE=off|shadow|serve`;
- `HIERARCHICAL_RETRIEVAL_ALLOWED_COURSE_IDS`;
- `HIERARCHICAL_RETRIEVAL_ALLOWED_VIDEO_IDS`;
- `HIERARCHICAL_RETRIEVAL_ALLOWED_USER_IDS`.

Exact parsing and naming require implementation review. Empty allowlists should fail closed, not mean all traffic.

### Routing contract

`shouldUseHierarchicalRetrieval()` should receive the global Gate, rollout mode, authenticated user, requested course, authorized video IDs, and configured allowlists.

1. Global Gate false: always Leaf-only; no shadow work.
2. Global Gate true but user/course is not allowlisted: Leaf-only.
3. Global Gate true and request is allowlisted: compute `supportedVideoIds = authorizedVideoIds ∩ allowedVideoIds`.
4. Empty supported-video intersection: Leaf-only with a safe rollout diagnostic.
5. Shadow mode: run Hierarchical Retrieval on the supported intersection, but preserve the Leaf-only answer and Citation response.
6. Serve mode: use Hierarchical output only for the eligible scope; normal fallback remains enabled.

Allowlisting is never authorization. It may only narrow the already-authorized course/video scope and must not introduce a video that access control excluded.

## 6. Shadow design

The foreground path remains the existing Leaf-only retrieval, answer and citation flow. The shadow path may run Stable Query Embedding, Parent Search, Child Expansion, and diagnostics collection. Initially it should not run a second Answer Generation call.

Shadow output must not modify the HTTP response, Citation, FAQ behavior, Question record, Clip hit count, or user-visible answer. Diagnostics should use an approved metrics/logging path and avoid transcript text, embeddings, prompts, credentials, and raw Child-ID lists.

Benefits:

- Parent top-score and top-two-gap distributions;
- Parent no-hit and fallback rates;
- Child coverage and scope mismatch evidence;
- retrieval latency and timeout evidence;
- safe comparison with the Leaf-only production outcome.

Costs and risks:

- Query Embedding may already be available in the QA flow and should be reused, never called twice;
- one extra Atlas Parent Vector Search and Child lookup for eligible traffic;
- additional latency if shadow is awaited rather than safely bounded;
- metrics and error isolation must be implemented before live use.

## 7. Parent coverage strategy

### Stage 1: three Parents / one video

- Entry: current validated stable documents, live indexes and zero-write E2E evidence.
- Scope: allowlisted test users, target course, supported-video intersection.
- Validation: shadow rankings, child coverage, latency, no scope leakage.
- Rollback: disable rollout mode or global Gate; retain data.
- E2E sample: curated relevant, paraphrased, partial, irrelevant and ambiguous questions.

### Stage 2: complete 47 Parents for the current video

- Entry: authority-approved publication, stable artifact validation and Stage 1 safety evidence.
- Scope: remaining 44 validated records for the same video only.
- Validation: uploader preflight, controlled publication, checksums, idempotent rerun, Parent Search and Child Expansion regression.
- Rollback: stop serving Hierarchical Retrieval; do not automatically delete or restore preview data.
- E2E sample: coverage across the complete video timeline and topic boundaries.

### Stage 3: additional representative videos

- Entry: stable artifacts and authoritative course/video mappings for each candidate.
- Scope: small videos selected across different transcript lengths and content types.
- Validation: per-video coverage, vector contract, indexes, score distributions, latency and fallback.
- Rollback: remove the affected video from the rollout allowlist; retain documents for diagnosis.
- E2E sample: positive, negative and cross-video scope cases for every video.

### Stage 4: course-level coverage

- Entry: all intended searchable videos in the course have validated Parent coverage.
- Scope: allowlisted course and test cohort before broader users.
- Validation: course-wide no-hit rate, allowed-video bridge, mounted videos, performance and Citation integrity.
- Rollback: disable course rollout or global Gate.
- E2E sample: statistically useful production-like question set plus monitored canary traffic.

## 8. Relevance evidence plan

Do not set an absolute threshold from the existing four questions. Build a labelled dataset containing:

- clearly relevant questions;
- semantic paraphrases;
- partially relevant questions;
- completely irrelevant questions;
- ambiguous or underspecified questions.

For every record capture a safe query identifier/class, expected relevant Parent, top score, top-two score gap, hit count, expected relevance, retrieval verdict, answer/no-answer outcome, fallback reason, and Citation-grounding verdict. Do not store embeddings or full transcript context.

Threshold or policy selection should compare false-positive context injection, false-negative retrieval, answer rate, safe no-answer rate, and Citation grounding. Candidate policies may combine top score, score margin and downstream no-answer behavior. The decision requires held-out validation and should not optimize only the current video.

## 9. Observability requirements

### Already available per response/runtime

- retrieval mode, fallback flag and fallback reason;
- Parent hit count;
- requested/found/missing/duplicate/scope-mismatch/truncated Child counts;
- Context truncation;
- answer provider;
- hierarchical retrieval latency.

### Derivable after safe aggregation

- hierarchical request and success counts;
- Leaf fallback and Parent-no-hit rates;
- Child missing and Context truncation rates;
- no-answer and provider-fallback rates;
- Citation count;
- retrieval latency p50/p95 and total QA latency p50/p95.

### Missing

- Parent top score and top-two gap in production rollout diagnostics;
- a stable rollout eligibility/mode diagnostic;
- aggregated dashboards or queries;
- capacity baselines and alert thresholds;
- systematic Citation-integrity sampling.

Before live rollout, implement structured, privacy-safe events or metrics for eligibility, mode, Parent scores, fallback, Child coverage, Answer status and latency. Define the observation window and baseline before setting numerical alert thresholds.

## 10. Rollback criteria

### Immediate rollback

- cross-course/video Citation or authorization leakage;
- unexpected MongoDB writes introduced by the Hierarchical subsystem;
- Citation points to missing or mismatched Leaf data;
- crash loop, severe error spike, or corrupt response contract;
- embedding-contract incompatibility or index failure affecting eligible traffic.

### Review trigger

- elevated fallback or `PARENT_NO_HITS` rate;
- material p95 latency increase;
- increased safe no-answer rate or reduced grounded-answer rate;
- Parent score distributions do not separate relevant and irrelevant traffic;
- elevated Child missing, scope mismatch, truncation or provider fallback.

Numerical thresholds require a Leaf-only baseline and shadow/canary evidence. The minimum rollback action is to set the controlled rollout mode to off and, if necessary, restore `HIERARCHICAL_RETRIEVAL_ENABLED=false`. Verify Leaf-only routing and runtime state. Parent documents and indexes can remain; no data rollback is required.

## 11. Implementation phases

### Phase A: rollout-control implementation

- Entry: this plan approved and owners agree on config names and fail-closed semantics.
- Work: config parser, pure eligibility function, scope intersection, shadow/serve routing, diagnostics and unit/integration tests.
- Exit: Gate false remains Leaf-only; non-allowlisted traffic is Leaf-only; authorization cannot be widened.
- Rollback: revert deployment or keep rollout mode off.

### Phase B: allowlist dry-run

- Entry: Phase A tests pass; Database bootstrap and active contracts are synchronized.
- Work: offline fixtures and zero-write runner exercise target and non-target users/courses/videos.
- Exit: eligibility, response isolation, fallback and metrics are deterministic.
- Rollback: no live state was changed.

### Phase C: limited live shadow rollout

- Entry: explicit human approval, shared Gate/config change procedure, metrics and rollback operator ready.
- Work: enable only the test cohort and validated supported-video intersection; retain Leaf-only responses.
- Exit: sufficient score, fallback, Child coverage and latency evidence without safety incidents.
- Rollback: rollout mode off or global Gate false.

### Phase D: limited serve rollout and metrics collection

- Entry: shadow evidence accepted and Parent coverage appropriate for the scope.
- Work: serve Hierarchical responses to the same narrow cohort with fallback enabled.
- Exit: grounding, Citation, answer rate and performance meet approved criteria.
- Rollback: return to shadow/off without data migration.

### Phase E: Gate Review #2

- Entry: documented shadow/serve evidence and regression results.
- Work: review relevance policy, latency, capacity, coverage, frontend behavior and incidents.
- Exit: expand, hold, or rollback decision.

### Later phases

Expand Parent coverage to the complete video, representative videos, then course-level coverage. Full rollout is considered only after repeatable source setup, declared contracts, sufficient observability and a successful second Gate Review.

## 12. Database bootstrap dependency

Status: `DB_BOOTSTRAP_SOURCE_PENDING`.

Database-owner TODO:

- File: `database/tools/setup/init_indexes.js`.
- Current issue: `video_segments_text` bootstrap uses `video_id` and unique `chunk_id` while the production Leaf schema and Child Expansion use `videoId` and `chunkId`.
- Expected review: add the approved camelCase single or compound indexes without changing unrelated legacy collections.
- Tests: static key-pattern test, clean-environment bootstrap verification, live `listIndexes`, and equivalent Child lookup `explain("executionStats")` showing IXSCAN.
- Delivery: dedicated Commit/Push followed by source/live comparison.

This is required before any limited Gate activation because environment rebuilds must reproduce the validated live state.

## 13. Active embedding-contract dependency

Backend has centralized stable constants and parsers in `embeddingContract.service.js`, plus runtime diagnostics for `QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON` and `QA_ACTIVE_PARENT_EMBEDDING_CONTRACT_JSON`. Both declarations are currently empty, so runtime reports them as not declared.

The expected Query and Parent declarations share provider `gemini`, model `gemini-embedding-2`, dimension 3072, null task type, instruction version `gemini_embedding_2_search_v1`, generation version `text_search_generation_v1`, normalization `unit_l2_v1`, and contract/schema version `gemini_embedding_2_text_v1`. Query and Parent roles differ in their canonical instruction text; Parent artifacts additionally use schema `parent_embedding_v2`, which must not be confused with the embedding contract version.

Minimum design:

- keep stable constants centralized rather than duplicating literals in routing;
- declare active Leaf and Parent metadata through reviewed deployment configuration;
- validate declarations through the existing runtime health snapshot before eligibility can become true;
- expose compatible/incompatible/not-declared status without secrets;
- fail closed for Hierarchical eligibility when the Parent contract is not compatible.

## 14. Final recommendation

`RECOMMEND_ALLOWLIST_WITH_SHADOW`

The validated Parent coverage is too narrow for a global switch, relevance and performance evidence remain limited, and the current request is course-scoped rather than video-scoped. Combining an allowlisted test cohort with supported-video intersection and shadow response isolation provides the best balance of safety, evidence quality, cost control and implementation clarity.

Next implementation task: Phase 2-2 Limited Rollout Control Implementation. It must remain disabled by default and requires separate human approval before any live configuration change.
