import {
  CommunicationsApiError,
  CommunicationsConfigurationError,
} from "../communications/errors.js";
import { requireFirebaseIdentity } from "../apiAuth.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import {
  lifecycleOwner,
  readLifecycle,
  exportLifecycleChunk,
  changeDatabaseLifecycle,
  transactLifecycle,
} from "./store.js";
import { LifecycleError, TENANT_DATA_ROOTS, SECRET_ROOTS } from "./model.js";
export const lifecycleDependencies = {
  requireFirebaseIdentity,
  lifecycleOwner,
  readLifecycle,
  exportLifecycleChunk,
  changeDatabaseLifecycle,
  transactLifecycle,
  communications: () => new HttpCommunicationsClient(),
};
async function executeLifecycle(
  req: {
    headers: Record<string, string | string[] | undefined>;
    method?: string;
    query?: any;
    body?: any;
  },
  deps = lifecycleDependencies,
) {
  const {
    requireFirebaseIdentity,
    lifecycleOwner,
    readLifecycle,
    exportLifecycleChunk,
    changeDatabaseLifecycle,
    transactLifecycle,
  } = deps;
  const identity = await requireFirebaseIdentity(req);
  const owner = await lifecycleOwner(identity.uid);
  const q = req.query || {},
    body = req.body || {};
  if (req.method === "GET") {
    if (q.service === "communications")
      return deps.communications().readTenantLifecycle(owner.orgId);
    if (q.dataset)
      return exportLifecycleChunk(owner.orgId, owner.uid, {
        dataset: String(q.dataset),
        revision: Number(q.revision),
        offset: Number(q.offset || 0),
      });
    return {
      owner: "hyperflow",
      databaseGuardsEnabled:
        process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE === "true",
      scope: "HyperFlow database only",
      lifecycle: await readLifecycle(owner.orgId),
      datasets: TENANT_DATA_ROOTS.filter((x) => !SECRET_ROOTS.has(x)),
      files: "Separate storage lifecycle; not included",
      communications: "Separate service and receipts",
      erasure: "Not enabled",
      retention: "Manual review; no automatic deletion policy",
    };
  }
  if (req.method !== "POST")
    throw new LifecycleError(405, "Method not allowed");
  if (body.service === "communications") {
    if (!["suspend", "resume"].includes(body.operation))
      throw new LifecycleError(
        422,
        "Supported Communications operations are suspend and resume",
      );
    if (
      !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || "") ||
      !Number.isInteger(body.revision) ||
      body.revision < 1
    )
      throw new LifecycleError(
        422,
        "Current Communications revision and request identity required",
      );
    const forwarded = {
      service: "communications",
      operation: body.operation,
      revision: body.revision,
      requestId: body.requestId,
    };
    const journal = await transactLifecycle(owner.orgId, (r) => {
      const prior = r.receipts[body.requestId];
      if (prior) {
        if (
          prior.actor !== owner.uid ||
          prior.operation !== "communications." + body.operation ||
          JSON.stringify(JSON.parse(prior.detail || "{}").request) !==
            JSON.stringify(forwarded)
        )
          throw new LifecycleError(409, "Request identity conflict");
        return r;
      }
      if (Object.keys(r.receipts).length >= 1000)
        throw new LifecycleError(
          409,
          "Lifecycle history requires retention review",
        );
      r.receipts[body.requestId] = {
        id: body.requestId,
        actor: owner.uid,
        operation: "communications." + body.operation,
        at: Date.now(),
        revision: r.revision,
        status: "working",
        detail: JSON.stringify({ request: forwarded }),
      };
      return r;
    });
    const prior = journal.receipts[body.requestId];
    if (prior.status === "completed") return JSON.parse(prior.detail!).receipt;
    const result = await deps
      .communications()
      .changeTenantLifecycle(owner.orgId, {
        operation: body.operation,
        revision: body.revision,
        requestId: body.requestId,
      });
    await transactLifecycle(owner.orgId, (r) => {
      const item = r.receipts[body.requestId];
      if (!item || item.actor !== owner.uid)
        throw new LifecycleError(409, "Lifecycle receipt changed");
      item.status = "completed";
      item.detail = JSON.stringify({ request: forwarded, receipt: result });
      return r;
    });
    return result;
  }
  if (!["suspend", "resume"].includes(body.operation))
    throw new LifecycleError(
      422,
      "Supported database operations are suspend and resume",
    );
  let receipt;
  if (body.operation === "suspend") {
    const observed = await deps
      .communications()
      .readTenantLifecycle(owner.orgId);
    if (
      observed.owner !== "communications-service" ||
      !["suspended", "closed"].includes(observed.tenant?.status)
    )
      throw new LifecycleError(
        409,
        "Suspend Communications and review its receipt first",
      );
    receipt = {
      owner: "communications-service" as const,
      status: observed.tenant.status,
      revision: observed.tenant.lifecycle_revision,
    };
  }
  return {
    owner: "hyperflow",
    scope: "HyperFlow database only",
    lifecycle: await changeDatabaseLifecycle(owner.orgId, owner.uid, {
      operation: body.operation,
      requestId: body.requestId,
      revision: body.revision,
      communicationsReceipt: receipt,
    }),
    files: "not-suspended",
    providers: "separate lifecycle",
  };
}

export async function handleLifecycle(
  req: Parameters<typeof executeLifecycle>[0],
  deps = lifecycleDependencies,
) {
  try {
    return await executeLifecycle(req, deps);
  } catch (error) {
    if (error instanceof CommunicationsApiError)
      throw new LifecycleError(
        error.status && error.status < 500 ? error.status : 502,
        error.message,
      );
    if (error instanceof CommunicationsConfigurationError)
      throw new LifecycleError(
        503,
        "Communications lifecycle is not configured",
      );
    throw error;
  }
}
