import { createHash } from "node:crypto";
import { NodeType, type HumanAsk, type Project } from "../../types.js";
import { createAsk } from "../asks/createAsk.js";

export const FLOW_CATALOG = {
  collect_update: {
    label: "Review a received update",
    nodeType: NodeType.REPORT,
    required: ["question"],
    effect: "Waits for an authenticated human response; sends nothing",
    authority: "Run creator answers the Ask",
    receipt: "Human Ask response and reviewer identity",
    outputSchema: { reviewed_update: "string", providedBy: "string" },
    timeoutSeconds: 60,
  },
  read_operations: {
    label: "Read accepted work and decisions",
    nodeType: NodeType.REPORT,
    required: [],
    effect: "Reads HyperFlow operational records for this project",
    authority: "Current organization membership and project access",
    receipt: "Obligation identities, accepted terms and snapshot time",
    outputSchema: { operating_snapshot: "OperatingSnapshot" },
    timeoutSeconds: 60,
  },
  read_context: {
    label: "Read project communication evidence",
    nodeType: NodeType.REPORT,
    required: [],
    effect: "Reads permitted Communications evidence and freshness",
    authority: "Current project evidence permission",
    receipt: "Source references and freshness",
    outputSchema: { communication_evidence: "memory-context.v1" },
    timeoutSeconds: 60,
  },
  draft_email: {
    label: "Draft an email",
    nodeType: NodeType.EMAIL,
    required: ["connectionId", "to", "subject", "body"],
    effect: "Creates a mailbox draft; never sends",
    authority: "Mailbox draft permission",
    receipt: "Mailbox draft identity",
    outputSchema: { draft_receipt: "mailbox-draft", email_sent: "false" },
    timeoutSeconds: 60,
  },
  send_sms: {
    label: "Send an SMS",
    nodeType: NodeType.SMS,
    required: ["to", "body"],
    optional: ["followUp"],
    effect: "Sends a real SMS",
    authority: "Explicit flow approval and current Communications permission",
    receipt: "Communication and provider delivery outcome",
    outputSchema: {
      communication_id: "string",
      communication_status: "CommunicationStatus",
    },
    timeoutSeconds: 60,
  },
  outgoing_call: {
    label: "Make a phone call",
    nodeType: NodeType.PHONE_CALL,
    required: ["to", "instructions"],
    optional: ["followUp"],
    effect: "Places a real call",
    authority: "Explicit flow approval and current Communications permission",
    receipt: "Communication and terminal call outcome",
    outputSchema: {
      communication_id: "string",
      communication_status: "CommunicationStatus",
    },
    timeoutSeconds: 60,
  },
  write_report: {
    label: "Prepare a report draft",
    nodeType: NodeType.REPORT,
    required: ["prompt"],
    effect: "Generates draft text",
    authority: "Approved flow version",
    receipt: "Saved draft text; not delivery or factual verification",
    outputSchema: { report_content: "nonempty string" },
    timeoutSeconds: 120,
  },
  read_google_doc: {
    label: "Read the granted Google document",
    nodeType: NodeType.GOOGLE_DOC,
    required: [],
    effect: "Reads the existing project resource grant",
    authority: "Current project document grant",
    receipt: "Document identity and revision",
    outputSchema: {
      google_doc_id: "string",
      google_doc_text: "string",
      google_doc_revision: "string",
    },
    timeoutSeconds: 60,
  },
  read_google_sheet: {
    label: "Read the granted Google sheet",
    nodeType: NodeType.GOOGLE_SHEET_READ,
    required: [],
    effect: "Reads the existing project resource grant",
    authority: "Current project sheet grant",
    receipt: "Sheet identity, range and read time",
    outputSchema: {
      google_sheet_id: "string",
      google_sheet_values: "array",
      google_sheet_read_at: "timestamp",
    },
    timeoutSeconds: 60,
  },
} as const;
export type FlowAction = keyof typeof FLOW_CATALOG;
export interface FlowStep {
  id: string;
  name: string;
  action: FlowAction;
  owner: string;
  dependsOn: string[];
  inputs: Record<string, string>;
  sources: string[];
}
export interface FlowPlan {
  name: string;
  steps: FlowStep[];
}
export class FlowError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message: string): never => {
  throw new FlowError(422, message);
};
const bounded = (value: unknown, limit: number, label: string): string =>
  typeof value === "string" && value.length <= limit
    ? value.trim()
    : fail(`Invalid ${label}`);
export function validatePlan(raw: any): { plan: FlowPlan; missing: string[] } {
  if (JSON.stringify(raw)?.length > 100000)
    fail("Flow proposal exceeds the 100 KB limit");
  const name = bounded(raw?.name, 200, "flow name");
  if (
    !name ||
    !Array.isArray(raw?.steps) ||
    !raw.steps.length ||
    raw.steps.length > 20
  )
    fail("A named flow needs 1–20 steps");
  const ids = new Set<string>();
  const missing: string[] = [];
  const steps: FlowStep[] = raw.steps.map((s: any) => {
    const id = bounded(s?.id, 64, "step id");
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
      fail("Step identities must be unique");
    ids.add(id);
    if (!Object.hasOwn(FLOW_CATALOG, s.action))
      fail(`Unsupported action: ${String(s.action).slice(0, 80)}`);
    const action = s.action as FlowAction;
    const title = bounded(s.name, 200, "step name");
    if (!title) fail("Step name is required");
    const owner = bounded(s.owner ?? "", 200, "owner");
    if (!owner) missing.push(`${id}.owner`);
    if (!Array.isArray(s.dependsOn) || s.dependsOn.length > 20)
      fail("Invalid step dependencies");
    const dependsOn = [
      ...new Set<string>(
        s.dependsOn.map((d: unknown) => bounded(d, 64, "dependency")),
      ),
    ];
    if (!s.inputs || typeof s.inputs !== "object" || Array.isArray(s.inputs))
      fail("Step inputs must be an object");
    const entry = FLOW_CATALOG[action];
    const allowed = new Set<string>([
      ...entry.required,
      ...("optional" in entry ? entry.optional : []),
    ]);
    const inputs: Record<string, string> = {};
    for (const [key, value] of Object.entries(s.inputs)) {
      if (!allowed.has(key)) fail(`Unsupported input ${id}.${key}`);
      inputs[key] = bounded(value, 12000, `input ${id}.${key}`);
    }
    for (const key of entry.required)
      if (!inputs[key]) missing.push(`${id}.${key}`);
    if (inputs.followUp && !["true", "false"].includes(inputs.followUp))
      fail("followUp must be true or false");
    if (
      inputs.to &&
      action === "draft_email" &&
      !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(inputs.to)
    )
      fail("Enter one valid email recipient");
    if (
      inputs.to &&
      action !== "draft_email" &&
      !/^\+[1-9]\d{7,14}$/.test(inputs.to)
    )
      fail("Phone recipients must use international format");
    const sources = s.sources ?? [];
    if (!Array.isArray(sources) || sources.length > 20)
      fail("Invalid source references");
    return {
      id,
      name: title,
      action,
      owner,
      dependsOn,
      inputs,
      sources: sources.map((v: unknown) =>
        bounded(v, 1000, "source reference"),
      ),
    };
  });
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) fail("Flow contains a dependency cycle");
    if (visited.has(id)) return;
    const step = steps.find((s) => s.id === id);
    if (!step) fail(`Unknown dependency ${id}`);
    visiting.add(id);
    step!.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  steps.forEach((s) => visit(s.id));
  return { plan: { name, steps }, missing };
}
export const planHash = (plan: FlowPlan): string =>
  createHash("sha256").update(JSON.stringify(plan)).digest("hex");
export interface FlowVersion {
  id: string;
  projectId: string;
  version: number;
  plan: FlowPlan;
  hash: string;
  createdBy: string;
  createdAt: number;
  missing: string[];
  ask: HumanAsk;
  approvedBy?: string;
  approvedAt?: number;
}
export interface FlowRun {
  id: string;
  definitionId: string;
  version: number;
  hash: string;
  projectId: string;
  createdBy: string;
  createdAt: number;
  revision: number;
  status: "running" | "paused" | "cancelled" | "completed";
  snapshot: Project;
  plan: FlowPlan;
  reviewedBy?: string;
  reviewedAt?: number;
  history?: Array<{
    operation: string;
    actor: string;
    at: number;
    version: number;
  }>;
}
export interface FlowRecord {
  id: string;
  projectId: string;
  revision: number;
  versions: FlowVersion[];
  runs: FlowRun[];
}
export function makeVersion(
  id: string,
  projectId: string,
  number: number,
  raw: unknown,
  uid: string,
): FlowVersion {
  const { plan, missing } = validatePlan(raw);
  const now = Date.now();
  return {
    id,
    projectId,
    version: number,
    plan,
    hash: planHash(plan),
    createdBy: uid,
    createdAt: now,
    missing,
    ask: createAsk({
      taskId: id,
      projectId,
      question: missing.length
        ? `Clarify these inputs before approval: ${missing.join(", ")}`
        : `Approve version ${number}: ${plan.steps.map((s) => `${s.name}: ${FLOW_CATALOG[s.action].effect}`).join("; ")}. Approval applies only to these inputs.`,
      responseType: missing.length ? "question" : "approval",
      assignees: [uid],
      now,
    }),
  };
}
export function projectSnapshot(
  version: FlowVersion,
  parent: Project,
): Project {
  return {
    id: parent.id,
    name: version.plan.name,
    company: parent.company,
    type: parent.type,
    startDate: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectData: {},
    milestones: version.plan.steps.map((s) => ({
      id: s.id,
      name: s.name,
      dependsOn: s.dependsOn,
      subtasks: [],
      estimatedDuration: 0,
      nodeType: FLOW_CATALOG[s.action].nodeType,
      actionConfig: { template: JSON.stringify(s.inputs), autoExecute: true },
    })),
  };
}
/** RTDB omits empty arrays. Normalize only structural arrays; never infer approval. */
export function normalizeFlow(record: FlowRecord): FlowRecord {
  return {
    ...record,
    versions: (record.versions || []).map((v) => ({
      ...v,
      missing: v.missing || [],
      plan: {
        ...v.plan,
        steps: (v.plan.steps || []).map((s) => ({
          ...s,
          dependsOn: s.dependsOn || [],
          sources: s.sources || [],
          inputs: s.inputs || {},
        })),
      },
      ask: {
        ...v.ask,
        responses: v.ask.responses || [],
        assignees: v.ask.assignees || [],
      },
    })),
    runs: (record.runs || []).map((r) => ({
      ...r,
      plan: {
        ...r.plan,
        steps: (r.plan.steps || []).map((s) => ({
          ...s,
          dependsOn: s.dependsOn || [],
          sources: s.sources || [],
          inputs: s.inputs || {},
        })),
      },
      snapshot: {
        ...r.snapshot,
        milestones: (r.snapshot.milestones || []).map((m) => ({
          ...m,
          dependsOn: m.dependsOn || [],
          subtasks: m.subtasks || [],
        })),
      },
    })),
  };
}
