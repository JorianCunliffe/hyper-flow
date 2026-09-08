import {
  readTenantAgentProfile,
  requireOrganizationMember,
} from "../serverStore.js";
import { operatingSnapshot } from "./snapshot.js";
import { relationshipItems } from "./model.js";
export async function channelOperatingContext(
  orgId: string,
  personId: string,
  projectId: string,
) {
  const profile = await readTenantAgentProfile(orgId);
  if (!profile)
    return {
      audience: "unavailable",
      items: [],
      notice: "No operating context is configured.",
    };
  const isCeo = personId === profile.primaryPersonId && !!profile.primaryUserId;
  const granted =
    profile.personProjectAccess?.find((row) => row.personId === personId)
      ?.projectIds || [];
  const ceoScope =
    profile.personProjectAccess?.find((row) => row.personId === personId)
      ?.projectIds || profile.allowedProjectIds;
  if (isCeo && ceoScope && !ceoScope.includes(projectId))
    return {
      audience: "unavailable",
      items: [],
      notice: "This project is outside the CEO channel grant.",
    };
  if (!isCeo && !granted.includes(projectId))
    return {
      audience: "unavailable",
      items: [],
      notice: "No shared obligations are authorized for this contact.",
    };
  if (isCeo) await requireOrganizationMember(profile.primaryUserId!, orgId);
  const snapshot = await operatingSnapshot(
    { orgId, uid: isCeo ? profile.primaryUserId! : `external:${personId}` },
    [projectId],
  );
  return {
    audience: isCeo ? "ceo" : "relationship",
    owner: "hyperflow",
    asOf: snapshot.asOf,
    items: isCeo
      ? snapshot.items
      : relationshipItems(snapshot, personId, granted),
    incomplete: snapshot.incomplete,
    notices: snapshot.notices,
    authority:
      "Read-only. Acceptance, changes and fulfillment require authenticated HyperFlow review.",
  };
}
