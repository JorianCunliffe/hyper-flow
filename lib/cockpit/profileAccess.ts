import { ApiAuthError } from "../apiAuth.js";
import { requireOrganizationMember } from "../serverStore.js";

// Older integration settings must enforce the same channel-access boundary as the cockpit.
export async function assertChannelProfileAccess(
  member: { orgId: string; uid: string },
  patch: Record<string, unknown>,
) {
  const protectedFields = [
    "primaryPersonId",
    "primaryUserId",
    "personProjectAccess",
    "allowedProjectIds",
    "automaticActions",
    "receptionistEnabled",
    "receptionistProjectId",
    "contactWindow",
  ];
  if (!protectedFields.some((key) => Object.hasOwn(patch, key))) return;
  const actor = await requireOrganizationMember(member.uid, member.orgId);
  if (!["owner", "admin"].includes(actor.role))
    throw new ApiAuthError(
      403,
      "An organization administrator must configure channel access",
    );
}
