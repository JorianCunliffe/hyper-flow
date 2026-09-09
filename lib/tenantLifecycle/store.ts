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
