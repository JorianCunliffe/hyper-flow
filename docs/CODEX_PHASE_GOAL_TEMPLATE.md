# Codex phase goal and evidence template

Use with [HYPERFLOW_IMPLEMENTATION_PLAN.md](HYPERFLOW_IMPLEMENTATION_PLAN.md). This is a reusable instruction template, not an active goal. Replace bracketed fields before starting.

## 1. Ready-to-use next goal: Phase 00

> Start a goal to complete Phase 00 of `docs/HYPERFLOW_IMPLEMENTATION_PLAN.md` in HyperFlow. Inspect the current local and available deployment state of `C:/Users/joria/OneDrive/Documents/hyperflow-5` and `C:/Users/joria/OneDrive/Documents/communications-service`. Preserve unrelated edits. Establish the current revisions, contract gaps, schema/provider readiness and safe test baseline; reconcile documentation drift. Specifically verify the Thread Register client/server mismatch, current Outlook implementation, existing memory ownership, scheduler helper, draft-only email policy and dependency reproducibility. Keep Communications memory in Communications Service. Do not implement later phases or make live calls/messages as part of the baseline. Document results in each app's `docs/implementation/P00.md` and update HyperFlow's `docs/IMPLEMENTATION_STATUS.md`. Complete the goal only when the Phase 00 acceptance gate is evidenced. Do not assign a token budget unless I request one.

## 2. Reusable phase instruction

For Phase 00 also inspect `C:/Users/joria/OneDrive/Documents/ChatGPT/communications-service`: it contains more recent committed and uncommitted threading work than the other local checkout. Establish the intended implementation checkout and preserve all unpublished changes before implementation; the two folders are the same application, not separate services.

> Start a goal to implement Phase [ID], [TITLE], from `docs/HYPERFLOW_IMPLEMENTATION_PLAN.md`. Limit this goal to [WORK PACKAGES OR COMPLETE PHASE]. Read the master plan, current programme status and predecessor phase records before editing. Recheck the repositories, instructions, branches and active changes; use the current state rather than an old snapshot.
>
> Keep the applications distinct. Communications Service owns people, communication identities, canonical threads, transport, transcripts and its existing memory/enrichment. HyperFlow owns business intent, accepted commitments, Asks, flows, schedules, artifacts and its UI. Do not extract memory, create another memory service, duplicate authoritative thread/contact stores, or access the other app's database.
>
> Implement the phase's owner contracts before consumer changes, preserving compatibility. Enforce the CEO's draft-only email policy throughout. SMS and phone may execute within already granted recipient/purpose policies; do not treat permission to communicate as permission to make new business commitments. Use controlled acceptance targets, reconcile uncertain provider outcomes and respect configured limits. [RECORD PHASE-SPECIFIC LIVE AUTHORITY, OR STATE THAT LIVE EXECUTION IS NOT INCLUDED.]
>
> Run the required focused checks and acceptance cases, inspect the human-readable UI where applicable, and verify actual external outcomes where the authorized scope requires them. Record deployment separately from local implementation. Preserve unrelated edits and keep commits scoped by repository. Carry out commit/push/deployment steps included in the authorized phase scope; do not report a release from source or build results alone.
>
> Maintain `docs/implementation/[ID].md` in every changed app, update each app's authoritative API/operations documents, and update HyperFlow's `docs/IMPLEMENTATION_STATUS.md` with evidence links. Record contracts, migrations, exact checks, revision/deployment references, remaining limitations and rollback. Do not store project progress in Codex personal memory.
>
> Complete the goal only after the selected work package's acceptance criteria are met. Completing a work package is not completing the whole phase. Report missing inputs and blockers accurately and follow the goal tool's rules for goal status. Do not start the next phase or create other Codex tasks automatically. Do not set a token budget unless explicitly requested.

## 3. Phase-entry checklist

- Confirm predecessor gates and any conditional dependencies.
- Set exact goal scope and owner repository for each change.
- Record repository revision, working-tree state and existing user edits.
- Read applicable repository instructions and the latest source contracts.
- Identify whether the requested scope includes local work, deployment and/or controlled live acceptance.
- Identify the narrow tests, integration checks, UI paths and required evidence.
- Record schema/API changes and provider-before-consumer release order.
- Confirm any required provider, template, timezone or authority settings from existing configuration; ask only for genuinely missing decisions.

## 4. Per-application phase record

Create `docs/implementation/Pxx.md` in each affected repository. Use the following structure. Values start as unknown/not run and are filled with evidence, never presumed successful.

### Phase and scope

- Phase/work-package ID and title:
- Goal/task reference, if available:
- Owner application and exact scope:
- Start/end dates:
- Entry dependencies and evidence:
- Other application's phase record:

### Baseline

- Branch/revision:
- Existing local edits and how they were preserved:
- Deployment/schema baseline, if inspected:
- Relevant instructions and authoritative contracts:
- Known failures or missing infrastructure:

### Decisions and ownership

- Changes owned here:
- APIs/events consumed from the other app:
- Canonical identifiers and external references:
- Architecture decisions made and why:
- Explicit scope exclusions:

### Implementation and compatibility

- Final behavior:
- Files/modules changed:
- Contract/schema versions and migration requirements:
- Compatibility strategy and feature flags:
- Dependency/provider changes:
- Data backfill or reconciliation, if any; no memory extraction:

### Acceptance evidence

| Criterion | Fixture/check | Result | Evidence reference | Remaining issue |
|---|---|---|---|---|
| Copy the phase's exact criterion | Not run | Not run | None | Not assessed |

For each executed check record command or test name, time, outcome and relevant output summary. Provider tests additionally record controlled target reference, action/communication ID, provider ID, event correlation and observed effect. Avoid secrets and unnecessary private content.

### Delivery

- Scoped commit(s):
- Push result, when in scope:
- Deployment revision/status, when in scope:
- Applied migrations/configuration, when in scope:
- Public/provider verification, when in scope:
- Clearly label anything not deployed or not live-accepted.

### Recovery

- Rollback/recovery steps:
- External effects that cannot be reversed:
- Idempotency receipts to preserve:
- Outstanding jobs/events requiring reconciliation:

### Handoff

- Completed work packages and accepted gate:
- Open defects, blockers and missing decisions:
- Documentation updated:
- Next permitted step:
- Final state: planned / in progress / implemented / locally verified / deployed / accepted.

## 5. Completion rules

“Implemented” means the code exists. “Locally verified” means the required local checks passed. “Deployed” requires a verified deployment revision. “Accepted” requires all mandatory outcomes for the declared scope, including live evidence where specified.

If execution is blocked, record the concrete dependency and work still possible. A documentation blocker entry does not override the goal tool's separate rules for marking a goal blocked. A goal must not be marked complete merely because a test cannot run, time is short or the result looks plausible.

Keep the final handoff concise: what changed, what passed, what is deployed, what remains, and links to the record. Detailed evidence belongs in the phase document so the next Codex goal can continue without reconstructing conversation history.
