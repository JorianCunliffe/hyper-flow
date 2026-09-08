# HyperFlow implementation programme status

Last updated: 8 September 2026.

**Current state:** Phases 01–03 and the subsequent communications repairs are merged and deployed. Phase 04 is implemented and locally verified on its review branch; its production rollout is pending. SMS and call receipt were confirmed by the user. The later transcription teardown repair has not had a fresh live-call acceptance test. Historical baseline observations below remain dated snapshots.

**Current scope:** two existing applications. Communications Service retains its existing memory, search and enrichment. No memory extraction or third memory application.

**First customer:** CEO. Email draft-only; SMS and phone permitted within configured authority. Diary mutations and public publishing need their own policies.

## Programme documents

- [Master implementation plan](HYPERFLOW_IMPLEMENTATION_PLAN.md)
- [Codex phase goal and evidence template](CODEX_PHASE_GOAL_TEMPLATE.md)
- [Product model](HYPERFLOW_PRODUCT_MODEL.md) — broader vision; the master plan supersedes its separate-memory/new-wiki direction for this programme.
- [Existing integrated acceptance plan](OMNICHANNEL_ACCEPTANCE_TEST_PLAN.md)

## Verified Phase 00 baseline

- HyperFlow HEAD observed at `6b9acf5`, with existing tracked modifications and untracked Thread Register work.
- Communications HEAD observed at `7ba163a`, with a clean status at inspection.
- A second Communications checkout at `C:/Users/joria/OneDrive/Documents/ChatGPT/communications-service` is at `8c8b9d2` with extensive uncommitted threading changes, migration 018 and pending migration 019. Its `v1.js` contains Thread Register/candidate/rethread endpoints missing from the first checkout. Phase 00 must reconcile these sources without losing work.
- Communications already has memory search, facts, extracted commitments, enrichment, calendar context and Gmail/Outlook adapters. These remain there.
- HyperFlow: 434 tests, 30 database rules checks, type-check and build passed. Newer Communications: 234 unit and 19 database tests passed. Older Communications: 212 unit tests passed.
- Fetched remote HyperFlow main is `2a54acb` (additional acceptance documentation), verified READY in production. Remote Communications main is `1fabe2c` (voice `end_call` improvement), which must be preserved when integrating local threading changes.
- Communications health reports `v2.3.0`, build `5d14bcff6ad6`; exact deployed commit, migrations, mailbox grants and live targets remain unverified. No live calls/messages were made.

## Phase ledger

| Phase | Outcome | Status | Dependencies | Evidence |
|---|---|---|---|---|
| P00 | Current baseline and mismatch register | Baseline accepted | None | [HyperFlow record](implementation/P00.md); Communications records in each checkout's `docs/implementation/P00.md` |
| P01 | Ownership, authority and API/event contracts | Merged and deployed; later repair caveat above | P00 | [Record](implementation/P01.md); [HyperFlow PR](https://github.com/JorianCunliffe/hyper-flow5/pull/2); [Communications PR](https://github.com/JorianCunliffe/communications-service/pull/2) |
| P02 | Canonical cross-channel threads and register | Merged and deployed; SMS/call receipt confirmed | P01 | [Record](implementation/P02.md); [HyperFlow PR](https://github.com/JorianCunliffe/hyper-flow5/pull/3); [Communications PR](https://github.com/JorianCunliffe/communications-service/pull/3) |
| P03 | Safe use of existing Communications memory | Merged and deployed | P02 | [P03 record](implementation/P03.md); later baseline in [P04](implementation/P04.md) |
| P04 | HyperFlow commitments and Ask lifecycle | Implemented; local acceptance passed; rollout pending | P03 | [P04 record](implementation/P04.md) |
| P05 | Transcribed meeting ingestion and enrichment | Not started | P03, P04 | No phase record yet |
| P06 | Visible reusable flows from requests | Not started | P04; P05 for meeting inputs | No phase record yet |
| P07 | CEO cockpit, follow-up and receptionist | Not started | P06, P02–P04; P05 for meeting briefs | No phase record yet |
| P08 | Diary and calendar execution | Not started | P07, P01 | No phase record yet |
| P09 | Reports, templates and office artifacts | Not started | P06; P04/P05 for operational inputs | No phase record yet |
| P10 | Approved social and website publication | Not started | P09 | No phase record yet |
| P11 | Complete REST parity and SaaS operations | Not started | Cross-cutting from P01; final audit after selected product phases | No phase record yet |
| P12 | Integrated CEO acceptance and release | Not started | P00–P11 for full programme | No phase record yet |

Replace “No phase record yet” with links to the actual per-app records when they are created. Do not pre-create pass results or mark a whole phase complete from one work package.

## Next goal

Review and land Phase 04, deploy HyperFlow, then verify Obligations with a real organization member and controlled records. Communications remains at the compatible deployed contract; no Phase 04 release there is required. Preserve email policy and channel grants. Phase 05 has not started. The fresh live-call check for the earlier transcription repair remains distinct from Phase 04 acceptance; do not repeat provider calls as part of this phase.

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-08 | Keep existing memory inside Communications Service; omit extraction and a new memory layer. | Explicit user scope correction. |
| 2026-09-08 | Keep Communications canonical threads/people separate from HyperFlow business state. | Preserve application boundaries and avoid conflicting authorities. |
| 2026-09-08 | Treat extracted promises as source evidence; put accepted operational obligations in HyperFlow using Asks. | Separate interpretation from acceptance and verified fulfillment. |
| 2026-09-08 | Phase the work into bounded Codex goals with per-app evidence records. | Support implementation and reliable handoff without a single unbounded goal. |

| 2026-09-08 | Email draft-only is an option for every organization; it is the default. The CEO is in the first organization. | User clarification; no special CEO tenant ID required. |
