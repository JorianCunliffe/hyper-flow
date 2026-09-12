# Flow authoring API — design

A proposal for creating, reading, updating and deleting HyperFlow workflows and
every node type through the API, without changing how flows are stored or
executed. Nothing here is implemented yet.

The guiding constraint is that the engine, the orchestrator, the executors and
the persistence layer stay exactly as they are. This adds an authoring surface
in front of them and one place to validate a flow graph. It is deliberately not
a re-architecture.

## 1. What a workflow is today

There is no separate "workflow" record. A workflow **is** a `Project`, and its
nodes **are** its milestones ([`types.ts:778`](../types.ts), `:750`):

```
Project
  id, name, type, projectData, revision, milestones[]
    Milestone  ← a node
      id, name, dependsOn[]          ← the edges
      nodeType?                       ← defaults to MILESTONE when absent
      decisionConfig?                 ← DECISION nodes
      loopConfig?                     ← LOOP nodes
      actionConfig?                   ← every action node
      reviewPolicy?, asks?            ← any node may carry a review gate
      subtasks[]                      ← human work under a MILESTONE
```

`dependsOn` is the only edge list. There is no separate edges collection, no
node table, and no flow-definition document. Authoring a flow means writing
milestones into a project.

The whole tenant lives at one Realtime Database path, `projects/{orgId}`,
holding `{projects, settings, scratchTasks, activityLogs, dataRevision}`.

## 2. What exists today, and why it is not enough

| Surface | Covers | Gap |
|---|---|---|
| `GET\|PUT /api/workspace` | Whole-tenant snapshot read and replace | Cannot address one project or one node |
| `POST /api/service-projects/validate` + wizard | Creating the two service projects | Templates only; no editing afterwards |
| `GET\|POST\|PATCH\|DELETE /api/schedules` | Schedule records | Not the flow itself |
| `GET\|PUT /api/integrations/google/grant` | Per-project Doc/Sheet grant | Already fine — see §7 |
| `POST /api/tasks/execute`, `POST /api/flow/advance` | Running a flow | Not authoring one |

So a complete authoring surface already exists in exactly one form: `PUT
/api/workspace`. It works, and it is the honest baseline. Four things make it
unsuitable as the API for flow authoring.

**It is a whole-tenant read–modify–write.** To rename one node you must GET
every project, every setting, every scratch task and the entire activity log,
mutate one string, and PUT all of it back.

**Its conflict check is tenant-wide.** `replaceWorkspace`
([`lib/tenantControl/workspace.ts:38`](../lib/tenantControl/workspace.ts))
rejects the write unless `expectedRevision` still equals the tenant's
`dataRevision`. Two clients editing two *different* projects conflict with each
other. An API client competing with a live browser session will lose the race
repeatedly.

**The size ceiling is tenant-wide and shrinks.** The 3.8 MB cap covers all
projects at once, so the largest flow you can save gets smaller as the tenant
grows.

**It performs no graph validation.** `replaceWorkspace` checks that each project
has a string `id` and that `milestones` is an array — nothing more. Through this
endpoint an API client can today write a decision branch pointing at a node that
does not exist, a `loopStartId` that is not an ancestor, or a `dependsOn` naming
a deleted node. None of it is rejected. The flow simply misbehaves at runtime:
`resolveNodeStates` treats an unknown parent as permanently `pending`
([`lib/flowEngine.ts:62`](../lib/flowEngine.ts)), so the node never becomes
ready and the flow stalls with no error anywhere.

That last point is the real argument for this work. The gap is not only
convenience — it is that the existing write path cannot tell a valid flow from a
broken one.

## 3. Design constraints

**No new serverless functions.** `api/` contains exactly 12 `.ts` files, and
`vercel.json` already rewrites ~37 public paths onto them precisely to stay
under the deployment's function limit. Whether there is headroom for a
thirteenth should be confirmed against the current plan before assuming
otherwise; this design assumes there is none, so every route below is a rewrite
onto an existing function. That is the hardest constraint here, and it is what
rules out a conventional `api/projects/index.ts`.

**No storage change.** Projects stay at `projects/{orgId}`, in the same shape.
Browser saves through the Firebase client SDK keep working untouched, and so
does `PUT /api/workspace`.

**Reuse the engine's own definitions.** Validation must be derived from
`lib/flowEngine.ts`, `lib/nodeTypes.ts` and `types.ts`, never restated. A
second, drifting copy of the graph rules would recreate the documentation
problem in code.

**Follow the existing handler idiom.** `artifacts`, `calendar` and `cockpit`
all dispatch on `method` plus a `body.operation` discriminator (for example
[`lib/artifacts/api.ts:132`](../lib/artifacts/api.ts)). The new surface should
look like them, not introduce a third style.

## 4. Proposed surface

One new public path, `/api/projects`, rewritten onto the existing
`api/gemini/index.ts` function where `workspace` and `tenant` already live:

```json
{ "source": "/api/projects", "destination": "/api/gemini?action=projects" }
```

Scope derivation then works with no change: `requestScope`
([`lib/tenantControl/clients.ts:42`](../lib/tenantControl/clients.ts)) maps a
`gemini` group to its `action`, so machine clients authorize against
`projects:read` and `projects:write` automatically.

### Project-level

| Method | Request | Result |
|---|---|---|
| `GET` | `?shape=summary&after=&limit=` | Paged list: id, name, type, node count, revision, updatedAt. No milestones. |
| `GET` | `?id=` | One full project including milestones, `projectData` and `revision`. |
| `POST` | `{operation:"create", ...}` | Creates one project. See below. |
| `POST` | `{operation:"validate", project}` | Validates without writing. Same checks as a write. |
| `PATCH` | `?id=` `{expectedRevision, name?, type?, projectData?, isArchived?}` | Updates project-level fields only. Never touches milestones. |
| `DELETE` | `?id=` `{expectedRevision}` | Archives by default; `?purge=true` deletes. |

`create` takes either a template or an explicit graph:

```json
{ "operation": "create", "template": "daily_coaching",
  "name": "Daily Coaching", "options": { "reviewer": "person_1", "phone": "+61400000000" } }
```

```json
{ "operation": "create", "name": "Weekly report",
  "milestones": [ /* full node objects, validated as a graph */ ],
  "projectData": { } }
```

`template` accepts the three values `lib/projectTemplates.ts` already exports:
`blank`, `daily_coaching`, `email_triage`. This reuses
`dailyCoachingTemplate()` and `emailTriageTemplate()` rather than restating
either flow, so a template change reaches the API for free.

### Node-level

Node operations are `POST /api/projects?id={projectId}` with an `operation`
discriminator, so the scope group stays `projects:*` and no second route is
needed.

| `operation` | Body | Notes |
|---|---|---|
| `add_node` | `{expectedRevision, node}` | `node.id` must be unique in the project. |
| `update_node` | `{expectedRevision, nodeId, node}` | Full replacement of that node. |
| `patch_node` | `{expectedRevision, nodeId, changes}` | Shallow merge; `actionConfig.lastRun` and `runHistory` are not writable. |
| `delete_node` | `{expectedRevision, nodeId, reattach?}` | Rejected while other nodes depend on it unless `reattach:"parents"` rewrites their `dependsOn` to the deleted node's parents. |
| `connect` | `{expectedRevision, fromId, toId}` | Appends `fromId` to `toId.dependsOn`. |
| `disconnect` | `{expectedRevision, fromId, toId}` | Removes it. |
| `replace_graph` | `{expectedRevision, milestones}` | Whole-flow replacement for editors that diff locally. |

Every write returns the saved project and its new `revision`.

### Concurrency

`expectedRevision` is the **project's** `revision`, not the tenant's
`dataRevision`. `Project.revision` already exists and is already incremented on
every workspace save ([`lib/tenantControl/workspace.ts:48`](../lib/tenantControl/workspace.ts)),
so no new field is needed.

The write still runs as an RTDB transaction on `projects/{orgId}` — the storage
shape does not change — but it mutates only the addressed project and conflicts
only when *that* project's revision moved. Two clients editing two different
projects no longer reject each other, which is the main practical gain over
`PUT /api/workspace`.

`409` carries the current revision so a client can reload and retry:

```json
{ "error": "Project changed; reload before saving", "revision": 12 }
```

### Status codes

`200` read or write applied · `201` created · `400` malformed request ·
`403` not a member of the project's organization · `404` no such project or node ·
`409` stale `expectedRevision` · `413` project exceeds the write limit ·
`422` the graph is invalid (body carries the findings) · `503` persistence not configured.

## 5. Node coverage

All thirteen `NodeType` values ([`types.ts:450`](../types.ts)), with the
`actionConfig.template` each expects. Templates are JSON strings supporting
`{{variable}}` substitution from `projectData`.

| Node type | Carries | Template fields |
|---|---|---|
| `milestone` | `subtasks[]` | — (human work) |
| `decision` | `decisionConfig` | — |
| `loop` | `loopConfig` | — |
| `email` | `actionConfig` | `to`, `cc?`, `bcc?`, `subject`, `body`, `from?`, `service_identity_id?`, `provider_connection_id?` |
| `sms` | `actionConfig` | `to`, `from?`, `body` |
| `phone_call` | `actionConfig` | `to`, `from?`, `instruction` (or `prompt`/`body`), `purpose_type?` |
| `webhook` | `actionConfig` | `url`, `method?`, `headers?`, `payload?` |
| `report` | `actionConfig` | `prompt`, `sop?`, `template?`, `eval_criteria?` |
| `google_doc` | `actionConfig` | `{}` — the project's resource grant is authoritative |
| `google_sheet_read` | `actionConfig` | `{}` — grant authoritative |
| `google_sheet_append` | `actionConfig` | `idempotency_key`, `values` |
| `coaching_extract` | `actionConfig` | `minimum_confidence?`, `instruction?` |
| `email_triage` | `actionConfig` | `connection_id`, `triage_policy`, `create_drafts`, `digest_channel`, `digest_recipient` |

Any node type may additionally carry a `reviewPolicy`, and the API must accept
one on all thirteen — the coaching template already puts a conditional gate on
`coaching_extract` ([`lib/projectTemplates.ts:45`](../lib/projectTemplates.ts)).

### One gap worth closing at the same time

`upsert_google_sheet` is a fully implemented task type
([`lib/taskTypes.ts:3`](../lib/taskTypes.ts), executor at
[`lib/executeTask.ts`](../lib/executeTask.ts)) with **no corresponding
`NodeType`**. It is reachable from `/api/tasks/execute` and from an approved
agent proposal, but no flow can contain a node that performs an upsert.

Adding `GOOGLE_SHEET_UPSERT = 'google_sheet_upsert'` to the enum and one entry
to `ACTION_TASK_TYPE` and `ACTION_NODE_TYPES` is a three-line change that makes
the node catalogue match the executor catalogue. Without it, "every node type
covered" documents an inconsistency rather than fixing it.

## 6. Validation

This is the substance of the work — the part `PUT /api/workspace` has never
done. One pure module, `lib/flowGraph/validate.ts`, with no I/O, returning a
list of findings rather than throwing on the first problem.

**Structural**
- Milestone ids unique and non-empty within the project.
- Every `dependsOn` entry names a milestone in the same project.
- `nodeType`, when present, is a known `NodeType`; absent means `MILESTONE`.
- No `dependsOn` cycle, except a back-edge that a `loop` node's `loopConfig` accounts for. `resolveNodeStates` has a cycle guard ([`lib/flowEngine.ts:59`](../lib/flowEngine.ts)) that silently returns `pending`, so an accidental cycle stalls the flow invisibly.

**Decision nodes**
- At least one branch.
- Every `branches[].targetId` names a milestone that lists the decision node in its own `dependsOn` — the engine's `getChildren` is the only relationship it honours ([`lib/flowEngine.ts:43`](../lib/flowEngine.ts)).
- At most one default branch (one with no `conditions`).
- Warn when no default exists: with no matching branch the decision never resolves and every downstream node stays pending.

**Loop nodes**
- `loopStartId` names an existing milestone that can reach the loop node, matching `getLoopBody` ([`lib/flowEngine.ts:113`](../lib/flowEngine.ts)).
- `maxIterations >= 1`.
- `exitConditions` non-empty, else the loop only ever ends on the iteration cap.

**Action nodes**
- `actionConfig.template` present and valid JSON for every type in `ACTION_NODE_TYPES`.
- Required template fields per §5 present, allowing `{{placeholders}}` to stand in for any of them.
- `to` and `from` are E.164 or a placeholder, for `sms` and `phone_call`.
- `webhook.url` is HTTPS on port 443 — the executor enforces this at run time; catching it at author time turns a silent run-time failure into an editor error.

**Review policies**
- `responsePolicy:"quorum"` requires a numeric `quorum` no greater than `reviewers.length`.
- Warn on `onExpiry:"auto_approve"`: it converts a gate into a rubber stamp, which is why the default is `block` ([`types.ts:632`](../types.ts)).

**Resource-dependent (warnings, not errors)**
- `google_doc` requires the project's grant to carry a `documentId`; the sheet nodes require `spreadsheetId` and `sheetRange`; `email_triage` requires a `connection_id`.

These are warnings because the grant is written through a separate endpoint and
a caller may legitimately author the flow first. `POST {operation:"validate"}`
reports them so a UI can show "not runnable yet" without blocking the save.

Findings are returned uniformly:

```json
{ "valid": false,
  "findings": [
    { "severity": "error", "nodeId": "DECIDE_1", "code": "decision_target_not_a_child",
      "message": "Branch target STEP_9 does not list DECIDE_1 in dependsOn" }
  ] }
```

## 7. Google resources — no architecture change needed

The question was whether to keep pointing each activity at its own sheet, or
select one spreadsheet for the account and give each activity its own tab.

**Both already work, and neither needs a change.** `WorkspaceResourceGrant`
([`types.ts:66`](../types.ts)) is keyed by `projectId` and holds
`connectionId`, `documentId`, `spreadsheetId` and `sheetRange` — and
`sheetRange` is an **A1 range whose sheet name is the tab**.
`parseWritableRange` ([`lib/integrations/googleWorkspace.ts:236`](../lib/integrations/googleWorkspace.ts))
requires exactly that shape, and its own error message gives the example
`Coaching!A2:G`.

`saveWorkspaceResourceGrant` ([`lib/serverStore.ts:1648`](../lib/serverStore.ts))
enforces only that the connection is connected. There is **no uniqueness
constraint on `spreadsheetId`**, so nothing stops several projects sharing one
spreadsheet:

| Project | `spreadsheetId` | `sheetRange` |
|---|---|---|
| Daily Coaching | `1AbC…` | `Coaching!A2:G` |
| Email Triage digest | `1AbC…` | `Triage!A2:E` |
| Weekly review | `1AbC…` | `Review!A2:D` |

That is the "one document, different worksheets" model, available today by
configuration alone. The per-project grant stays the security boundary — each
project still reaches only the range it was granted, which is what keeps one
activity from writing over another's tab.

So the authoring API needs nothing new here. It should simply expose the grant
through the same `expectedRevision` discipline as everything else:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/integrations/google/grant?projectId=` | Already exists, unchanged |
| `PUT` | `/api/integrations/google/grant?projectId=` | Already exists, unchanged |

One optional convenience, if the "one account document" pattern becomes the
norm: a tenant-level default `{connectionId, spreadsheetId}` in settings that
the setup wizard pre-fills, leaving `sheetRange` per project. That is a UI
default, not a model change, and it can wait until the pattern has proven
itself.

## 8. Implementation

Roughly 400–500 lines, most of it validation and its tests.

**New files (2)**

| File | Purpose |
|---|---|
| `lib/flowGraph/validate.ts` | Pure graph validation, §6. Imports the engine's own helpers. |
| `lib/projects/api.ts` | Handler: dispatch, authorization, revision check, delegate to the store. |

**Changed files (4, all small)**

| File | Change |
|---|---|
| `api/gemini/index.ts` | One line: `if (action === 'projects') return res.status(200).json(await handleProjects(req, member));` plus its error class in the existing status ladder. |
| `vercel.json` | One rewrite entry. |
| `lib/serverStore.ts` | One function, `transactTenantProject(orgId, projectId, updater)` — an RTDB transaction on `projects/{orgId}` mutating one project, modelled on the existing `replaceTenantWorkspace`. |
| `lib/nodeTypes.ts` + `types.ts` | Three lines for `GOOGLE_SHEET_UPSERT`, if §5's gap is closed. |

**Tests**

`tests/flowGraph.test.ts` is where the value is: one case per validation rule,
each asserting that a graph the engine would stall on is rejected. Plus
handler tests for revision conflicts, cross-tenant access, and node deletion
with dependants.

**Explicitly unchanged:** `lib/flowEngine.ts`, `lib/flowOrchestrator.ts`,
`lib/executeTask.ts`, `lib/serverFlow.ts`, `lib/scheduler.ts`, the RTDB layout,
`database.rules.json`, `PUT /api/workspace`, and the browser's Firebase save
path. No existing caller changes behaviour.

## 9. Sequencing

1. `lib/flowGraph/validate.ts` and its tests. Useful alone: run it over existing tenant projects to find flows already broken by an unvalidated write.
2. `transactTenantProject` and read endpoints (`GET` list and `GET ?id=`). Read-only, so nothing can regress.
3. Project-level writes — `create`, `PATCH`, `DELETE` — with templates.
4. Node operations.
5. `GOOGLE_SHEET_UPSERT`, if taken.

Steps 1 and 2 are independently shippable.

## 10. Open questions

**Should validation block a save or only warn?** Proposed: structural errors
block (`422`), resource-grant findings warn. A flow with a dangling branch
target is not a work in progress, it is a flow that will stall silently. But
blocking means an editor cannot save a half-built graph, which argues for a
`draft: true` flag that skips the check and refuses to let the scheduler start
the project. Worth deciding before step 3.

**Does `PUT /api/workspace` also get validated?** If not, the unvalidated path
stays open and flows can still be corrupted through it. If so, an existing
caller can start getting `422` on data it saved yesterday. Suggested: validate
and report, but only block on the new endpoint, until the fleet is known clean.

**Editing a running flow.** Nothing here prevents deleting a node whose
`actionConfig.lastRun.status` is `pending` — an action already dispatched, whose
webhook is still coming. The event would arrive for a node that no longer
exists. `lib/externalEvents.ts` already tolerates an unmatched run, but the
work is silently lost. Minimum: refuse to delete a node with a pending run, and
say so.

**Templates versus a graph, at creation.** `create` accepts either. If both are
supplied the request should be rejected rather than one silently winning.
