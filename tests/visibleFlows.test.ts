import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePlan,
  normalizeFlow,
  type FlowPlan,
  type FlowRecord,
} from "../lib/visibleFlows/model.js";
import { handleVisibleFlows } from "../lib/visibleFlows/api.js";
import {
  advanceVisibleRun,
  settleVisibleCallback,
  executeVisibleStep,
} from "../lib/visibleFlows/runtime.js";
import type { FlowStore } from "../lib/visibleFlows/store.js";
import type { Project } from "../types.js";
const parent: Project = {
  id: "project-a",
  name: "Test",
  company: "Test",
  type: "test",
  startDate: 1,
  createdAt: 1,
  updatedAt: 1,
  milestones: [],
};
const member = { orgId: "tenant-a", uid: "ceo" };
test("channel execution preserves approved literals, checks current authority, and email only creates a draft", async () => {
  const run = {
    projectId: parent.id,
    snapshot: { ...parent, projectData: { to: "+19999999999" } },
    plan: { steps: [] },
  } as any;
  const step = {
    id: "sms",
    action: "send_sms",
    inputs: { to: "+61415828522", body: "Controlled message" },
    dependsOn: [],
  } as any;
  let dispatches = 0;
  const deps = {
    projectExists: async () => true,
    profile: async () => ({ automaticActions: ["send", "draft"] }) as any,
    executor: async (_task: string, template: string, data: any) => {
      dispatches++;
      assert.equal(JSON.parse(template).to, "+61415828522");
      assert.deepEqual(data, {});
      return { status: "pending" as const, externalId: "comm-test" };
    },
  };
  await executeVisibleStep(member.orgId, run, step, "stable-operation", deps);
  await assert.rejects(
    executeVisibleStep(member.orgId, run, step, "stable-operation", {
      ...deps,
      profile: async () => ({ automaticActions: [] }) as any,
    }),
    /policy/,
  );
  assert.equal(dispatches, 1);
  const draft = {
    ...step,
    action: "draft_email",
    inputs: {
      connectionId: "mailbox",
      to: "fixture@example.test",
      subject: "Review",
      body: "Draft only",
    },
  };
  const result = await executeVisibleStep(
    member.orgId,
    run,
    draft,
    "stable-draft",
    {
      ...deps,
      client: {
        getMemoryContext: async () => {
          throw new Error("unexpected");
        },
        createMailboxDraft: async (org, connection, input, key) => {
          assert.equal(org, member.orgId);
          assert.equal(connection, "mailbox");
          assert.equal(key, "stable-draft");
          assert.deepEqual(input.to, ["fixture@example.test"]);
          return {
            id: "draft",
            provider_draft_id: "provider-draft",
            status: "created",
          };
        },
      },
    },
  );
  assert.equal(result.output.email_sent, false);
  assert.equal(dispatches, 1);
});
const plan: FlowPlan = {
  name: "Supplier update report",
  steps: [
    {
      id: "evidence",
      name: "Read project evidence",
      action: "read_context",
      owner: "CEO",
      dependsOn: [],
      inputs: {},
      sources: [],
    },
    {
      id: "report",
      name: "Prepare report draft",
      action: "write_report",
      owner: "CEO",
      dependsOn: ["evidence"],
      inputs: {
        prompt: "Summarize evidence and explicitly identify missing updates.",
      },
      sources: [],
    },
  ],
};
function fixture() {
  const rows = new Map<string, FlowRecord>();
  let tail = Promise.resolve();
  const store: FlowStore = {
    read: async (org, id) => structuredClone(rows.get(org + id) || null),
    list: async (org) =>
      [...rows]
        .filter(([key]) => key.startsWith(org))
        .map(([, r]) => structuredClone(r)),
    transact: async (org, id, update) => {
      let release!: () => void;
      const prior = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        const row = normalizeFlow(
          JSON.parse(
            JSON.stringify(update(structuredClone(rows.get(org + id) || null))),
          ),
        );
        rows.set(org + id, row);
        return structuredClone(row);
      } finally {
        release();
      }
    },
  };
  const deps = { store, projects: async () => [parent] };
  const request = (body: any, actor = member) =>
    handleVisibleFlows({ method: "POST", body }, actor, deps);
  return { store, request, deps };
}
test("catalog compiler rejects fictional tools, cycles, unknown inputs and invented recipient formats; missing facts stay visible", () => {
  assert.throws(
    () =>
      validatePlan({
        ...plan,
        steps: [{ ...plan.steps[0], action: "publish_anywhere" }],
      }),
    /Unsupported action/,
  );
  assert.throws(
    () =>
      validatePlan({
        ...plan,
        steps: [{ ...plan.steps[0], dependsOn: ["report"] }, plan.steps[1]],
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      validatePlan({
        ...plan,
        steps: [{ ...plan.steps[0], inputs: { grant: "admin" } }],
      }),
    /Unsupported input/,
  );
  const missing = validatePlan({
    name: "Chase",
    steps: [
      {
        id: "sms",
        name: "Send update request",
        action: "send_sms",
        owner: "",
        dependsOn: [],
        inputs: { to: "", body: "" },
        sources: [],
      },
    ],
  }).missing;
  assert.deepEqual(missing, ["sms.owner", "sms.to", "sms.body"]);
});
test("version approval, durable concurrent dispatch, completed review and template isolation", async () => {
  const { store, request } = fixture();
  let row = (await request({ operation: "create", projectId: parent.id, plan }))
    .item!;
  await assert.rejects(
    request({
      operation: "start",
      id: row.id,
      expectedRevision: row.revision,
      version: 1,
      hash: row.versions[0].hash,
      runKey: "run_test_1",
    }),
    /approved/,
  );
  row = (
    await request({
      operation: "approve",
      id: row.id,
      expectedRevision: row.revision,
      version: 1,
      hash: row.versions[0].hash,
    })
  ).item!;
  const start = {
    operation: "start",
    id: row.id,
    expectedRevision: row.revision,
    version: 1,
    hash: row.versions[0].hash,
    runKey: "run_test_1",
  };
  row = (await request(start)).item!;
  assert.equal(
    (await request(start)).item!.runs.length,
    1,
    "lost start response retry returns original run",
  );
  const counts = new Map<string, number>();
  const execute = async (_org: any, _run: any, step: any) => {
    counts.set(step.id, (counts.get(step.id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 5));
    return { status: "success" as const, output: { evidence: "source-a" } };
  };
  await Promise.all([
    advanceVisibleRun(member.orgId, row.id, "run_test_1", { store, execute }),
    advanceVisibleRun(member.orgId, row.id, "run_test_1", { store, execute }),
  ]);
  row = (await store.read(member.orgId, row.id))!;
  assert.equal(row.runs[0].status, "completed");
  assert.deepEqual(
    [...counts],
    [
      ["evidence", 1],
      ["report", 1],
    ],
  );
  await advanceVisibleRun(member.orgId, row.id, "run_test_1", {
    store,
    execute,
  });
  assert.equal(counts.get("report"), 1);
  row = (
    await request({
      operation: "revise",
      id: row.id,
      expectedRevision: row.revision,
      plan: { ...plan, name: "Updated template" },
    })
  ).item!;
  assert.equal(row.runs[0].snapshot.name, plan.name);
  assert.equal(row.runs[0].version, 1);
  assert.equal(row.versions[1].approvedBy, undefined);
  await assert.rejects(
    request({
      operation: "promote",
      id: row.id,
      expectedRevision: row.revision,
      runId: "run_test_1",
    }),
    /Review/,
  );
  row = (
    await request({
      operation: "review",
      id: row.id,
      expectedRevision: row.revision,
      runId: "run_test_1",
    })
  ).item!;
  row = (
    await request({
      operation: "promote",
      id: row.id,
      expectedRevision: row.revision,
      runId: "run_test_1",
    })
  ).item!;
  assert.equal(row.versions[2].approvedBy, undefined);
  assert.equal(row.versions[2].plan.name, plan.name);
  await assert.rejects(
    request(
      { operation: "advance", id: row.id, runId: "run_test_1" },
      { ...member, orgId: "tenant-b" },
    ),
    /not found/,
  );
});
test("pending dispatch survives replay; exact callbacks settle after cancellation without advancing", async () => {
  const { store, request } = fixture();
  let row = (await request({ operation: "create", projectId: parent.id, plan }))
    .item!;
  row = (
    await request({
      operation: "approve",
      id: row.id,
      expectedRevision: row.revision,
      version: 1,
      hash: row.versions[0].hash,
    })
  ).item!;
  row = (
    await request({
      operation: "start",
      id: row.id,
      expectedRevision: row.revision,
      version: 1,
      hash: row.versions[0].hash,
      runKey: "pending_1",
    })
  ).item!;
  let count = 0;
  const execute = async () => {
    count++;
    return { status: "pending" as const, externalId: "comm-1" };
  };
  await advanceVisibleRun(member.orgId, row.id, "pending_1", {
    store,
    execute,
  });
  await advanceVisibleRun(member.orgId, row.id, "pending_1", {
    store,
    execute,
  });
  assert.equal(count, 1);
  row = (await store.read(member.orgId, row.id))!;
  row = (
    await request({
      operation: "cancel",
      id: row.id,
      expectedRevision: row.revision,
      runId: "pending_1",
    })
  ).item!;
  const match = {
    nodeId: "evidence",
    runId: `vf:${row.id}:pending_1:evidence`,
    externalId: "comm-1",
  };
  assert.equal(
    (await settleVisibleCallback(
      member.orgId,
      "other-project",
      match,
      { status: "success" },
      { store, execute },
    ))!.ok,
    false,
  );
  assert.equal(
    (await settleVisibleCallback(
      member.orgId,
      parent.id,
      { ...match, externalId: "wrong" },
      { status: "success" },
      { store, execute },
    ))!.ok,
    false,
  );
  await settleVisibleCallback(
    member.orgId,
    parent.id,
    match,
    { status: "success", output: { receipt: "received" } },
    { store, execute },
  );
  row = (await store.read(member.orgId, row.id))!;
  assert.equal(row.runs[0].status, "cancelled");
  assert.equal(
    row.runs[0].snapshot.milestones[0].actionConfig!.lastRun!.status,
    "success",
  );
  assert.equal(count, 1);
});
test("missing-input Ask is separate from approval; timeout and failed operations never redispatch", async () => {
  const { store, request } = fixture();
  let row = (
    await request({
      operation: "create",
      projectId: parent.id,
      plan: {
        ...plan,
        steps: [{ ...plan.steps[1], dependsOn: [], inputs: { prompt: "" } }],
      },
    })
  ).item!;
  assert.equal(row.versions[0].ask.kind, "question");
  await assert.rejects(
    request({
      operation: "approve",
      id: row.id,
      expectedRevision: row.revision,
      version: 1,
      hash: row.versions[0].hash,
    }),
    /complete version/,
  );
  row = (
    await request({
      operation: "revise",
      id: row.id,
      expectedRevision: row.revision,
      plan,
    })
  ).item!;
  assert.equal(row.versions[0].ask.status, "answered");
  assert.equal(row.versions[1].ask.kind, "approval");
  row = (
    await request({
      operation: "approve",
      id: row.id,
      expectedRevision: row.revision,
      version: 2,
      hash: row.versions[1].hash,
    })
  ).item!;
  row = (
    await request({
      operation: "start",
      id: row.id,
      expectedRevision: row.revision,
      version: 2,
      hash: row.versions[1].hash,
      runKey: "timeout_test",
    })
  ).item!;
  let count = 0;
  const execute = async () => {
    count++;
    return new Promise<any>(() => {});
  };
  await advanceVisibleRun(member.orgId, row.id, "timeout_test", {
    store,
    execute,
    timeoutMs: 2,
  });
  await advanceVisibleRun(member.orgId, row.id, "timeout_test", {
    store,
    execute,
    timeoutMs: 2,
  });
  assert.equal(count, 1);
  assert.match(
    (await store.read(member.orgId, row.id))!.runs[0].snapshot.milestones[0]
      .actionConfig!.lastRun!.logs![0],
    /unknown/,
  );
});
