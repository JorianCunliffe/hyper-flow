import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
test("Phase 09 real stores keep office flows waiting for file review, preserve cold claims and tenant isolation", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
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
  const member = { orgId: "phase09_fixture", uid: "office_ceo" },
    cs = await createPhase02Database(member.orgId, "phase09_key");
  process.env.COMMUNICATIONS_API_URL = await cs.app.listen({
    host: "127.0.0.1",
    port: 0,
  });
  process.env.COMMUNICATIONS_API_KEY = "phase09_key";
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
    let obligation: any = await handleCommitments(
      {
        method: "POST",
        body: {
          projectId: "alpha",
          terms: {
            owner: `user:${member.uid}`,
            beneficiary: `user:${member.uid}`,
            deliverable: "Produce the controlled weekly report",
            criteria: "Review the fixture file",
            dueAt: "2026-09-11T17:00:00+10:00",
            timezone: "Australia/Brisbane",
          },
        },
      },
      member,
    );
    await handleCommitments(
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
    const runKey = "phase09_report_run";
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
