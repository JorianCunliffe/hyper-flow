import { createHash } from "node:crypto";
import type { AgentInboxJob, TenantAgentProfile } from "../../types.js";
import {
  requireOrganizationMember,
  findProject,
  transactOperationalCommitment,
} from "../serverStore.js";
import { createCommitment } from "../commitments/model.js";
import type { CommunicationResult } from "../communications/types.js";

/** Inspect canonical caller text only. This creates a review candidate, never a call. */
export function callbackRequestText(content = ''): string | null {
  const lines = content.slice(0, 12000).split(/\n/).map(line => line.trim()).filter(Boolean);
  const callback = /\b(?:call[ -]?back|call (?:me|us) back|(?:phone|ring) (?:me|us)(?: back)?)\b/i;
  let request: string | null = null;
  for (const line of lines) {
    if (/\b(?:forget that|cancel that|never mind|nevermind)\b/i.test(line)) { request = null; continue; }
    if (!callback.test(line)) continue;
    if (/\b(?:do not|don't|don’t|no longer|cancel|no need|no callback|no call back)\b/i.test(line)) { request = null; continue; }
    if (/\b(?:please|could|can|would|like|want|need|request)\b/i.test(line) || /^(?:call|phone|ring)\b/i.test(line)) request = line.slice(0, 3000);
  }
  return request;
}

export const callbackIntakeInstructions =
  'Callback requests are captured after the call for human review when receptionist intake is enabled. Ask for the reason and preferred callback time, one question at a time. Explain that the team must confirm who will call and when. Do not claim the request is already saved during the call, and do not promise a callback or booking. Do not refuse to take the request merely because you cannot place the callback yourself.';
export const publicReceptionistInstructions =
  "Take a message: ask for the caller’s name, reason for calling and preferred callback details. Do not disclose project facts, contacts, calendar availability or private diary details. Do not promise a callback time, transfer or completed action. Say the request will need review. Do not claim a request was saved until the service confirms it.";
export async function recordReceptionistIntake(
  job: AgentInboxJob,
  profile: TenantAgentProfile,
  details: { communication?: CommunicationResult; callbackText?: string } = {},
  deps = { findProject, requireOrganizationMember, transactOperationalCommitment },
) {
  if (
    !profile.receptionistEnabled ||
    !profile.primaryUserId ||
    !profile.receptionistProjectId
  )
    return null;
  if (details.communication && (details.communication.id !== job.communicationId || details.communication.tenantId !== job.orgId || details.communication.channel !== 'voice' || details.communication.outcome?.memory_eligible === false || (details.communication.personId && details.communication.personId !== job.personId)))
    throw new Error('Receptionist source does not match this eligible tenant call');
  if (!(await deps.findProject(job.orgId, profile.receptionistProjectId)))
    throw new Error("Receptionist project is unavailable");
  await deps.requireOrganizationMember(profile.primaryUserId, job.orgId);
  const id = `ob_intake_${createHash("sha256").update(`${job.orgId}:${job.communicationId}`).digest("hex").slice(0, 32)}`;
  const now = Date.now();
  return deps.transactOperationalCommitment(job.orgId, id, (current) => {
    if (current) return current;
    const row = createCommitment({
      id,
      orgId: job.orgId,
      projectId: profile.receptionistProjectId!,
      actor: profile.primaryUserId!,
      terms: {
        owner: details.callbackText ? '' : `user:${profile.primaryUserId}`,
        beneficiary: job.personId ? `contact:${job.personId}` : "",
        deliverable: details.callbackText ? 'Return the caller’s call — awaiting review' : "Review an inbound receptionist request",
        criteria: `Caller request: ${details.communication?.content?.slice(0, 3000) || details.callbackText || 'Read the source communication.'}\nSource communication: ${job.communicationId}; thread: ${job.threadId || details.communication?.threadId || 'unavailable'}; received: ${details.communication?.occurredAt || 'unavailable'}.\nConfirm the callback owner and exact deadline with timezone. Relative timing is the caller’s preference, not an accepted deadline. No callback has been promised or made.`,
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
