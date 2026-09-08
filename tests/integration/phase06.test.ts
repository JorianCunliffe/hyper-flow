import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";

test("Phase 06 actual Firebase cold transactions, claim concurrency and direct-client isolation", async () => {
  assert.equal(
    process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    "127.0.0.1:9010",
    "Only run against local emulator",
  );
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
  const { handleVisibleFlows } = await import("../../lib/visibleFlows/api");
  const { advanceVisibleRun } = await import("../../lib/visibleFlows/runtime");
  const { readVisibleFlow } = await import("../../lib/serverStore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const member = { orgId: "phase06_fixture", uid: "ceo" };
  const deps = {
    projects: async () => [
      {
        id: "alpha",
        name: "Fixture",
        company: "Fixture",
        type: "test",
        startDate: 1,
        createdAt: 1,
        updatedAt: 1,
        milestones: [],
      },
    ],
  };
  const request = (body: any) =>
    handleVisibleFlows({ method: "POST", body }, member, deps);
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await set(
        ref(context.database(), `organizations/${member.orgId}/members/ceo`),
        { role: "owner" },
      );
    });
    let row = (
      await request({
        operation: "create",
        projectId: "alpha",
        plan: {
          name: "Fixture",
          steps: [
            {
              id: "source",
              name: "Read source",
              action: "read_context",
              owner: "CEO",
              dependsOn: [],
              inputs: {},
              sources: [],
            },
          ],
        },
      })
    ).item!;
    const path = `visible_flows/${member.orgId}/${row.id}`;
    const roundtrip = (await readVisibleFlow(member.orgId, row.id))!;
    assert.deepEqual(roundtrip.runs, []);
    assert.deepEqual(roundtrip.versions[0].missing, []);
    assert.deepEqual(roundtrip.versions[0].ask.responses, []);
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
        runKey: "firebase_test_1",
      })
    ).item!;
    let dispatches = 0;
    const execute = async () => {
      dispatches++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        status: "success" as const,
        output: { receipt: "fixture_source" },
      };
    };
    await Promise.all([
      advanceVisibleRun(member.orgId, row.id, "firebase_test_1", { execute }),
      advanceVisibleRun(member.orgId, row.id, "firebase_test_1", { execute }),
    ]);
    assert.equal(dispatches, 1);
    const saved = (await readVisibleFlow(member.orgId, row.id))!;
    assert.equal(saved.runs[0].status, "completed");
    await assertFails(
      get(ref(env.authenticatedContext("ceo").database(), path)),
    );
    await assertFails(
      set(ref(env.authenticatedContext("ceo").database(), path), {
        versions: [{ approvedBy: "ceo" }],
      }),
    );
    assert.equal(await readVisibleFlow("other_tenant", row.id), null);
  } finally {
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
