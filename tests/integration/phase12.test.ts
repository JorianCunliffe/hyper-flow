import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
test("Phase 12 cross-channel contact to reviewed promise to weekly report preserves ownership and recovery receipts", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = "true";
  const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;
  assert.ok(checkout);
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
  const { createPhase02Database } = await import(
    pathToFileURL(resolve(checkout, "test/fixtures/phase02Database.js")).href
  );
  const member = { orgId: "phase12_fixture", uid: "office_ceo" },
    cs = await createPhase02Database(member.orgId, "phase12_key");
  process.env.COMMUNICATIONS_API_URL = await cs.app.listen({
    host: "127.0.0.1",
    port: 0,
  });
  process.env.COMMUNICATIONS_API_KEY = "phase12_key";
  const { handleArtifacts } = await import("../../lib/artifacts/api"),
    { handleVisibleFlows } = await import("../../lib/visibleFlows/api"),
    { handleCommitments } = await import("../../lib/commitments/api");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const post = async (body: any) =>
    (await handleArtifacts(
      { method: "POST", body: { projectId: "alpha", ...body } },
      member,
    )) as any;
  try {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.database();
      await set(ref(db, `users/${member.uid}`), { orgId: member.orgId });
      await set(
        ref(db, `organizations/${member.orgId}/members/${member.uid}`),
        { role: "owner" },
      );
      await set(ref(db, `projects/${member.orgId}/projects`), [
        {
          id: "alpha",
          name: "Controlled report project",
          company: "Fixture",
          type: "test",
          startDate: 1,
          createdAt: 1,
          updatedAt: 1,
          milestones: [],
        },
      ]);
    });
    const fixture = JSON.parse(readFileSync("contracts/threading.v1.json", "utf8"));
    const raw = async (path: string, body: any) => {
      const response = await fetch(process.env.COMMUNICATIONS_API_URL + "/v1/" + path, {
        method: "POST", headers: { "X-API-Key": "phase12_key", "X-Tenant-Id": member.orgId, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.ok, true, JSON.stringify(data));
      return data;
    };
    await raw("contacts", fixture.person);
    const journey: any[] = [];
    for (const communication of fixture.journey) journey.push(await raw("communications", { ...communication, direction: "inbound" }));
    const unrelated = await raw("communications", { ...fixture.unrelated, direction: "inbound" });
    assert.equal(new Set(journey.map(row => row.thread_id)).size, 1);
    assert.notEqual(unrelated.thread_id, journey[0].thread_id);
    const { HttpCommunicationsClient } = await import("../../lib/communications/client");
    const { handleThreadRegisterRequest } = await import("../../lib/communications/threadRegister");
    const client = new HttpCommunicationsClient();
    const register: any = await handleThreadRegisterRequest("thread_register", { method: "GET", query: { status: "all" } }, member, { client, listProjects: async () => [{ id: "alpha" }, { id: "beta" }] as any });
    assert.deepEqual(new Set(register.data.find((row: any) => row.thread_id === journey[0].thread_id).communications.map((row: any) => row.channel)), new Set(["email", "sms", "voice"]));
    const parties: any = await handleCommitments({ method: "GET", query: { view: "parties" } }, member);
    const contact = parties.data.find((row: any) => row.name === "Alex");
    assert.ok(contact?.id.startsWith("contact:"));
    let obligation: any = await handleCommitments(
      {
        method: "POST",
        body: {
          projectId: "alpha",
          terms: {
            owner: `user:${member.uid}`,
            beneficiary: contact.id,
            deliverable: "Produce the controlled weekly report",
            criteria: "Review the fixture file",
            dueAt: "2026-09-11T17:00:00+10:00",
            timezone: "Australia/Brisbane",
          },
        },
      },
      member,
    );
    const accepted: any = await handleCommitments(
      {
        method: "PATCH",
        body: {
          id: obligation.item.id,
          projectId: "alpha",
          action: "respond",
          expectedVersion: obligation.item.version,
          askId: obligation.item.review.ask.id,
          decision: "approved",
          note: "Controlled fixture acceptance",
        },
      },
      member,
    );
    assert.equal(accepted.item.state, "accepted");
    let flow = (
      await post({
        operation: "create_flow",
        templateId: "weekly-xlsx",
        templateVersion: 1,
      })
    ).item;
    const version = flow.versions[0];
    flow = (
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "approve",
            id: flow.id,
            version: 1,
            hash: version.hash,
            expectedRevision: flow.revision,
          },
        },
        member,
      )
    ).item!;
    const runKey = "phase12_report_run";
    flow = (
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "start",
            id: flow.id,
            version: 1,
            hash: version.hash,
            expectedRevision: flow.revision,
            runKey,
          },
        },
        member,
      )
    ).item!;
    flow = (
      await handleVisibleFlows(
        {
          method: "POST",
          body: { operation: "advance", id: flow.id, runId: runKey },
        },
        member,
      )
    ).item!;
    const waiting = flow.runs[0].snapshot.milestones[0].actionConfig!.lastRun!;
    assert.equal(waiting.status, "pending");
    assert.ok(waiting.output.artifact_job_id, JSON.stringify(waiting));
    let job: any = (
      (await handleArtifacts(
        {
          method: "GET",
          query: { projectId: "alpha", id: waiting.output.artifact_job_id },
        },
        member,
      )) as any
    ).item;
    assert.equal(job.inputs.rows.length, 1);
    assert.equal(job.inputs.totals.open, 1);
    assert.equal(job.ask.token, undefined);
    const reconcile = () =>
      handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "reconcile_artifact",
            id: flow.id,
            runId: runKey,
            nodeId: "office",
          },
        },
        member,
      );
    await assert.rejects(reconcile(), /requires review/);
    const action = (operation: string, extra = {}) =>
      post({
        operation,
        id: job.id,
        revision: job.revision,
        inputHash: job.inputHash,
        ...extra,
      });
    job = (await action("approve")).item;
    const concurrent = await Promise.allSettled([
      action("generate"),
      action("generate"),
    ]);
    assert.equal(
      concurrent.filter((r) => r.status === "fulfilled").length,
      1,
      JSON.stringify(
        concurrent.map((r) =>
          r.status === "rejected" ? String(r.reason) : r.status,
        ),
      ),
    );
    job = (
      (await handleArtifacts(
        { method: "GET", query: { projectId: "alpha", id: job.id } },
        member,
      )) as any
    ).item;
    assert.equal(job.status, "generated");
    await assert.rejects(reconcile(), /requires review/);
    job = (
      await action("review", {
        fileHash: job.receipt.sha256,
        visualChecked: true,
        contentChecked: true,
      })
    ).item;
    const completed: any = await reconcile();
    assert.equal(completed.item.runs[0].status, "completed");
    assert.equal(
      completed.item.runs[0].snapshot.milestones[0].actionConfig.lastRun.output
        .artifact_receipt.delivered,
      false,
    );
    const stillOwed: any = await handleCommitments({ method: "GET", query: { id: obligation.item.id } }, member);
    assert.equal(stillOwed.item.state, "accepted", "Producing a report is not fulfillment of the promise");
    assert.equal(stillOwed.item.terms.beneficiary, contact.id);
    assert.equal((await cs.sql.query("select count(*)::int n from outbound_operations")).rows[0].n, 0, "Fixture must never send email, SMS or voice");
    await assert.rejects(client.listThreadRegister("another_tenant"));
    const { handleLifecycle, lifecycleDependencies } = await import("../../lib/tenantLifecycle/api");
    const lifecycle = (body: any) => handleLifecycle({ method: "POST", headers: {}, body }, {
      ...lifecycleDependencies,
      requireFirebaseIdentity: async () => ({ uid: member.uid }) as any,
    });
    await assert.rejects(lifecycle({ operation: "suspend", revision: 1, requestId: "p12_wrong_order" }), /Suspend Communications/);
    const frozen: any = await lifecycle({ service: "communications", operation: "suspend", revision: 1, requestId: "p12_cs_suspend" });
    assert.equal(frozen.owner, "communications-service");
    assert.deepEqual(await lifecycle({ service: "communications", operation: "suspend", revision: 1, requestId: "p12_cs_suspend" }), frozen);
    const hfFrozen: any = await lifecycle({ operation: "suspend", revision: 0, requestId: "p12_hf_suspend" });
    assert.equal(hfFrozen.owner, "hyperflow");
    assert.equal(hfFrozen.lifecycle.state, "suspended");
    const { exportLifecycleChunk } = await import("../../lib/tenantLifecycle/store");
    const exported = await exportLifecycleChunk(member.orgId, member.uid, { dataset: "operational_commitments", revision: hfFrozen.lifecycle.revision, offset: 0 });
    assert.equal(exported.owner, "hyperflow");
    assert.equal(exported.communications, "separate export");
    const exportedBytes = Buffer.from(exported.content, "base64");
    assert.equal(createHash("sha256").update(exportedBytes).digest("hex"), exported.chunkSha256);
    assert.ok(exportedBytes.toString().includes(obligation.item.id));
    await assert.rejects(post({ operation: "create_flow", templateId: "weekly-xlsx", templateVersion: 1 }));
    const resumed: any = await lifecycle({ operation: "resume", revision: hfFrozen.lifecycle.revision, requestId: "p12_hf_resume" });
    assert.equal(resumed.lifecycle.state, "active");
    await lifecycle({ service: "communications", operation: "resume", revision: 2, requestId: "p12_cs_resume" });
    assert.equal((await client.getCommunication(member.orgId, journey[0].communication_id)).threadId, journey[0].thread_id);
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `artifacts/${member.orgId}`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `artifacts/${member.orgId}/jobs/forged`,
        ),
        { status: "reviewed" },
      ),
    );
    const { listArtifactRecords } = await import("../../lib/serverStore");
    assert.deepEqual(await listArtifactRecords("other_tenant"), []);
  } finally {
    await env.cleanup();
    await cs.close();
    await Promise.all(getApps().map(deleteApp));
  }
});
