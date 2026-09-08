import { createHash } from "node:crypto";
import type { HumanAsk } from "../../types.js";
import type { OperatingSnapshot, OperatingItem } from "../cockpit/model.js";
import {
  memoryEvidence,
  type MemoryEnvelope,
  type MemoryEvidence,
} from "../communications/memoryTypes.js";

export class ArtifactError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
export type ArtifactFormat = "docx" | "pptx" | "xlsx";
export interface ArtifactTemplate {
  id: string;
  version: number;
  name: string;
  format: ArtifactFormat;
  purpose: "weekly_report";
  audience: "project";
  sections: string[];
  brand: {
    name: string;
    accent: string;
    font: "Arial" | "Calibri";
    logo?: { base64: string; width: number; height: number; sha256: string };
  };
  createdBy: string;
  createdAt: number;
}
export interface ReportInputs {
  schema: "weekly-report.v1";
  projectId: string;
  projectName: string;
  periodStart: string;
  cutoff: string;
  observedAt: string;
  rows: OperatingItem[];
  evidence: MemoryEvidence[];
  notices: string[];
  totals: {
    accepted: number;
    open: number;
    fulfilled: number;
    dueInPeriod: number;
    overdue: number;
  };
}
export interface ArtifactJob {
  id: string;
  projectId: string;
  revision: number;
  requestHash: string;
  inputHash: string;
  createdBy: string;
  createdAt: number;
  template: ArtifactTemplate;
  inputs: ReportInputs;
  status:
    | "proposed"
    | "approved"
    | "building"
    | "generated"
    | "reviewed"
    | "rejected"
    | "failed";
  ask: HumanAsk;
  reviewAsk?: HumanAsk;
  claim?: string;
  error?: string;
  sheetExport?: {
    target: import("./sheets.js").SheetTarget;
    status: "proposed" | "approved" | "running" | "uncertain" | "verified";
    ask: HumanAsk;
    receipt?: Record<string, unknown>;
    error?: string;
  };
  receipt?: {
    sha256: string;
    bytes: number;
    filename: string;
    mime: string;
    generatedAt: number;
    format: ArtifactFormat;
    structure: "passed";
    visual: "pending" | "reviewed";
    delivered: false;
  };
}
export interface ArtifactRegistry {
  revision: number;
  templates: ArtifactTemplate[];
  sheetTarget?: import("./sheets.js").SheetTarget;
}
export function normalizeJob(job: ArtifactJob): ArtifactJob {
  return {
    ...job,
    inputs: {
      ...job.inputs,
      rows: Object.values(job.inputs.rows || {}).map((r) => ({
        ...r,
        sourceCommunicationIds: Object.values(r.sourceCommunicationIds || {}),
      })),
      evidence: Object.values(job.inputs.evidence || {}).map((e) => ({
        ...e,
        sources: Object.values(e.sources || {}),
      })),
      notices: Object.values(job.inputs.notices || {}),
    },
  };
}
export const BUILTIN_TEMPLATES: ArtifactTemplate[] = (
  ["docx", "pptx", "xlsx"] as ArtifactFormat[]
).map((format) => ({
  id: `weekly-${format}`,
  version: 1,
  name: `Weekly operating report ${format.toUpperCase()}`,
  format,
  purpose: "weekly_report",
  audience: "project",
  sections: [
    "Overview",
    "Accepted work",
    "Communication evidence",
    "Source notes",
  ],
  brand: { name: "Unbranded", accent: "234E70", font: "Arial" },
  createdBy: "system",
  createdAt: 0,
}));
export function validateTemplate(
  raw: any,
  createdBy: string,
  version: number,
): ArtifactTemplate {
  const name = String(raw?.name || "").trim(),
    id = String(raw?.id || "");
  if (
    !/^[a-z][a-z0-9-]{2,60}$/.test(id) ||
    id.startsWith("weekly-") ||
    !name ||
    name.length > 100 ||
    !["docx", "pptx", "xlsx"].includes(raw.format)
  )
    throw new ArtifactError(
      422,
      "Enter a unique template identity, name and supported format",
    );
  const brand = raw.brand || {};
  if (
    !/^[0-9a-f]{6}$/i.test(brand.accent) ||
    !["Arial", "Calibri"].includes(brand.font) ||
    typeof brand.name !== "string" ||
    !brand.name.trim() ||
    brand.name.length > 80
  )
    throw new ArtifactError(
      422,
      "Choose a brand name, six-digit colour and supported font",
    );
  const rgb = brand.accent.match(/../g).map((s: string) => {
    const v = parseInt(s, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  if (1.05 / (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05) < 4.5)
    throw new ArtifactError(
      422,
      "Choose a darker accent so headings and workbook headers remain readable",
    );
  let logo: ArtifactTemplate["brand"]["logo"];
  if (brand.logo) {
    const b = brand.logo.base64;
    if (
      typeof b !== "string" ||
      b.length > 180000 ||
      !/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(b)
    )
      throw new ArtifactError(422, "Logo must be a PNG smaller than 130 KB");
    const bytes = Buffer.from(b, "base64");
    if (bytes.length < 24 || bytes.subarray(12, 16).toString() !== "IHDR")
      throw new ArtifactError(422, "Invalid PNG header");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width > 2000 || height > 2000)
      throw new ArtifactError(422, "Logo dimensions must be 1 to 2000 pixels");
    logo = { base64: b, width, height, sha256: hash(bytes) };
  }
  return {
    id,
    version,
    name,
    format: raw.format,
    purpose: "weekly_report",
    audience: "project",
    sections: [...BUILTIN_TEMPLATES[0].sections],
    brand: {
      name: brand.name.trim(),
      accent: brand.accent.toUpperCase(),
      font: brand.font,
      ...(logo ? { logo } : {}),
    },
    createdBy,
    createdAt: Date.now(),
  };
}
export function reportInputs(
  project: { id: string; name: string },
  start: string,
  cutoff: string,
  snapshot: OperatingSnapshot,
  memory: MemoryEnvelope,
): ReportInputs {
  const a = Date.parse(start),
    b = Date.parse(cutoff),
    observed = Date.parse(snapshot.asOf);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    a >= b ||
    b - a > 31 * 86400000 ||
    b > observed + 60000
  )
    throw new ArtifactError(
      422,
      "Report period must end by the snapshot time and span at most 31 days",
    );
  if (snapshot.incomplete || memory.memory_status.state !== "current")
    throw new ArtifactError(
      409,
      "Source context is incomplete or stale; refresh it before preparing this report",
    );
  const rows = snapshot.items.filter(
    (r) =>
      r.projectId === project.id &&
      !["candidate", "dismissed"].includes(r.state),
  );
  if (rows.length > 100)
    throw new ArtifactError(
      422,
      "This report supports at most 100 accepted records; narrow the project scope",
    );
  const open = rows.filter(
    (r) => !["fulfilled", "cancelled"].includes(r.state),
  );
  const evidence = memoryEvidence(memory.data);
  if (
    evidence.length > 60 ||
    evidence.some(
      (e) => e.text.length > 6000 || e.sources.join(", ").length > 500,
    ) ||
    rows.some(
      (r) =>
        r.deliverable.length > 1200 ||
        r.sourceCommunicationIds.join(", ").length > 500,
    )
  )
    throw new ArtifactError(
      422,
      "Source text exceeds this template capacity; narrow the source scope",
    );
  const notices = [
    ...snapshot.notices,
    "States reflect the records read at the observation time. This is not a historical state reconstruction.",
    "Communication excerpts are supporting evidence, not newly accepted obligations.",
    "Communication context is a bounded selection of at most 30 search matches, not an exhaustive history.",
  ];
  if (!rows.length)
    notices.push("No accepted work was returned for this project.");
  if (!evidence.length)
    notices.push("No permitted communication excerpts were returned.");
  return {
    schema: "weekly-report.v1",
    projectId: project.id,
    projectName: project.name,
    periodStart: new Date(a).toISOString(),
    cutoff: new Date(b).toISOString(),
    observedAt: snapshot.asOf,
    rows,
    evidence,
    notices,
    totals: {
      accepted: rows.length,
      open: open.length,
      fulfilled: rows.filter((r) => r.state === "fulfilled").length,
      dueInPeriod: rows.filter(
        (r) => Date.parse(r.dueAt) >= a && Date.parse(r.dueAt) < b,
      ).length,
      overdue: open.filter((r) => Date.parse(r.dueAt) < b).length,
    },
  };
}
export function publicArtifact(value: unknown): any {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      key === "token" || key === "base64" ? undefined : v,
    ),
  );
}
