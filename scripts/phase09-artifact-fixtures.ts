import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderArtifact } from "../lib/artifacts/render";
import {
  BUILTIN_TEMPLATES,
  hash,
  reportInputs,
  type ArtifactJob,
} from "../lib/artifacts/model";
import { createAsk } from "../lib/asks/createAsk";
const project = {
  id: "fixture-project",
  name: "Controlled operating report fixture",
};
const items = [
  [
    "ob_report",
    "Prepare the weekly report",
    "accepted",
    "2026-09-08T02:00:00Z",
  ],
  [
    "ob_delivery",
    "Confirm the supplier delivery",
    "fulfilled",
    "2026-09-09T00:00:00Z",
  ],
].map(([id, deliverable, state, dueAt], i) => ({
  id,
  deliverable,
  state,
  dueAt,
  version: i + 1,
  projectId: project.id,
  owner: "Report owner",
  beneficiary: "Project team",
  timezone: "Australia/Brisbane",
  needsDecision: false,
  reviewerUid: "fixture",
  updatedAt: 1,
  sourceChanged: false,
  sourceCommunicationIds: ["comm_fixture_" + i],
}));
const inputs = reportInputs(
  project,
  "2026-09-02T00:00:00Z",
  "2026-09-09T00:00:00Z",
  {
    owner: "hyperflow",
    viewerUid: "fixture",
    asOf: "2026-09-09T00:00:00Z",
    timezone: "Australia/Brisbane",
    contacts: [],
    flows: [],
    incomplete: false,
    notices: ["Controlled fixture data for release testing."],
    items,
  },
  {
    contract_version: "memory-context.v1",
    memory_status: {
      state: "current",
      retrieved_at: "2026-09-09T00:00:00Z",
      evidence_only: true,
    },
    data: [
      {
        communication_id: "comm_fixture_0",
        text: "I will prepare the weekly report for review.",
      },
    ],
  },
);
const output = resolve(
  process.argv[2] || "docs/implementation/evidence/P09-artifacts",
);
await mkdir(output, { recursive: true });
for (const template of BUILTIN_TEMPLATES) {
  const id = hash(template.id),
    job: ArtifactJob = {
      id,
      projectId: project.id,
      revision: 1,
      requestHash: id,
      inputHash: hash({ template, inputs }),
      createdBy: "fixture",
      createdAt: Date.parse(inputs.observedAt),
      template,
      inputs,
      status: "approved",
      ask: createAsk({
        taskId: id,
        projectId: project.id,
        question: "Fixture",
        responseType: "approval",
      }),
    };
  const rendered = await renderArtifact(job);
  await writeFile(
    resolve(output, "weekly-report." + template.format),
    rendered.bytes,
  );
  await writeFile(
    resolve(output, template.format + "-receipt.json"),
    JSON.stringify(rendered.receipt, null, 2),
  );
}
console.log("Created controlled DOCX, PPTX and XLSX fixtures in " + output);
