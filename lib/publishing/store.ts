import {
  readPublishingLedger,
  transactPublishingLedger,
  listTenantProjects,
  requireOrganizationMember,
} from "../serverStore.js";
import { handlePublishing } from "./api.js";
import type { PublishingStore, PublishingAdapter } from "./model.js";
export const publishingStore: PublishingStore = {
  read: readPublishingLedger,
  transact: transactPublishingLedger,
};
// No provider is inferred from a URL, a connector in Codex, or another tenant's account.
// Install a selected provider only after its OAuth/resource grant and concurrency contract are implemented.
export const publishingAdapters: Record<string, PublishingAdapter> = {};
export const publishingRequest = async (
  request: Parameters<typeof handlePublishing>[0],
  member: Parameters<typeof handlePublishing>[1],
) => {
  if (request.method === "POST" && request.body?.operation === "draft_flow") {
    const b = request.body;
    const result: any = await publishingRequest(
      { method: "GET", query: { projectId: b.projectId, id: b.id } },
      member,
    );
    if (
      result.item.revision !== b.revision ||
      result.item.contentHash !== b.contentHash
    ) {
      const { PublishingError } = await import("./model.js");
      throw new PublishingError(
        409,
        "Save and reload the exact content version first",
      );
    }
    const { handleVisibleFlows, publicFlowResponse } =
      await import("../visibleFlows/api.js");
    return publicFlowResponse(
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId: b.projectId,
            plan: {
              name: "Review and verify publication",
              steps: [
                {
                  id: "publication",
                  name: "Review, publish and verify exact content",
                  action: "review_publication",
                  owner: member.uid,
                  dependsOn: [],
                  sources: [b.id],
                  inputs: { publicationId: b.id, contentHash: b.contentHash },
                },
              ],
            },
          },
        },
        member,
      ),
    );
  }
  return handlePublishing(request, member, {
    store: publishingStore,
    projects: listTenantProjects,
    membership: requireOrganizationMember,
    adapters: publishingAdapters,
  });
};
