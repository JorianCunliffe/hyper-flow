import test from "node:test";
import assert from "node:assert/strict";
import {
  handleLifecycle,
  lifecycleDependencies,
} from "../lib/tenantLifecycle/api";
import { lifecycleRecord } from "../lib/tenantLifecycle/model";
function fixture() {
  let state = lifecycleRecord(null),
    status = "active",
    effects = 0,
    failAudit = false;
  const replies = new Map();
  const calls: any[] = [];
  const deps: any = {
    ...lifecycleDependencies,
    requireFirebaseIdentity: async () => ({ uid: "owner_fixture" }),
    lifecycleOwner: async (uid: string) => ({
      uid,
      orgId: "tenant_fixture",
      role: "owner",
    }),
    readLifecycle: async () => state,
    transactLifecycle: async (_org: string, fn: any) => {
      const next = fn(structuredClone(state));
      if (
        failAudit &&
        Object.values<any>(next.receipts).some((r) => r.status === "completed")
      ) {
        failAudit = false;
        throw new Error("Controlled audit response loss");
      }
      state = next;
      return state;
    },
    changeDatabaseLifecycle: async (org: string, actor: string, input: any) => {
      calls.push({ org, actor, input });
      return state;
    },
    communications: () => ({
      readTenantLifecycle: async (org: string) => {
        calls.push({ org });
        return {
          owner: "communications-service",
          tenant: { status, lifecycle_revision: 2 },
        };
      },
      changeTenantLifecycle: async (org: string, body: any) => {
        calls.push({ org, body });
        if (!replies.has(body.requestId)) {
          effects++;
          replies.set(body.requestId, {
            owner: "communications-service",
            status: "suspended",
            revision: 2,
          });
        }
        return replies.get(body.requestId);
      },
    }),
  };
  return {
    deps,
    calls,
    get state() {
      return state;
    },
    get effects() {
      return effects;
    },
    suspend() {
      status = "suspended";
    },
    close() { status = 'closed'; },
    loseAudit() {
      failAudit = true;
    },
  };
}
test("lifecycle composition derives the owner tenant and ignores claimed service receipts", async () => {
  const f = fixture(),
    req = {
      headers: {},
      method: "POST",
      body: {
        operation: "suspend",
        requestId: "suspend_fixture",
        revision: 0,
        orgId: "other",
        communicationsReceipt: { status: "suspended" },
      },
    };
  await assert.rejects(handleLifecycle(req, f.deps), /Suspend Communications/);
  assert.equal(f.calls[0].org, "tenant_fixture");
  f.suspend();
  await handleLifecycle(req, f.deps);
  assert.equal(f.calls.at(-1).org, "tenant_fixture");
  assert.equal(f.calls.at(-1).actor, "owner_fixture");
  assert.equal(
    f.calls.at(-1).input.communicationsReceipt.owner,
    "communications-service",
  );
});
test('database erasure requires authoritative Communications closure and derives the human tenant', async () => {
  const f = fixture();
  let invoked = false;
  f.deps.eraseDatabaseRecords = async (org: string, actor: string, input: any) => {
    invoked = true;
    assert.equal(org, 'tenant_fixture');
    assert.equal(actor, 'owner_fixture');
    assert.deepEqual(input.communicationsReceipt, { owner: 'communications-service', status: 'closed', revision: 2 });
    return { state: 'erased' };
  };
  const req = { headers: {}, method: 'POST', body: { operation: 'erase_database', orgId: 'other', communicationsReceipt: { status: 'closed', revision: 999 }, requestId: 'erase_fixture', revision: 3, confirmation: 'Erase HyperFlow database records', backupReviewed: true } };
  await assert.rejects(handleLifecycle(req, f.deps), /Communications local erasure first/);
  assert.equal(invoked, false);
  f.close();
  const r = await handleLifecycle(req, f.deps);
  assert.equal(r.lifecycle.state, 'erased');
  assert.equal(r.files, 'retained for separate cleanup');
});
test("forwarded lifecycle commands preserve human audit and reconcile a lost receipt without another service effect", async () => {
  const f = fixture();
  f.loseAudit();
  const req = {
    headers: {},
    method: "POST",
    body: {
      service: "communications",
      operation: "suspend",
      revision: 1,
      requestId: "forward_fixture",
    },
  };
  await assert.rejects(handleLifecycle(req, f.deps), /audit response loss/);
  assert.equal(f.state.receipts.forward_fixture.status, "working");
  const result = await handleLifecycle(req, f.deps);
  assert.equal(result.owner, "communications-service");
  assert.equal(f.effects, 1);
  assert.equal(f.state.receipts.forward_fixture.actor, "owner_fixture");
  assert.equal(f.state.receipts.forward_fixture.status, "completed");
  await handleLifecycle(req, f.deps);
  assert.equal(f.effects, 1);
  await assert.rejects(
    handleLifecycle(
      { ...req, body: { ...req.body, operation: "resume" } },
      f.deps,
    ),
    /identity conflict/,
  );
});
test("owner denial prevents lifecycle reads and commands", async () => {
  const f = fixture();
  f.deps.lifecycleOwner = async () => {
    throw new Error("Current organization owner required");
  };
  await assert.rejects(
    handleLifecycle({ headers: {}, method: "GET" }, f.deps),
    /owner required/,
  );
  assert.equal(f.calls.length, 0);
});
