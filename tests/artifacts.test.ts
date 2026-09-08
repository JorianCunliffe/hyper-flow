import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { handleArtifacts } from "../lib/artifacts/api";
import { renderArtifact } from "../lib/artifacts/render";
import { ReportSheetProvider, sheetRows } from "../lib/artifacts/sheets";
import {
  validateTemplate,
  ArtifactError,
  hash,
  reportInputs,
  BUILTIN_TEMPLATES,
  normalizeJob,
  type ArtifactJob,
} from "../lib/artifacts/model";
import type { ArtifactStore } from "../lib/artifacts/store";
import type { OperatingSnapshot } from "../lib/cockpit/model";
const member = { orgId: "tenant-a", uid: "ceo" };
export const snapshot: OperatingSnapshot = {
  owner: "hyperflow",
  viewerUid: "ceo",
  asOf: "2026-09-09T00:00:00Z",
  timezone: "Australia/Brisbane",
  contacts: [],
  flows: [],
  incomplete: false,
  notices: [],
  items: [
    {
      id: "ob_one",
      version: 2,
      projectId: "alpha",
      deliverable: "Prepare the weekly report",
      owner: "user:ceo",
      beneficiary: "user:ceo",
      dueAt: "2026-09-08T02:00:00Z",
      timezone: "Australia/Brisbane",
      state: "accepted",
      needsDecision: false,
      reviewerUid: "ceo",
      updatedAt: 1,
      sourceChanged: false,
      sourceCommunicationIds: ["comm_one"],
    },
    {
      id: "ob_two",
      version: 4,
      projectId: "alpha",
      deliverable: "Confirm the supplier delivery",
      owner: "person:supplier",
      beneficiary: "user:ceo",
      dueAt: "2026-09-09T00:00:00Z",
      timezone: "Australia/Brisbane",
      state: "fulfilled",
      needsDecision: false,
      reviewerUid: "ceo",
      updatedAt: 1,
      sourceChanged: false,
      sourceCommunicationIds: ["comm_two"],
    },
  ],
};
const memory = {
  contract_version: "memory-context.v1" as const,
  data: [{ communication_id: "comm_one", text: "I will prepare the report." }],
  memory_status: {
    state: "current" as const,
    retrieved_at: snapshot.asOf,
    evidence_only: true,
  },
};
function fixture() {
  const rows = new Map<string, any>();
  let tail = Promise.resolve();
  let renders = 0;
  const store: ArtifactStore = {
    read: async (o, k, id) => structuredClone(rows.get(o + k + id) || null),
    list: async (o) =>
      [...rows]
        .filter(([k]) => k.startsWith(o + "jobs"))
        .map(([, v]) => structuredClone(v)),
    transact: async (o, k, id, update) => {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((r) => (release = r));
      await previous;
      try {
        const v = JSON.parse(
          JSON.stringify(update(structuredClone(rows.get(o + k + id) || null))),
        );
        rows.set(o + k + id, v);
        return structuredClone(v);
      } finally {
        release();
      }
    },
  };
  const deps = {
    connections: async () => [],
    resources: async () => [
      {
        id: "sheet-fixture",
        name: "Fixture reports",
        canEdit: true,
        kind: "spreadsheet" as const,
      },
    ],
    store,
    projects: async () => [{ id: "alpha", name: "Alpha project" }] as any,
    membership: async () => ({ role: "owner" }) as any,
    snapshot: async () => structuredClone(snapshot),
    memory: async (_org, request) => { assert.equal(request.kind,"evidence"); assert.deepEqual(request.allowed_project_ids,["alpha"]); return structuredClone(memory); },
    render: async (j: ArtifactJob) => {
      renders++;
      return renderArtifact(j);
    },
  };
  const post = async (body: any, actor = member) =>
    (await handleArtifacts(
      { method: "POST", body: { projectId: "alpha", ...body } },
      actor,
      deps,
    )) as any;
  const prepare = (format = "docx", requestId = "request-one") =>
    post({
      operation: "prepare",
      requestId,
      templateId: "weekly-" + format,
      templateVersion: 1,
      periodStart: "2026-09-02T00:00:00Z",
      cutoff: "2026-09-09T00:00:00Z",
    });
  const action = (j: ArtifactJob, operation: string, extra = {}) =>
    post({
      operation,
      id: j.id,
      revision: j.revision,
      inputHash: j.inputHash,
      ...extra,
    });
  return { rows, store, deps, post, prepare, action, renders: () => renders };
}
test("artifact inputs reconcile current accepted states and exclusive deadline cutoff", () => {
  const i = reportInputs(
    { id: "alpha", name: "Alpha" },
    "2026-09-02T00:00:00Z",
    "2026-09-09T00:00:00Z",
    snapshot,
    memory,
  );
  assert.deepEqual(i.totals, {
    accepted: 2,
    open: 1,
    fulfilled: 1,
    dueInPeriod: 1,
    overdue: 1,
  });
  assert.ok(i.notices.some((x) => x.includes("not a historical")));
  assert.throws(
    () =>
      reportInputs(
        { id: "alpha", name: "A" },
        i.periodStart,
        i.cutoff,
        { ...snapshot, incomplete: true },
        memory,
      ),
    ArtifactError,
  );
  assert.throws(
    () =>
      reportInputs(
        { id: "alpha", name: "A" },
        i.periodStart,
        i.cutoff,
        snapshot,
        {
          ...memory,
          memory_status: { ...memory.memory_status, state: "stale" },
        },
      ),
    ArtifactError,
  );
});
test("artifact generation requires exact input approval and separate exact-file review", async () => {
  const f = fixture();
  let j = (await f.prepare()).item;
  assert.equal(j.ask.token, undefined);
  await assert.rejects(f.action(j, "generate"), /Approve/);
  await assert.rejects(
    f.post(
      {
        operation: "approve",
        id: j.id,
        revision: j.revision,
        inputHash: j.inputHash,
      },
      { ...member, uid: "other" },
    ),
    /designated/,
  );
  await assert.rejects(
    f.action(j, "approve", { inputHash: "wrong" }),
    /changed/,
  );
  j = (await f.action(j, "approve")).item;
  j = (await f.action(j, "generate")).item;
  assert.equal(j.receipt.visual, "pending");
  assert.equal(j.receipt.delivered, false);
  await assert.rejects(
    f.action(j, "review", {
      fileHash: "wrong",
      visualChecked: true,
      contentChecked: true,
    }),
    /Inspect/,
  );
  j = (
    await f.action(j, "review", {
      fileHash: j.receipt.sha256,
      visualChecked: true,
      contentChecked: true,
    })
  ).item;
  assert.equal(j.status, "reviewed");
  assert.equal(j.receipt.delivered, false);
});
test("concurrent generation and repeated requests retain one immutable output", async () => {
  const f = fixture();
  let j = (await f.prepare()).item;
  assert.equal((await f.prepare()).item.id, j.id);
  await assert.rejects(f.prepare("xlsx"), /different/);
  j = (await f.action(j, "approve")).item;
  const outcomes = await Promise.allSettled([
    f.action(j, "generate"),
    f.action(j, "generate"),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(f.renders(), 1);
  const current = await f.store.read<ArtifactJob>(member.orgId, "jobs", j.id);
  assert.equal(
    (await f.action(current!, "generate")).item.receipt.sha256,
    current!.receipt!.sha256,
  );
});
test("tenant isolation and file integrity fail closed", async () => {
  const f = fixture();
  let j = (await f.prepare()).item;
  await assert.rejects(
    handleArtifacts(
      { method: "GET", query: { projectId: "alpha", id: j.id } },
      { ...member, orgId: "tenant-b" },
      f.deps,
    ),
    /not found/,
  );
  j = (await f.action(j, "approve")).item;
  j = (await f.action(j, "generate")).item;
  f.rows.get(member.orgId + "files" + j.id).base64 =
    Buffer.from("corruption").toString("base64");
  await assert.rejects(
    handleArtifacts(
      {
        method: "GET",
        query: { projectId: "alpha", id: j.id, operation: "download" },
      },
      member,
      f.deps,
    ),
    /integrity/,
  );
});
test("saved artifact is reconciled after job receipt persistence fails without regenerating", async () => {
  const f = fixture();
  let j = (await f.prepare()).item;
  j = (await f.action(j, "approve")).item;
  const original = f.store.transact;
  let fail = true;
  f.store.transact = async (o, k, id, update) =>
    original(o, k, id, (current: any) => {
      const next: any = update(current);
      if (k === "jobs" && next.status === "generated" && fail) {
        fail = false;
        throw new Error("lost receipt storage");
      }
      return next;
    });
  await assert.rejects(f.action(j, "generate"), /lost receipt/);
  j = await f.store.read(member.orgId, "jobs", j.id);
  assert.equal(j.status, "failed");
  j = (await f.action(j, "reconcile")).item;
  assert.equal(j.status, "generated");
  assert.equal(f.renders(), 1);
  assert.equal(j.reviewAsk.status, "open");
});
test("template registry preserves immutable versions and rejects stale writers and nonadministrators", async () => {
  const f = fixture();
  const template = {
    id: "ceo-report",
    name: "CEO report",
    format: "docx",
    brand: { name: "Fixture brand", accent: "123456", font: "Arial" },
  };
  await f.post({ operation: "save_template", revision: 0, template });
  await assert.rejects(
    f.post({ operation: "save_template", revision: 0, template }),
    /changed/,
  );
  const r = await f.post({
    operation: "save_template",
    revision: 1,
    template: { ...template, name: "Updated" },
  });
  assert.deepEqual(
    r.registry.templates.map((t: any) => t.version),
    [1, 2],
  );
  assert.equal(r.registry.templates[0].name, "CEO report");
  f.deps.membership = async () => ({ role: "member" }) as any;
  await assert.rejects(
    f.post({ operation: "save_template", revision: 2, template }),
    /administrator/,
  );
});
test("all Office packages contain editable source references and typed workbook formulas", async () => {
  const f = fixture();
  for (const format of ["docx", "pptx", "xlsx"]) {
    const j = (await f.prepare(format, "format-" + format)).item;
    const result = await renderArtifact(j);
    assert.equal(hash(result.bytes), result.receipt.sha256);
    const zip = await JSZip.loadAsync(result.bytes, { checkCRC32: true });
    assert.ok(zip.file("[Content_Types].xml"));
    if (format === "docx")
      assert.match(
        await zip.file("word/document.xml")!.async("string"),
        /comm_one/,
      );
    if (format === "pptx") {
      const slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/);
      assert.ok(slides.length >= 5);
      assert.match(
        (await Promise.all(slides.map((s) => s.async("string")))).join(""),
        /comm_one/,
      );
    }
    if (format === "xlsx") {
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(result.bytes as any);
      assert.equal(w.getWorksheet("Weekly report")!.getCell("B7").result, 2);
      assert.equal(w.getWorksheet("Weekly report")!.getCell("B8").result, 1);
      assert.ok(
        w.getWorksheet("Accepted work")!.getCell("G2").value instanceof Date,
      );
      assert.equal(
        w.getWorksheet("Accepted work")!.getCell("K2").formula,
        'IF(OR(F2="fulfilled",F2="cancelled"),0,1)',
      );
      assert.equal(w.getWorksheet("Evidence")!.getCell("C2").value, "comm_one");
    }
  }
});
test("Firebase omitted empty arrays normalize without changing the report meaning", async () => {
  const f = fixture();
  const j = (await f.prepare()).item;
  delete j.inputs.evidence;
  j.inputs.rows[0].sourceCommunicationIds = undefined;
  const normal = normalizeJob(j);
  assert.deepEqual(normal.inputs.evidence, []);
  assert.deepEqual(normal.inputs.rows[0].sourceCommunicationIds, []);
  const result = await renderArtifact(normal);
  assert.ok(result.bytes.length > 1000);
});
test("Google report export creates one tab atomically and preserves subsequent manual edits", async () => {
  const f = fixture();
  let j = (await f.prepare("xlsx")).item;
  j = (await f.action(j, "approve")).item;
  j = (await f.action(j, "generate")).item;
  j = (
    await f.action(j, "review", {
      fileHash: j.receipt.sha256,
      visualChecked: true,
      contentChecked: true,
    })
  ).item;
  let writes = 0,
    tab: any = null,
    values: any[][] = [],
    lost = true;
  const provider = new ReportSheetProvider(
    member.orgId,
    {
      connectionId: "google-fixture",
      spreadsheetId: "sheet-fixture",
      name: "Fixture",
      enabled: true,
      revision: 1,
      configuredBy: "ceo",
    },
    {
      token: async () => "fixture",
      fetch: async (url, init) => {
        if (init?.method === "POST") {
          writes++;
          const body = JSON.parse(String(init.body));
          assert.equal(
            body.requests[0].addSheet.properties.sheetId,
            body.requests[1].updateCells.start.sheetId,
          );
          assert.deepEqual(
            body.requests[1].updateCells.rows[0].values[0].userEnteredValue,
            { stringValue: "HyperFlow report" },
          );
          tab = { properties: body.requests[0].addSheet.properties };
          values = body.requests[1].updateCells.rows.map((r: any) =>
            r.values.map(
              (c: any) =>
                c.userEnteredValue.stringValue ??
                c.userEnteredValue.numberValue,
            ),
          );
          if (lost) {
            lost = false;
            throw new Error("accepted write lost response");
          }
          return Response.json({});
        }
        return String(url).includes("/values/")
          ? Response.json({ values })
          : Response.json({ sheets: tab ? [tab] : [] });
      },
    },
  );
  await assert.rejects(provider.apply(j, true), /lost response/);
  const receipt = await provider.apply(j, false);
  assert.equal(receipt.observed, true);
  assert.equal(writes, 1);
  await provider.apply(j, true);
  assert.equal(writes, 1);
  values[13][2] = "Manual edit";
  await assert.rejects(provider.apply(j, true), /manual edits/);
  assert.equal(writes, 1);
  await assert.rejects(
    provider.apply({ ...j, id: "b".repeat(64) }, true, async () => {
      throw new ArtifactError(403, "Grant revoked during preflight");
    }),
    /revoked during preflight/,
  );
  assert.equal(writes, 1);
});
test("spreadsheet export requires distinct grant and designated approval; revoked grants stop dispatch", async () => {
  const f = fixture();
  let j = (await f.prepare("xlsx")).item;
  j = (await f.action(j, "approve")).item;
  j = (await f.action(j, "generate")).item;
  j = (
    await f.action(j, "review", {
      fileHash: j.receipt.sha256,
      visualChecked: true,
      contentChecked: true,
    })
  ).item;
  await assert.rejects(f.action(j, "propose_sheet"), /not enabled/);
  await f.post({
    operation: "configure_sheet",
    revision: 0,
    connectionId: "google-fixture",
    spreadsheetId: "sheet-fixture",
    enabled: true,
    allowNewTabs: true,
  });
  j = (await f.action(j, "propose_sheet")).item;
  assert.equal(j.sheetExport.ask.status, "open");
  assert.equal(j.sheetExport.ask.token, undefined);
  await assert.rejects(f.action(j, "export_sheet"), /Approve/);
  j = (await f.action(j, "approve_sheet")).item;
  await f.post({ operation: "configure_sheet", revision: 1, enabled: false });
  await assert.rejects(f.action(j, "export_sheet"), /not enabled/);
  assert.equal(
    (await f.store.read<ArtifactJob>(member.orgId, "jobs", j.id))!.sheetExport!
      .status,
    "approved",
  );
});

test("PNG branding stays embedded in editable slides and rejects unsupported or unreadable assets", async () => {
  const f = fixture();
  const j = (await f.prepare("pptx")).item;
  const template = {
    id: "brand-test",
    name: "Brand test",
    format: "pptx",
    brand: {
      name: "Controlled brand",
      font: "Arial",
      accent: "234E70",
      logo: {
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=",
      },
    },
  };
  assert.throws(
    () =>
      validateTemplate(
        { ...template, brand: { ...template.brand, accent: "FFFFFF" } },
        "ceo",
        1,
      ),
    /darker/,
  );
  assert.throws(
    () =>
      validateTemplate(
        {
          ...template,
          brand: {
            ...template.brand,
            logo: { base64: Buffer.from("icns").toString("base64") },
          },
        },
        "ceo",
        1,
      ),
    /PNG/,
  );
  j.template = validateTemplate(template, "ceo", 1);
  const result = await renderArtifact(j),
    zip = await JSZip.loadAsync(result.bytes);
  assert.ok(zip.file(/^ppt\/media\/.*\.png$/).length > 0);
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.match(slide, /Controlled brand/);
  assert.match(slide, /<p:pic>/);
});
