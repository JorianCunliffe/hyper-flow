import { createHash } from "node:crypto";
import type { AgentInboxJob, TenantAgentProfile } from "../../types.js";
import {
  requireOrganizationMember,
  findProject,
  transactOperationalCommitment,
} from "../serverStore.js";
import { createCommitment } from "../commitments/model.js";
export const publicReceptionistInstructions =
  "Take a message: ask for the caller’s name, reason for calling and preferred callback details. Do not disclose project facts, contacts, calendar availability or private diary details. Do not promise a callback time, transfer or completed action. Say the request will need review. Do not claim a request was saved until the service confirms it.";
export async function recordReceptionistIntake(
  job: AgentInboxJob,
  profile: TenantAgentProfile,
) {
  if (
    !profile.receptionistEnabled ||
    !profile.primaryUserId ||
    !profile.receptionistProjectId
  )
    return null;
  if (!(await findProject(job.orgId, profile.receptionistProjectId)))
    throw new Error("Receptionist project is unavailable");
  await requireOrganizationMember(profile.primaryUserId, job.orgId);
  const id = `ob_intake_${createHash("sha256").update(`${job.orgId}:${job.communicationId}`).digest("hex").slice(0, 32)}`;
  const now = Date.now();
  return transactOperationalCommitment(job.orgId, id, (current) => {
    if (current) return current;
    const row = createCommitment({
      id,
      orgId: job.orgId,
      projectId: profile.receptionistProjectId!,
      actor: profile.primaryUserId!,
      terms: {
        owner: `user:${profile.primaryUserId}`,
        beneficiary: job.personId ? `contact:${job.personId}` : "",
        deliverable: "Review an inbound receptionist request",
        criteria: `Review communication ${job.communicationId}, confirm the caller and decide routing or a callback. A callback has not been promised or made.`,
        dueAt: "",
        timezone: profile.timezone,
      },
      now,
      askId: `ask_${id}`,
    });
    row.history[0].note = `Receptionist intake from canonical communication ${job.communicationId}. Review is required; caller statements do not authorize business changes.`;
    return row;
  });
}
