# Phase 2-2 Hierarchical Retrieval Gate Review

Review date: 2026-08-09  
Decision scope: readiness review only; the shared Gate remains disabled.

## Review scope

This review evaluates the stable Query → Parent → Child → Leaf Context → Answer → Citation path, its fallback and safety contracts, and whether FocusFlow should enable `HIERARCHICAL_RETRIEVAL_ENABLED` for limited or broad traffic. It does not authorize a Gate change, Atlas mutation, Parent publication, or production rollout.

## Current architecture and evidence

The Backend uses stable `gemini-embedding-2` query embeddings (3072 dimensions, `taskType=null`) and a versioned search-query instruction. Three active stable Parent documents for video `6a6da69556dd124511ec51eb` are queryable through `parent_embedding_index`. Their nine Child references resolve through the live camelCase `chunkId_1` index without a collection scan.

Step 10 exercised four live isolated questions through Query Embedding, Parent Vector Search, Child Expansion, Leaf Context Assembly, Gemini Answer Generation, and Citation Assembly. The run produced 18/18 valid Leaf citations, exact Leaf timestamps, no duplicate or cross-video citation, and zero monitored MongoDB writes. The shared Gate remained false.

## Milestone assessment

| Area | Evidence | Status |
|---|---|---|
| Query stable contract | Gemini stable model, 3072 dimensions, query instruction, null task type | PASS |
| Parent stable contract | Stable schema, validator, resume and uploader reject preview artifacts | PASS |
| Stable Parent artifact | 47 validated records retained locally | PASS |
| Live Parent publication | Three isolated Parents migrated and idempotently re-run | CONDITIONAL PASS |
| Parent Vector Search | Expected stable ranking and scope-filter regression passed | PASS |
| Allowed-video bridge | Existing course-or-video bridge behavior passed | PASS |
| Child Expansion | 9/9 found; order preserved; zero missing, duplicate, or scope mismatch | PASS |
| Live Leaf index | `chunkId_1` exists and Explain uses IXSCAN | PASS |
| Database bootstrap | Repository still creates `chunk_id` / `video_id` indexes | BLOCKED |
| Leaf Context | Deterministic deduplication, count and character limits | PASS |
| Answer grounding | Amazon grounded; two relevant questions safely returned no-answer | CONDITIONAL PASS |
| Irrelevant question | No recipe hallucination; safe insufficient-context answer | PASS |
| Citation integrity | 18/18 valid chunk IDs and exact Leaf timestamps | PASS |
| Frontend citation adoption | UI still renders and jumps mainly from `result.matches` | CONDITIONAL PASS |
| Fallback | No-hit, timeout, missing index, invalid Parent, empty Child/Context covered | PASS |
| Zero-write runner | Command monitoring and live zero-write E2E passed | PASS |
| Regression tests | Backend and Pipeline suites passed after Step 10 | PASS |

## Gate decision matrix

| Gate criterion | Evidence | Status | Severity | Required before Gate |
|---|---|---|---|---|
| Stable Embedding Contract | Query and Parent share model, dimensions, generation, normalization and contract versions | PASS | BLOCKER | Keep active metadata aligned |
| Parent Vector Search | Live expected ranking and filter isolation passed | PASS | BLOCKER | None for tested scope |
| Child Expansion | Live 9/9 with deterministic order | PASS | BLOCKER | None for tested scope |
| camelCase `chunkId` index | Live `chunkId_1`, IXSCAN, 9 docs examined / 9 returned | PASS | BLOCKER | Preserve live index |
| Citation Integrity | 18/18 chunk IDs and timestamps valid | PASS | BLOCKER | None for tested scope |
| Fallback | Explicit `leaf_fallback`, reason codes and runtime metadata | PASS | HIGH | Keep fallback enabled |
| Zero-write E2E | No insert/update/delete/bulkWrite/index operation | PASS | HIGH | None |
| Git source synchronization | E2E Runner fix committed; DB bootstrap remains snake_case | FAIL | HIGH | Database owner must sync camelCase bootstrap and verify on a clean rebuild |
| Active runtime contract declaration | Actual runtime has no declared active Leaf or Parent contract JSON | FAIL | HIGH | Declare and validate the active contracts before activation |
| Parent coverage | Three Parents cover one video; remaining Parents/videos are absent | CONDITIONAL PASS | BLOCKER for full rollout | Use an explicit limited scope or publish validated coverage before broad rollout |
| Relevance handling | No Parent score threshold; unrelated query scores about 0.75–0.76 | CONDITIONAL PASS | MEDIUM | Collect score/no-answer distributions; define policy before broad rollout |
| Answer grounding/recall | Safe no-answer behavior, but 2/3 relevant questions did not answer | CONDITIONAL PASS | HIGH | Measure answer-rate impact and tune only from evidence |
| Performance | IXSCAN and a 1-second Parent timeout exist; end-to-end p50/p95 absent | UNKNOWN | HIGH | Shadow/canary latency measurement before broad rollout |
| Provider timeout safety | Parent search is bounded; Query/Answer fetch paths have no explicit request timeout | CONDITIONAL PASS | HIGH | Define provider timeouts before broad rollout |
| Observability | Response runtime has mode, fallback, counts and retrieval latency | CONDITIONAL PASS | MEDIUM | Add rollout dashboards/queries and Parent score distribution evidence |
| Rollout control | Only a global boolean Gate exists; no allowlist or shadow mode | FAIL | BLOCKER for limited rollout execution | Implement/review a scoped control before enabling any shared process |
| Regression tests | Dedicated, Backend full, and Pipeline full suites passed | PASS | HIGH | Re-run immediately before rollout |

## Parent coverage

Technical correctness is proven only for one video, three Parent documents, and nine Leaf documents. With the current global Gate, all other courses and videos would attempt Parent Search, commonly receive `PARENT_NO_HITS`, wait for the Parent path, and then fall back to Leaf retrieval. This preserves correctness but adds latency and creates a high fallback rate.

The existing 47-record stable artifact covers the current run, but only three records are published. Other videos and courses have no demonstrated Parent coverage. Therefore the current evidence supports an isolated or explicitly allowlisted rollout, not a full production rollout.

## Relevance and answer behavior

There is no minimum Parent score threshold. The unrelated cake query still returned scores around 0.75–0.76, but Gemini correctly returned the insufficient-context answer and did not generate a recipe. This makes relevance threshold work **safe to defer for an isolated rollout**, but it **should be resolved before broad rollout**.

A single arbitrary threshold should not be introduced from four questions. Candidate evidence should include positive/negative score distributions, score margins, no-answer rate, and downstream grounding outcomes. A combined policy (Parent score/margin plus answer no-answer behavior) is safer than relying on one absolute score.

Retrieval precision was directionally correct for all relevant queries. Retrieval recall reached the expected Parent, but answer recall was conservative: the knowledge-graph and semantic-rewrite questions returned safe no-answer responses. This may reflect context sufficiency, STT quality, top-K/context settings, or prompt conservativeness. It is not a hallucination failure, but broad activation could reduce perceived answer rate.

## Fallback and citation readiness

Parent no hits, timeout, missing index/collection, invalid Parent, empty Child expansion, and empty Context all produce an explicit Leaf fallback when `HIERARCHICAL_RETRIEVAL_FALLBACK_TO_LEAF=true`. The response exposes `retrievalMode`, `fallbackUsed`, `fallbackReason`, counts, latency, and a structured fallback entry. This is sufficient for an isolated rollout and is a necessary protection for limited Parent coverage.

Citation integrity is **READY** at the Backend contract level. The frontend remains backward compatible because it primarily renders `result.matches`; it does not yet treat `result.citations` as the primary display/jump contract. That does not block the Gate, but frontend citation adoption remains a product follow-up.

## Performance and cost

The live Child lookup uses IXSCAN. Parent Search has a 1,000 ms timeout. There is not enough E2E latency evidence to establish p50/p95, provider timeout behavior, or fallback overhead; `PERFORMANCE_EVIDENCE_LIMITED` applies.

Compared with the existing QA path, hierarchical retrieval adds an Atlas Parent vector query and a Child Leaf lookup. Query Embedding and Answer Generation already exist in the QA flow, so the main incremental cost is Atlas/read latency and extra fallback work. Expected incremental cost is **moderate**, with capacity risk **unknown** until shadow/canary measurement.

## Observability requirements

Existing response/runtime evidence includes retrieval mode, fallback reason, Parent hit count, Child counts, Context truncation, answer provider, and hierarchical retrieval latency. Fallback also emits a structured warning. Production Parent scores are not propagated into runtime diagnostics, and no rollout dashboard or aggregate metric is present.

Before broad rollout, monitor:

- hierarchical success and Leaf fallback rates;
- `PARENT_NO_HITS`, timeout, invalid Parent, and Child-missing rates;
- Parent top score and top-score margin distributions;
- no-answer and answer-provider fallback rates;
- hierarchical latency p50/p95;
- citation count and integrity errors.

## Rollout recommendation

- **Option A — global enable:** Not recommended. Parent coverage, source reproducibility, contract declarations, performance evidence, and rollout controls are insufficient.
- **Option B — allowlist:** Recommended next direction for the validated course/video and designated users. The repository does not currently implement this control (`ROLLOUT_CONTROL_NOT_IMPLEMENTED`).
- **Option C — shadow:** Preferred for collecting relevance, fallback and latency distributions without changing user answers. Shadow mode is also not currently implemented.

The project is technically ready to plan a limited rollout, but the global Gate must remain false until a scoped control is implemented and reviewed.

## Blockers and risks

1. **BLOCKER — rollout control:** only a global Gate exists. Implement and test a course/video/user allowlist or shadow mode.
2. **HIGH — bootstrap source drift:** sync camelCase Leaf index definitions and verify a reproducible clean setup.
3. **HIGH — active contract declaration:** set and verify the active Leaf/Parent embedding contract metadata in the rollout environment.
4. **HIGH — limited Parent coverage:** either constrain the rollout to the isolated scope or publish validated Parent coverage.
5. **HIGH — performance evidence:** collect end-to-end latency and fallback overhead; add explicit provider timeout review.
6. **MEDIUM — relevance policy:** collect distributions before selecting a score or margin policy.
7. **MEDIUM — frontend adoption:** continue supporting matches while planning primary citation-contract adoption.

## Rollback plan

Rollback triggers include elevated error/fallback/no-answer rates, p95 latency regression, hallucination, citation mismatch, or scope leakage. The minimum rollback is to set `HIERARCHICAL_RETRIEVAL_ENABLED=false` in the controlled deployment configuration and restart/reload the affected instance. Verify that runtime reports Gate=false and that QA responses no longer contain `runtime.hierarchicalRetrieval`. Leaf-only retrieval remains intact; Parent documents and indexes may remain, and no data migration rollback is required.

## Final decision

**Technical Gate Readiness:** PASS.  
**Limited Rollout Readiness:** CONDITIONAL — ready to plan, but scoped rollout control and environment/source prerequisites must be completed before activation.  
**Full Production Readiness:** NOT READY.

Primary classification: `READY_FOR_LIMITED_HIERARCHICAL_ROLLOUT`.

This classification does not authorize changing the shared Gate. The next action is to design and review a limited-scope Gate rollout, then obtain explicit human approval before any activation.
