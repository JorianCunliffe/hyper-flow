import { handleCommitments } from "../commitments/api.js";
import { listVisibleFlows, readTenantAgentProfile } from "../serverStore.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import type { OperatingSnapshot } from "./model.js";
export async function operatingSnapshot(
  member: { orgId: string; uid: string },
  projectIds?: string[],
  deps: {
    commitments?: typeof handleCommitments;
    flows?: typeof listVisibleFlows;
    profile?: typeof readTenantAgentProfile;
    people?: (orgId: string) => Promise<Array<{ id: string; name?: string }>>;
  } = {},
): Promise<OperatingSnapshot> {
  const notices: string[] = [];
  const allowed = projectIds ? new Set(projectIds) : null;
  const [flowRecords, profile, contacts] = await Promise.all([
    (deps.flows || listVisibleFlows)(member.orgId),
    (deps.profile || readTenantAgentProfile)(member.orgId),
    (deps.people || ((org) => new HttpCommunicationsClient().listPeople(org)))(
      member.orgId,
    ).catch(() => {
      notices.push(
        "Contact names are unavailable; stable party identities remain visible.",
      );
      return [];
    }),
  ]);
  const items: OperatingSnapshot["items"] = [];
  let after = "";
  let incomplete = flowRecords.length >= 100;
  if (incomplete)
    notices.push(
      "Flow history is limited to 100 definitions; this operating snapshot may be incomplete.",
    );
  for (let page = 0; page < 10; page++) {
    const result = (await (deps.commitments || handleCommitments)(
      { method: "GET", query: { after } },
      member,
    )) as any;
    for (const row of result.data || [])
      if (!allowed || allowed.has(row.projectId))
        items.push({
          id: row.id,
          version: row.version,
          projectId: row.projectId,
          deliverable: row.terms.deliverable,
          owner: row.terms.owner,
          beneficiary: row.terms.beneficiary,
          dueAt: row.terms.dueAt,
          timezone: row.terms.timezone,
          state: row.state,
          needsDecision: row.review?.ask?.status === "open",
          reviewerUid: row.reviewerUid,
          updatedAt: row.updatedAt,
          sourceChanged: row.sourceChanged === true,
          sourceCommunicationIds: row.source?.communicationIds || [],
          threadId: row.source?.threadId,
        });
    after = result.next || "";
    if (!after) break;
    if (page === 9) {
      incomplete = true;
      notices.push(
        "This view is limited to 500 operational records. Use the obligation list to continue.",
      );
    }
  }
  if (items.some((row) => row.sourceChanged))
    notices.push(
      "Some source evidence changed; accepted operational terms remain separately authoritative.",
    );
  return {
    owner: "hyperflow",
    asOf: new Date().toISOString(),
    viewerUid: member.uid,
    timezone: profile?.timezone || "Australia/Brisbane",
    items,
    contacts: contacts.map((p) => ({ id: p.id, name: p.name || p.id })),
    flows: flowRecords
      .filter((row) => !allowed || allowed.has(row.projectId))
      .flatMap((row) =>
        row.runs
          .filter((run) => ["running", "paused"].includes(run.status))
          .map((run) => ({
            id: run.id,
            name: run.snapshot.name,
            version: run.version,
            status: run.status,
            projectId: run.projectId,
            updatedAt: run.snapshot.updatedAt,
          })),
      ),
    incomplete,
    notices,
  };
}
