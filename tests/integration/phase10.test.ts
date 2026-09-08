import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
test("Phase 10 real publishing records enforce cold claims, separate approval and tenant isolation", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: "demo-hyperflow",
    client_email: "fixture@demo-hyperflow.iam.gserviceaccount.com",
    private_key: privateKey,
  });
  process.env.FIREBASE_DATABASE_URL = "https://demo-hyperflow.firebaseio.com";
  const { handlePublishing } = await import("../../lib/publishing/api"),
    { publishingStore, publishingRequest, publishingAdapters } =
      await import("../../lib/publishing/store"),
    { handleVisibleFlows } = await import("../../lib/visibleFlows/api"),
    { listTenantProjects, requireOrganizationMember } =
      await import("../../lib/serverStore"),
    { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
      projectId: "demo-hyperflow",
      database: {
        host: "127.0.0.1",
        port: 9010,
        rules: readFileSync("database.rules.json", "utf8"),
      },
    }),
    member = { orgId: "phase10_fixture", uid: "publishing_ceo" };
  let writes = 0,
    remote: any = null;
  const deps = {
    store: publishingStore,
    projects: listTenantProjects,
    membership: requireOrganizationMember,
    adapters: {
      fixture: {
        inspect: async () => null,
        publish: async (_t: any, input: any) => {
          writes++;
          remote = {
            id: "controlled-post",
            revision: "1",
            content: input.content,
            url: "https://example.com/controlled",
          };
          return { id: remote.id };
        },
        reconcile: async () => remote,
      },
    },
  };
  const post = async (body: any) =>
    (await handlePublishing(
      { method: "POST", body: { projectId: "alpha", ...body } },
      member,
      deps,
    )) as any;
  const read = async () =>
    (await handlePublishing(
      { method: "GET", query: { projectId: "alpha" } },
      member,
      deps,
    )) as any;
  try {
    await env.withSecurityRulesDisabled(async (c) => {
      await set(ref(c.database(), `users/${member.uid}`), {
        orgId: member.orgId,
      });
      await set(
        ref(
          c.database(),
          `organizations/${member.orgId}/members/${member.uid}`,
        ),
        { role: "owner" },
      );
      await set(ref(c.database(), `projects/${member.orgId}/projects/alpha`), {
        id: "alpha",
        name: "Controlled publishing project",
        milestones: [],
      });
    });
    const body = {
      operation: "create",
      requestId: "phase10-controlled",
      kind: "social",
      content: { title: "Controlled", text: "Fictional test content" },
      sourceNotes: "Synthetic; no public provider calls",
    };
    const created = await Promise.all([post(body), post(body)]);
    assert.equal(created[0].item.id, created[1].item.id);
    let p = created[0].item;
    publishingAdapters.fixture = deps.adapters.fixture;
    let flow: any = (
      (await publishingRequest(
        {
          method: "POST",
          body: {
            operation: "draft_flow",
            projectId: "alpha",
            id: p.id,
            revision: p.revision,
            contentHash: p.contentHash,
          },
        },
        member,
      )) as any
    ).item;
    const flowPost = async (body: any) =>
      (await handleVisibleFlows(
        { method: "POST", body: { id: flow.id, ...body } },
        member,
      )) as any;
    flow = (
      await flowPost({
        operation: "approve",
        version: 1,
        hash: flow.versions[0].hash,
        expectedRevision: flow.revision,
      })
    ).item;
    flow = (
      await flowPost({
        operation: "start",
        version: 1,
        hash: flow.versions[0].hash,
        expectedRevision: flow.revision,
        runKey: "phase10_publication_run",
      })
    ).item;
    flow = (
      await flowPost({ operation: "advance", runId: "phase10_publication_run" })
    ).item;
    assert.equal(
      flow.runs[0].snapshot.milestones[0].actionConfig.lastRun.status,
      "pending",
    );
    assert.equal(writes, 0);
    const reconcileFlow = () =>
      flowPost({
        operation: "reconcile_publication",
        runId: "phase10_publication_run",
        nodeId: "publication",
      });
    await assert.rejects(reconcileFlow(), /configured/);
    assert.equal((await read()).items.length, 1);
    await post({
      operation: "configure_target",
      revision: (await read()).revision,
      allowPublish: true,
      target: {
        id: "test-target",
        adapter: "fixture",
        kind: "social",
        label: "Controlled adapter fixture",
        resource: "fixture",
      },
    });
    p = (
      await post({
        operation: "preview",
        id: p.id,
        revision: p.revision,
        contentHash: p.contentHash,
        targetId: "test-target",
      })
    ).item;
    await assert.rejects(
      post({
        operation: "publish",
        id: p.id,
        revision: p.revision,
        contentHash: p.contentHash,
      }),
      /approval/,
    );
    p = (
      await post({
        operation: "approve",
        id: p.id,
        revision: p.revision,
        contentHash: p.contentHash,
        publicUseChecked: true,
      })
    ).item;
    const b = {
      operation: "publish",
      id: p.id,
      revision: p.revision,
      contentHash: p.contentHash,
    };
    const outcomes = await Promise.allSettled([post(b), post(b)]);
    assert.ok(outcomes.some((o) => o.status === "fulfilled"));
    assert.equal(writes, 1);
    const saved = await publishingStore.read(member.orgId, "alpha");
    assert.equal(saved!.items[p.id].state, "verified");
    assert.equal(saved!.items[p.id].ask!.status, "answered");
    flow = (await reconcileFlow()).item;
    assert.equal(flow.runs[0].status, "completed");
    assert.equal(writes, 1);
    remote.content = { ...remote.content, text: "Later manual edit" };
    await assert.rejects(reconcileFlow(), /not verified/);
    assert.equal(writes, 1);
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `publishing/${member.orgId}`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `publishing/${member.orgId}/alpha/items/forged`,
        ),
        { state: "approved" },
      ),
    );
    assert.equal(await publishingStore.read("other_tenant", "alpha"), null);
    await env.withSecurityRulesDisabled(async (c) =>
      set(
        ref(
          c.database(),
          `organizations/${member.orgId}/members/${member.uid}`,
        ),
        null,
      ),
    );
    await assert.rejects(read(), /membership|member|organization/i);
  } finally {
    delete publishingAdapters.fixture;
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
