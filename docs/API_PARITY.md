# Product API coverage audit — Phase 11

This is an implementation audit, not a claim of complete parity or an OpenAPI replacement. HyperFlow owns business workflow state. Communications owns transport, people, threads and existing memory. Both authenticate and authorize their own requests. Provider consent and destination grants remain additional conditions.

| Product operation | API / authority | Current boundary or remaining gap |
|---|---|---|
| Projects, tasks, settings, scratch and activity snapshot | HyperFlow GET/PUT `/api/workspace` | Revision-checked snapshot API; browser still uses Firebase. 3.8MB cap; no individual resource CRUD contract yet. |
| Organization creation and invitations | HyperFlow `/api/organizations/create`, `/api/invites/create`, `/api/invites/consume` | Human identity required for creation/consumption; membership and administrator checks apply. Invitations return tokens, not automatic emails. |
| Email triage and coaching setup | HyperFlow `/api/service-projects/setup-draft`, `/validate`, `/status` | Shared Express/Vercel handler added in this release. GET status must not change schedules. Draft scope includes the current user. |
| Schedules and execution | HyperFlow `/api/schedules`, `/run`, `/tick` | Member API versus separately authenticated scheduler trigger. Legacy unbound schedules require an explicit write; a status read reports them. |
| Conversation register and corrections | HyperFlow `/api/thread-register` family composes Communications | Communications remains the write authority; HyperFlow supplies tenant and current actor context. |
| Existing memory and enriched context | HyperFlow `/api/communications/memory` composes Communications | Source visibility and Communications capabilities apply. No separate memory service or duplicate canonical store. |
| Already-transcribed meetings | HyperFlow `/api/meetings` composes Communications ingestion | Communications owns sources and topics; HyperFlow owns accepted operational obligations. |
| Promises, Asks and accepted obligations | HyperFlow `/api/commitments`, `/api/asks/:token` | Accepted business state is distinct from extracted promise evidence. Ask capability form is a separate access path. |
| Visible reusable flows | HyperFlow `/api/flows`, `/api/flow/advance`, `/api/tasks/execute` | Version/approval/receipt controls; paged flow summaries. Full-resource polling exists, not a universal operation API. |
| CEO cockpit and routines | HyperFlow `/api/cockpit`, `/api/coaching/sessions` | Combines app-owned routine state with scoped Communications context. Live outcome checks remain separate. |
| Diary proposals and bookings | HyperFlow `/api/calendar` | Proposal/approval/execution ledger; selected calendar and live booking acceptance still pending. |
| Templates, brand configuration and office artifacts | HyperFlow `/api/artifacts` | App-owned immutable artifact/approval records and output access; Google export acceptance pending. Existing arbitrary file uploads are a separate gap. |
| Social drafts and website changes | HyperFlow `/api/publishing` | Internal inspectable draft/approval flow released; selected adapters, destinations and publication grants are unresolved. |
| Mailbox and Google connections | HyperFlow `/api/integrations` family | Mailbox transport/credentials remain Communications-owned; Google workspace grants and credentials are HyperFlow-owned. Human OAuth consent is unavoidable. |
| Email authority and delivery status | HyperFlow `/api/communications/email-policy`, `/status`, `/api/send-email` | Communications enforces organization policy. Email remains draft-only for the current scope. API-client email capability alone does not override policy. |
| Provider callback receipt and voice context | HyperFlow `/api/events`, `/api/agent/voice-context` | Service signature/authentication and correlation checks; not ordinary user CRUD. Terminal bookkeeping must not invent workflow identifiers. |
| Account credentials, budgets and audit | HyperFlow `/api/tenant`; Communications `/v1/tenant/*` | Separate credentials, audit and request counters. Provider charges are not these counters. |
| Database suspension, recovery and export | HyperFlow `/api/tenant?view=lifecycle`; Communications `/v1/tenant/lifecycle` | Separate revisions and receipts. HyperFlow forwarding audits the current human administrator; no cross-app database write authority. |
| Files, recordings and attachments | Existing Firebase SDK uploads and server Ask uploads | REST parity, private downloads, in-flight upload controls and storage cleanup unfinished. Production Firebase Storage is unprovisioned; billing upgrade not authorized. |
| Erasure, retention and restoration | Separate app lifecycle procedures | Communications local database erasure exists. HyperFlow erasure and automatic retention do not. Portable exports are not a tested full backup/restore service. |
| Operational/support access | HyperFlow `/api/operations` and existing activity records | Job receipts and replay exist; complete support-access audit, health view, recovery measurements and tenant cost instrumentation remain unfinished. |

## Findings addressed in this release

Service-project setup was available through the Vercel router but absent from Express. Both now call the same tenant-authenticated handler. Reading status previously attached or disabled legacy schedules, which violated read-scoped client authority. Status now reports `upgradeRequired` and `unboundScheduleIds` without writes. The scheduler's existing unbound-project safeguards remain responsible for execution safety. A mailbox lookup failure is exposed as `mailboxStatus: unavailable`, rather than silently represented as an empty healthy list.

## Remaining completion work

Expand the separate OpenAPI schemas and standalone clients beyond phase supplements; audit UI branches and every resource operation rather than counting endpoint names. Finish file controls and deployment prerequisites, erasure and retention receipts, bounded lists and operation polling, support audit and backup/recovery exercises. Test a second tenant and private-source denial across both deployed apps. API registration tests and mock fixtures do not establish live provider delivery or full SaaS acceptance.
