import test from "node:test";
import assert from "node:assert/strict";
import { handlePublishing } from "../lib/publishing/api";
import type {
  PublishingStore,
  PublishingLedger,
  PublishingAdapter,
  PublicationObservation,
} from "../lib/publishing/model";
function fixture() {
  const rows = new Map<string, PublishingLedger>();
  let chain = Promise.resolve(),
    writes = 0,
    lost = false,
    role = "owner",
    revoked = false,
    remote: PublicationObservation | null = null;
  const store: PublishingStore = {
    read: async (o, p) => structuredClone(rows.get(o + "/" + p) || null),
    transact: async (o, p, update) => {
      let release!: () => void;
      const before = chain;
      chain = new Promise<void>((r) => (release = r));
      await before;
      try {
        const value = JSON.parse(
          JSON.stringify(
            update(structuredClone(rows.get(o + "/" + p) || null)),
          ),
        );
        rows.set(o + "/" + p, value);
        return structuredClone(value);
      } finally {
        release();
      }
    },
  };
  const provider: PublishingAdapter = {
    inspect: async (t) =>
      t.kind === "website" ? structuredClone(remote) : null,
    publish: async (_t, input) => {
      writes++;
      assert.deepEqual(Object.keys(input.content).sort(), ["text", "title"]);
      if (input.expectedRevision !== null)
        assert.equal(input.expectedRevision, remote?.revision);
      remote = {
        id: "post-one",
        revision: "provider-" + writes,
        content: structuredClone(input.content),
        url: "https://example.com/posts/one",
      };
      if (lost) throw new Error("Response lost after accepted write");
      return { id: remote.id };
    },
    reconcile: async () => structuredClone(remote),
  };
  const member = { orgId: "a", uid: "ceo" },
    deps = {
      store,
      projects: async () => [{ id: "alpha", name: "Alpha" }],
      membership: async () => {
        if (revoked) throw new Error("Membership revoked");
        return { role };
      },
      adapters: { fixture: provider },
    };
  const post = async (b: any, actor = member) =>
    (await handlePublishing(
      { method: "POST", body: { projectId: "alpha", ...b } },
      actor,
      deps,
    )) as any;
  const get = async (id?: string, actor = member) =>
    (await handlePublishing(
      { method: "GET", query: { projectId: "alpha", ...(id ? { id } : {}) } },
      actor,
      deps,
    )) as any;
  const create = async (kind = "social") =>
    (
      await post({
        operation: "create",
        requestId: "controlled-request",
        kind,
        content: {
          title: "Controlled draft",
          text: "A fictional public update.",
        },
        sourceNotes: "Synthetic material. No private source imports.",
      })
    ).item;
  const configure = async (kind = "social") =>
    post({
      operation: "configure_target",
      revision: (await get()).revision,
      allowPublish: true,
      target: {
        id: "target-one",
        adapter: "fixture",
        kind,
        label: "Controlled target",
        resource: "one",
      },
    });
  const action = async (p: any, operation: string, extra: any = {}) =>
    (
      await post({
        id: p.id,
        revision: p.revision,
        contentHash: p.contentHash,
        operation,
        ...extra,
      })
    ).item;
  const approved = async (kind = "social") => {
    let p = await create(kind);
    await configure(kind);
    p = await action(p, "preview", { targetId: "target-one" });
    return action(p, "approve", { publicUseChecked: true });
  };
  return {
    post,
    get,
    create,
    configure,
    action,
    approved,
    member,
    deps,
    rows,
    setRemote: (r: PublicationObservation) => (remote = r),
    setLost: (v: boolean) => (lost = v),
    setRole: (r: string) => (role = r),
    setRevoked: () => (revoked = true),
    getWrites: () => writes,
  };
}
test("publishing draft creation is replay-safe and source notes stay internal", async () => {
  const f = fixture(),
    p = await f.create(),
    again = await f.create();
  assert.equal(p.id, again.id);
  assert.equal((await f.get()).items.length, 1);
  assert.equal(JSON.stringify(p).includes("token"), false);
  await assert.rejects(
    f.post({
      operation: "create",
      requestId: "controlled-request",
      kind: "social",
      content: { title: "Different", text: "Different" },
      sourceNotes: "Synthetic",
    }),
    /different content/,
  );
  assert.equal(f.getWrites(), 0);
});
test("no provider or grant is assumed and nonadmins cannot configure public targets", async () => {
  const f = fixture(),
    p = await f.create();
  await assert.rejects(
    f.action(p, "preview", { targetId: "target-one" }),
    /configured target/,
  );
  f.deps.adapters = {} as any;
  await assert.rejects(f.configure(), /connect/);
  f.setRole("member");
  await assert.rejects(f.configure(), /administrator/);
  assert.equal(f.getWrites(), 0);
});
test("content edits preserve the old Ask and invalidate its approval", async () => {
  const f = fixture();
  let p = await f.approved();
  const approved = p;
  assert.equal(p.ask.status, "answered");
  p = await f.action(p, "edit", {
    content: { title: "Revised", text: "New content needs its own review" },
    sourceNotes: "Synthetic",
  });
  assert.equal(p.state, "draft");
  assert.equal(p.ask, undefined);
  assert.equal(p.history[0].ask.status, "answered");
  assert.equal((await f.create()).id, p.id);
  await assert.rejects(f.action(approved, "publish"), /changed/);
  await assert.rejects(f.action(p, "publish"), /provider|approval/);
  assert.equal(f.getWrites(), 0);
});
test("wrong reviewer and missing public-rights confirmation cannot approve", async () => {
  const f = fixture();
  let p = await f.create();
  await f.configure();
  p = await f.action(p, "preview", { targetId: "target-one" });
  await assert.rejects(f.action(p, "approve"), /public use/);
  await assert.rejects(
    f.post(
      {
        operation: "approve",
        id: p.id,
        revision: p.revision,
        contentHash: p.contentHash,
        publicUseChecked: true,
      },
      { orgId: "a", uid: "other-admin" },
    ),
    /designated/,
  );
});
test("concurrent publication dispatches once and receipt is independently read back", async () => {
  const f = fixture(),
    p = await f.approved();
  const results = await Promise.allSettled([
    f.action(p, "publish"),
    f.action(p, "publish"),
  ]);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  assert.equal(f.getWrites(), 1);
  const saved = (await f.get(p.id)).item;
  assert.equal(saved.state, "verified");
  assert.equal(saved.receipt.url, "https://example.com/posts/one");
  assert.equal((await f.action(saved, "publish")).state, "verified");
  assert.equal(f.getWrites(), 1);
});
test("lost accepted write is held and reconciled without a second publication", async () => {
  const f = fixture(),
    p = await f.approved();
  f.setLost(true);
  await assert.rejects(f.action(p, "publish"), /uncertain/);
  let held = (await f.get(p.id)).item;
  assert.equal(held.state, "uncertain");
  await assert.rejects(f.action(held, "publish"), /approval/);
  held = await f.action(held, "reconcile");
  assert.equal(held.state, "verified");
  assert.equal(f.getWrites(), 1);
  f.setRemote({
    id: "post-one",
    revision: "manual-change",
    content: { title: "Manual", text: "Preserve manual edits" },
    url: "https://example.com/posts/one",
  });
  await assert.rejects(f.action(held, "reconcile"), /not verified/);
  assert.equal((await f.get(p.id)).item.state, "uncertain");
  assert.equal(f.getWrites(), 1);
});
test("revoked grants and membership stop dispatch; another tenant cannot read drafts", async () => {
  const f = fixture(),
    p = await f.approved();
  await f.post({
    operation: "configure_target",
    enabled: false,
    target: { id: "target-one" },
    revision: (await f.get()).revision,
  });
  await assert.rejects(f.action(p, "publish"), /grant changed/);
  assert.deepEqual(
    (await f.get(undefined, { orgId: "b", uid: "ceo" })).items,
    [],
  );
  await assert.rejects(f.get(p.id, { orgId: "b", uid: "ceo" }), /not found/);
  f.setRevoked();
  await assert.rejects(f.get(), /revoked/);
  assert.equal(f.getWrites(), 0);
});
test("website changes pin the provider revision and never overwrite a later edit", async () => {
  const f = fixture();
  f.setRemote({
    id: "page",
    revision: "before",
    content: { title: "Before", text: "Original page" },
    url: "https://example.com/page",
  });
  const p = await f.approved("website");
  f.setRemote({
    id: "page",
    revision: "manual",
    content: { title: "Manual", text: "Changed after approval" },
    url: "https://example.com/page",
  });
  await assert.rejects(f.action(p, "publish"), /changed after approval/);
  assert.equal(f.getWrites(), 0);
  assert.equal((await f.get(p.id)).item.state, "uncertain");
});

test("preparing a replacement target preview retains previous approval evidence", async () => {
  const f = fixture();
  const p = await f.approved();
  const replacement = await f.action(p, "preview", { targetId: "target-one" });
  assert.equal(replacement.history[0].ask.status, "answered");
  assert.equal(replacement.ask.status, "open");
  assert.notEqual(replacement.ask.id, p.ask.id);
  await assert.rejects(f.action(p, "publish"), /changed/);
});
