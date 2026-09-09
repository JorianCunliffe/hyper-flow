import { createHash, randomUUID } from "node:crypto";
import { getLifecycleDatabase } from "../serverStore.js";
import {
  LifecycleError,
  beginLifecycle,
  finishLifecycle,
  lifecycleRecord,
  redactTenantExport,
  TENANT_DATA_ROOTS,
  SECRET_ROOTS,
  TENANT_INDEX_ROOTS,
  type TenantLifecycle,
} from "./model.js";
const key = (value: string) => {
  if (!value || /[.#$\[\]\/]/.test(value))
    throw new LifecycleError(422, "Invalid tenant identity");
  return value;
};
export async function lifecycleOwner(uid: string, orgId?: string) {
  const db = getLifecycleDatabase();
  const user = (await db.ref(`users/${key(uid)}`).get()).val();
  if (!user?.orgId || (orgId && orgId !== user.orgId))
    throw new LifecycleError(403, "Current organization administrator required");
  const role = (
    await db.ref(`organizations/${key(user.orgId)}/members/${uid}/role`).get()
  ).val();
  if (!["owner", "admin"].includes(role))
    throw new LifecycleError(403, "Current organization administrator required");
  return { uid, orgId: user.orgId, role: role as "owner" | "admin" };
}
export async function readLifecycle(org: string): Promise<TenantLifecycle> {
  return lifecycleRecord(
    (
      await getLifecycleDatabase()
        .ref(`tenant_lifecycle/${key(org)}`)
        .get()
    ).val(),
  );
}
export async function transactLifecycle(
  org: string,
  update: (r: TenantLifecycle) => TenantLifecycle,
) {
  const reference = getLifecycleDatabase().ref(`tenant_lifecycle/${key(org)}`);
  let listener = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      listener = () => resolve();
      reference.on("value", listener, reject);
    });
    const result = await reference.transaction(
      (current) => JSON.parse(JSON.stringify(update(lifecycleRecord(current)))),
      undefined,
      false,
    );
    if (!result.committed)
      throw new LifecycleError(409, "Lifecycle update was not committed");
    return lifecycleRecord(result.snapshot.val());
  } finally {
    reference.off("value", listener);
  }
}
/** A bounded portable representation, distinct from operator backups and files. */
export async function exportLifecycleChunk(
  org: string,
  actor: string,
  input: { dataset: string; revision: number; offset: number },
) {
  if (
    !TENANT_DATA_ROOTS.includes(input.dataset as any) ||
    SECRET_ROOTS.has(input.dataset)
  )
    throw new LifecycleError(
      403,
      "Dataset is not available for portable export",
    );
  if (
    !Number.isInteger(input.revision) ||
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0
  )
    throw new LifecycleError(422, "Current revision and byte offset required");
  const current = await readLifecycle(org);
  if (current.state !== "suspended" || current.revision !== input.revision)
    throw new LifecycleError(409, "Current suspended revision required");
  const data = (
    await getLifecycleDatabase()
      .ref(`${input.dataset}/${key(org)}`)
      .get()
  ).val();
  const bytes = Buffer.from(JSON.stringify(redactTenantExport(data)));
  const chunk = bytes.subarray(input.offset, input.offset + 512000);
  if (input.offset > bytes.length)
    throw new LifecycleError(422, "Export offset exceeds dataset size");
  const result = {
    owner: "hyperflow",
    dataset: input.dataset,
    revision: input.revision,
    encoding: "base64",
    content: chunk.toString("base64"),
    offset: input.offset,
    nextOffset:
      input.offset + chunk.length < bytes.length
        ? input.offset + chunk.length
        : null,
    totalBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    chunkSha256: createHash("sha256").update(chunk).digest("hex"),
    files: "not-included",
    communications: "separate export",
  };
  await transactLifecycle(org, (r) => {
    if (r.state !== "suspended" || r.revision !== input.revision)
      throw new LifecycleError(409, "Tenant changed during export");
    if (Object.keys(r.receipts).length >= 1000)
      throw new LifecycleError(409, "Export history requires retention review");
    const id = randomUUID();
    r.receipts[id] = {
      id,
      actor,
      operation: "export",
      at: Date.now(),
      revision: r.revision,
      status: "completed",
      detail: JSON.stringify({
        dataset: input.dataset,
        offset: input.offset,
        bytes: chunk.length,
        sha256: result.sha256,
      }),
    };
    return r;
  });
  return result;
}

/** Conservative inventory: unresolved work must be reconciled before database suspension. */
function pendingWork(value: any, path: string, found: string[]) {
  if (!value || typeof value !== "object") return;
  if (
    [
      "running",
      "processing",
      "uncertain",
      "creating",
      "calling",
      "reserved",
      "sending",
    ].includes(value.status) ||
    value.leaseToken ||
    value.lease_token
  )
    found.push(path);
  for (const [name, item] of Object.entries(value))
    if (item && typeof item === "object")
      pendingWork(item, `${path}/${name}`, found);
}
export async function changeDatabaseLifecycle(
  org: string,
  actor: string,
  input: {
    requestId: string;
    revision: number;
    operation: "suspend" | "resume";
    communicationsReceipt?: TenantLifecycle["communicationsReceipt"];
  },
) {
  if (process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE !== "true")
    throw new LifecycleError(503, "Database lifecycle guards are not enabled");
  if (
    !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !["suspend", "resume"].includes(input.operation)
  )
    throw new LifecycleError(
      422,
      "Operation, current revision and stable request identity required",
    );
  let current = await transactLifecycle(org, (r) => {
    if (input.communicationsReceipt)
      r.communicationsReceipt = input.communicationsReceipt;
    return beginLifecycle(r, {
      id: input.requestId,
      actor,
      revision: input.revision,
      operation: input.operation,
    });
  });
  if (current.receipts[input.requestId].status !== "working") return current;
  const blockers: string[] = [];
  // Writes are already fenced at the database. A crash leaves a visible working
  // receipt; repeating this exact operation resumes the inspection safely.
  for (const root of TENANT_DATA_ROOTS) {
    if (SECRET_ROOTS.has(root)) continue;
    pendingWork(
      (
        await getLifecycleDatabase()
          .ref(`${root}/${key(org)}`)
          .get()
      ).val(),
      root,
      blockers,
    );
  }
  current = await transactLifecycle(org, (r) =>
    finishLifecycle(r, input.requestId, { blockers: blockers.slice(0, 20) }),
  );
  return current;
}

export const ERASE_CONFIRMATION = 'Erase HyperFlow database records';
/** File manifests survive so external objects can still be located and reconciled. */
export const ERASED_DATA_ROOTS = TENANT_DATA_ROOTS.filter(root => root !== 'tenant_files');
export async function eraseDatabaseRecords(org: string, actor: string, input: {
  requestId: string; revision: number; confirmation: string; backupReviewed: boolean;
  communicationsReceipt: TenantLifecycle['communicationsReceipt'];
}) {
  if (process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE !== 'true')
    throw new LifecycleError(503, 'Database lifecycle guards are not enabled');
  if (input.confirmation !== ERASE_CONFIRMATION || input.backupReviewed !== true)
    throw new LifecycleError(422, 'Review your export and type the exact database-erasure confirmation');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId || '') || !Number.isInteger(input.revision) || input.revision < 0)
    throw new LifecycleError(422, 'Current revision and stable request identity required');
  if (input.communicationsReceipt?.owner !== 'communications-service' || input.communicationsReceipt.status !== 'closed')
    throw new LifecycleError(409, 'A current Communications local-erasure receipt is required');
  let state = await transactLifecycle(org, current => {
    if (!current.receipts[input.requestId] && !Object.values(current.receipts).some(r =>
      r.operation === 'export' && r.status === 'completed' && r.revision === current.revision))
      throw new LifecycleError(409, 'Export at the current suspended revision before erasure');
    current.communicationsReceipt = input.communicationsReceipt;
    return beginLifecycle(current, { id: input.requestId, actor, revision: input.revision, operation: 'erase_database' });
  });
  if (state.receipts[input.requestId].status !== 'working') return state;
  const db = getLifecycleDatabase();
  const updates: Record<string, null> = {};
  for (const root of ERASED_DATA_ROOTS) updates[`${root}/${key(org)}`] = null;
  // No normal writer can enter while erasing. Repeatable tombstones make a
  // crash between batches recoverable without reading another tenant's records.
  await db.ref().update(updates);
  for (const root of TENANT_INDEX_ROOTS) {
    for (let page = 0; ; page++) {
      if (page >= 20) throw new LifecycleError(503, 'Index cleanup is partially complete; reconcile this operation');
      const rows = (await db.ref(root).orderByChild('orgId').equalTo(org).limitToFirst(500).get()).val() || {};
      const ids = Object.keys(rows);
      if (!ids.length) break;
      for (const id of ids) {
        if (rows[id]?.orgId !== org) throw new LifecycleError(503, 'Index ownership changed');
        // Recheck ownership at commit time: another tenant may have replaced a
        // shared index key since the query. Never delete its replacement.
        const reference = db.ref(`${root}/${key(id)}`);
        let listener = () => {};
        try {
          await new Promise<void>((resolve, reject) => {
            listener = () => resolve();
            reference.on('value', listener, reject);
          });
          await reference.transaction(current => current?.orgId === org ? null : undefined, undefined, false);
        } finally { reference.off('value', listener); }
      }
    }
  }
  for (const root of ERASED_DATA_ROOTS) {
    if ((await db.ref(`${root}/${key(org)}`).get()).exists())
      throw new LifecycleError(503, 'Database cleanup requires reconciliation');
  }
  state = await transactLifecycle(org, current => {
    const next = finishLifecycle(current, input.requestId, { counts: { clearedDatasetRoots: ERASED_DATA_ROOTS.length } });
    next.receipts[input.requestId].detail = JSON.stringify({
      scope: 'HyperFlow business database records',
      retained: ['tenant_lifecycle', 'tenant_files', 'organization membership', 'Firebase identities'],
      externalCleanup: 'not performed', backupCleanup: 'not performed',
      communications: input.communicationsReceipt,
    });
    return next;
  });
  return state;
}
