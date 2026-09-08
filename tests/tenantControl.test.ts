import test from "node:test";
import assert from "node:assert/strict";
import {
  handleClientControl,
  authenticateClient,
  requestScope,
} from "../lib/tenantControl/clients.js";
import type {
  TenantControl,
  ControlStore,
} from "../lib/tenantControl/model.js";
const setup = () => {
  const rows = new Map<string, TenantControl>();
  let queue = Promise.resolve();
  const store: ControlStore = {
    read: async (org) => structuredClone(rows.get(org) || null),
    transact: async (org, fn) => {
      const promise = queue.then(() => {
        const row = fn(structuredClone(rows.get(org) || null));
        rows.set(org, structuredClone(row));
        return structuredClone(row);
      });
      queue = promise.then(
        () => {},
        () => {},
      );
      return promise;
    },
  };
  const member = { orgId: "org_fixture", uid: "ceo", role: "owner" };
  let active = true;
  const membership = async () => {
    if (!active) throw new Error("Organization membership required");
    return member;
  };
  const post = (body: any, m = member) =>
    handleClientControl({ method: "POST", body }, m, store);
  const input = {
    operation: "create_client",
    requestId: "controlled_client",
    revision: 0,
    name: "Controlled reader",
    secret: "controlled_test_secret_not_production_001",
    expiresAt: Date.now() + 86400000,
    scopes: ["flows:read", "tenant:read"],
  };
  return {
    store,
    rows,
    member,
    post,
    input,
    membership,
    revokeMember: () => (active = false),
  };
};
test("client issuance replays without secret disclosure; scopes, tenant and membership are current", async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.post(f.input), f.post(f.input)]);
  assert.equal(a.item!.id, b.item!.id);
  assert.equal((a.item as any).secretHash, undefined);
  const token = a.credentialPrefix + f.input.secret;
  assert.equal(
    (await authenticateClient(token, "flows:read", f.store, f.membership))
      .apiClientId,
    a.item!.id,
  );
  await assert.rejects(
    authenticateClient(token, "flows:write", f.store, f.membership),
    /scope/,
  );
  await assert.rejects(
    authenticateClient(token, "flows:read", f.store, f.membership, "other"),
    /another organization/,
  );
  await assert.rejects(
    f.post({ ...f.input, name: "Changed" }),
    /identity conflict/,
  );
  f.revokeMember();
  await assert.rejects(
    authenticateClient(token, "flows:read", f.store, f.membership),
    /membership/,
  );
});
test("atomic request budget survives concurrency and credential rotation invalidates old secrets", async () => {
  const f = setup();
  const created = await f.post(f.input);
  let revision = created.revision;
  const token = created.credentialPrefix + f.input.secret;
  const budget = await f.post({ operation: "budget", revision, dailyLimit: 1 });
  revision = budget.revision;
  const results = await Promise.allSettled([
    authenticateClient(token, "flows:read", f.store, f.membership),
    authenticateClient(token, "flows:read", f.store, f.membership),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const view: any = await handleClientControl(
    { method: "GET" },
    f.member,
    f.store,
  );
  revision = view.revision;
  assert.equal(Object.values<any>(view.usage)[0].requests, 1);
  const secret = "replacement_controlled_secret_for_testing_002";
  const rotated = await f.post({
    operation: "rotate_client",
    id: created.item!.id,
    revision,
    secret,
    expiresAt: f.input.expiresAt,
  });
  const rotationReplay = await f.post({ operation: "rotate_client", id: created.item!.id, revision, secret, expiresAt: f.input.expiresAt });
  assert.equal(rotationReplay.revision, rotated.revision);
  assert.equal(JSON.stringify(rotationReplay).includes(secret), false);
  await assert.rejects(
    authenticateClient(token, "flows:read", f.store, f.membership),
    /Invalid/,
  );
  await f.post({
    operation: "budget",
    revision: rotated.revision,
    dailyLimit: 0,
  });
  await authenticateClient(
    created.credentialPrefix + secret,
    "flows:read",
    f.store,
    f.membership,
  );
  const latest = await f.store.read(f.member.orgId);
  const revoked = await f.post({
    operation: "revoke_client",
    id: created.item!.id,
    revision: latest!.revision,
  });
  await assert.rejects(
    authenticateClient(
      created.credentialPrefix + secret,
      "flows:read",
      f.store,
      f.membership,
    ),
    /Invalid/,
  );
  assert.equal(
    (
      await f.post({
        operation: "revoke_client",
        id: created.item!.id,
        revision: latest!.revision,
      })
    ).revision,
    revoked.revision,
  );
});
test("machine credentials cannot delegate authority and rewrite routing retains business scope", async () => {
  const f = setup();
  await assert.rejects(
    f.post(f.input, { ...f.member, apiClientId: "another" } as any),
    /human administrator/,
  );
  assert.equal(
    requestScope({
      url: "/api/gemini?action=publishing",
      query: { action: "publishing" },
      method: "POST",
    }),
    "publishing:write",
  );
  assert.equal(
    requestScope({
      url: "/api/communications/status",
      query: { action: "commitments" },
      method: "GET",
    }),
    "commitments:read",
  );
  for (const [action, scope] of Object.entries({
    google_start: "integrations:write",
    operations_replay: "operations:write",
    thread_correction: "thread-register:write",
    service_setup_validate: "service-projects:write",
  })) {
    assert.equal(
      requestScope({
        url: "/api/communications/status",
        query: { action },
        method: "POST",
      }),
      scope,
    );
  }
  assert.throws(
    () =>
      requestScope({
        url: "/api/communications/status",
        query: { action: "unrecognized" },
        method: "GET",
      }),
    /human session/,
  );
  assert.throws(
    () => requestScope({ url: "/api/events", method: "POST" }),
    /human session/,
  );
  const created = await f.post(f.input);
  f.rows.get(f.member.orgId)!.clients[created.item!.id].expiresAt = 1;
  await assert.rejects(
    authenticateClient(
      created.credentialPrefix + f.input.secret,
      "flows:read",
      f.store,
      f.membership,
    ),
    /expired/,
  );
});
