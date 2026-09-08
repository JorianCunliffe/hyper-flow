import { createHash } from "node:crypto";
import type { FlowStartSchedule } from "../../types.js";
import { readVisibleFlow, requireOrganizationMember } from "../serverStore.js";
import { handleVisibleFlows } from "../visibleFlows/api.js";
import { advanceVisibleRun } from "../visibleFlows/runtime.js";
export async function runVisibleRoutine(
  schedule: FlowStartSchedule,
  occurrenceId: string,
): Promise<{ ok: boolean; runId: string; reason?: string }> {
  const definitionId = String(schedule.flowId || "").slice("visible:".length);
  const record = await readVisibleFlow(schedule.orgId, definitionId);
  const version = record?.versions.find(
    (v) => v.version === schedule.input?.visibleVersion,
  );
  if (
    !record ||
    record.projectId !== schedule.projectId ||
    !version?.approvedBy ||
    version.hash !== schedule.input?.visibleHash
  )
    throw new Error(
      "Scheduled flow version is no longer approved or accessible",
    );
  const uid = String(schedule.input?.delegatedBy || "");
  await requireOrganizationMember(uid, schedule.orgId);
  await requireOrganizationMember(version.approvedBy, schedule.orgId);
  const runKey = createHash("sha256")
    .update(`${schedule.id}:${occurrenceId}`)
    .digest("hex");
  await handleVisibleFlows(
    {
      method: "POST",
      body: {
        operation: "start",
        id: definitionId,
        version: version.version,
        hash: version.hash,
        runKey,
        expectedRevision: record.revision,
      },
    },
    { orgId: schedule.orgId, uid },
  );
  await advanceVisibleRun(schedule.orgId, definitionId, runKey);
  return { ok: true, runId: runKey };
}
