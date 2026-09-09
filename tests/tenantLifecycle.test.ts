import test from "node:test";
import assert from "node:assert/strict";
import {
  beginLifecycle,
  finishLifecycle,
  lifecycleRecord,
  redactTenantExport,
} from "../lib/tenantLifecycle/model.js";
test("lifecycle requires owner-service receipts, blocks in-flight work and replays without losing the review trail", () => {
  let state = lifecycleRecord(null);
  const input = {
    id: "suspend_001",
    actor: "owner",
    revision: 0,
    operation: "suspend" as const,
  };
  assert.throws(
    () => beginLifecycle(state, input),
    /Communications suspension/,
  );
  state.communicationsReceipt = {
    owner: "communications-service",
    status: "suspended",
    revision: 2,
  };
  state = beginLifecycle(state, input);
  assert.equal(state.state, "pausing");
  assert.deepEqual(beginLifecycle(state, input), state);
  state = finishLifecycle(state, input.id, {
    blockers: ["Pending calendar publication"],
  });
  assert.equal(state.state, "active");
  assert.equal(state.receipts[input.id].status, "blocked");
  state = beginLifecycle(state, {
    ...input,
    id: "suspend_002",
    revision: state.revision,
  });
  state = finishLifecycle(state, "suspend_002", {});
  state = beginLifecycle(state, {
    ...input,
    id: "erase_001",
    operation: "erase_database",
    revision: state.revision,
  });
  state = finishLifecycle(state, "erase_001", { counts: { projects: 1 } });
  assert.equal(state.state, "erased");
  assert.throws(
    () =>
      beginLifecycle(state, {
        ...input,
        id: "resume_001",
        operation: "resume",
        revision: state.revision,
      }),
    /cannot be reactivated/,
  );
  const busy = lifecycleRecord({
    storageLeases: { upload: { at: 1, path: "fixture" } },
  });
  assert.throws(
    () => beginLifecycle(busy, { ...input, operation: "resume" }),
    /file operation/,
  );
});
test("tenant exports preserve operational text but redact nested credentials and capability links", () => {
  const result: any = redactTenantExport({
    name: "Controlled report",
    secret: "private",
    nested: [
      { apiKey: "private", body: "The controlled report is due Friday" },
    ],
    url: "https://example.test/forms/ask/private",
  });
  assert.equal(result.secret, "[redacted]");
  assert.equal(result.nested[0].apiKey, "[redacted]");
  assert.equal(result.nested[0].body, "The controlled report is due Friday");
  assert.equal(result.url, "[redacted capability URL]");
});
