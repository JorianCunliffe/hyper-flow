import { getLifecycleDatabase } from "../serverStore.js";
import { transactLifecycle } from "../tenantLifecycle/store.js";
import { LifecycleError } from "../tenantLifecycle/model.js";
import { cloudFileProvider, type FileProvider } from "./provider.js";
import { fileKey, type ManagedFile } from "./model.js";
export const FILE_ERASURE_CONFIRMATION = "Erase HyperFlow stored files";
/** Human-administrator recovery only. Removes managed objects, retains receipts. */
export async function eraseManagedFiles(
  org: string,
  actor: string,
  input: {
    requestId: string;
    revision: number;
    confirmation: string;
    backupReviewed: boolean;
  },
  provider: FileProvider = cloudFileProvider,
) {
  if (
    process.env.HYPERFLOW_MANAGED_FILES !== "true" ||
    process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE !== "true" ||
    !process.env.FIREBASE_STORAGE_BUCKET
  )
    throw new LifecycleError(503, "Private file storage is not enabled");
  if (
    input.confirmation !== FILE_ERASURE_CONFIRMATION ||
    input.backupReviewed !== true
  )
    throw new LifecycleError(
      422,
      "Review the files you need to retain and enter the exact file-erasure confirmation",
    );
  fileKey(input.requestId);
  if (!Number.isInteger(input.revision) || input.revision < 0)
    throw new LifecycleError(422, "Current lifecycle revision required");
  let state = await transactLifecycle(org, (r) => {
    const prior = r.receipts[input.requestId];
    if (prior) {
      if (prior.actor !== actor || prior.operation !== "erase_managed_files")
        throw new LifecycleError(409, "Request identity conflict");
      return r;
    }
    if (
      !["suspended", "erased"].includes(r.state) ||
      r.revision !== input.revision ||
      r.activeOperation ||
      Object.keys(r.storageLeases).length
    )
      throw new LifecycleError(
        409,
        "A suspended account with no pending operations is required",
      );
    if (Object.keys(r.receipts).length >= 1000)
      throw new LifecycleError(
        409,
        "Lifecycle history requires retention review",
      );
    r.revision++;
    r.activeOperation = input.requestId;
    r.receipts[input.requestId] = {
      id: input.requestId,
      actor,
      operation: "erase_managed_files",
      revision: r.revision,
      at: Date.now(),
      status: "working",
      counts: { processed: 0 },
      detail: JSON.stringify({
        lastId: "",
        scope: "Managed file objects only",
        retained: "File receipts and provider backups/soft-deleted versions",
      }),
    };
    return r;
  });
  if (state.receipts[input.requestId].status !== "working") return state;
  const db = getLifecycleDatabase();
  const detail = JSON.parse(state.receipts[input.requestId].detail!);
  let query = db.ref(`tenant_files/${org}`).orderByKey();
  if (detail.lastId) query = query.startAfter(detail.lastId);
  const rows = Object.entries<ManagedFile>(
    (await query.limitToFirst(26).get()).val() || {},
  );
  for (const [id, file] of rows.slice(0, 25)) {
    if (
      file.id !== id ||
      file.path !== `managed/${encodeURIComponent(org)}/${fileKey(id)}`
    )
      throw new LifecycleError(
        409,
        "An unmanaged file manifest requires operator review",
      );
    if (file.state !== "deleted") {
      await db.ref(`tenant_files/${org}/${id}`).update({ state: "deleting" });
      try {
        await provider.close(file);
      } catch {
        throw new LifecycleError(
          503,
          "File cleanup remains pending; reconcile the original operation",
        );
      }
      await db
        .ref(`tenant_files/${org}/${id}`)
        .update({
          state: "deleted",
          deletedAt: Date.now(),
          deletedBy: actor,
          sessionSecret: null,
          pending: null,
        });
    }
    state = await transactLifecycle(org, (r) => {
      const receipt = r.receipts[input.requestId],
        d = JSON.parse(receipt.detail!);
      if (id > d.lastId) {
        d.lastId = id;
        receipt.detail = JSON.stringify(d);
        receipt.counts = { processed: (receipt.counts?.processed || 0) + 1 };
      }
      return r;
    });
  }
  if (rows.length <= 25)
    state = await transactLifecycle(org, (r) => {
      r.receipts[input.requestId].status = "completed";
      if (r.activeOperation === input.requestId) delete r.activeOperation;
      return r;
    });
  return state;
}
