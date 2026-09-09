import { createHash } from "node:crypto";
import {
  readManagedFile,
  listManagedFiles,
  transactManagedFile,
} from "../serverStore.js";
import {
  readLifecycle,
  reserveFileLease,
  releaseFileLease,
} from "../tenantLifecycle/store.js";
import { LifecycleError } from "../tenantLifecycle/model.js";
import { cloudFileProvider, type FileProvider } from "./provider.js";
import {
  FileError,
  FILE_CHUNK_BYTES,
  fileKey,
  newFile,
  sameFile,
  visibleFile,
  publicFile,
  type ManagedFile,
} from "./model.js";
type Member = { uid: string; orgId: string; role: string };
export const fileDependencies = {
  read: readManagedFile,
  list: listManagedFiles,
  transact: transactManagedFile,
  lifecycle: readLifecycle,
  reserve: reserveFileLease,
  release: releaseFileLease,
  provider: cloudFileProvider as FileProvider,
  bucket: () => process.env.FIREBASE_STORAGE_BUCKET || "",
  enabled: () =>
    process.env.HYPERFLOW_MANAGED_FILES === "true" &&
    !!process.env.FIREBASE_STORAGE_BUCKET &&
    process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE === "true",
};
const uploadLease = (id: string) => `file_upload_${id}`;
const deleteLease = (id: string) => `file_delete_${id}`;
async function execute(
  req: { method?: string; query?: any; body?: any },
  member: Member,
  deps: typeof fileDependencies,
) {
  if (!deps.enabled())
    throw new FileError(
      503,
      "Private file storage is not enabled. An administrator must provision and verify storage first.",
    );
  const { orgId: org, uid: actor } = member;
  if ((await deps.lifecycle(org)).state !== "active")
    throw new FileError(409, "Account file activity is paused");
  const read = async (
    id: string,
    adminRemoval = false,
  ): Promise<ManagedFile> => {
    let file = await deps.read(org, id);
    if (!file && adminRemoval && ["owner", "admin"].includes(member.role)) {
      const path = `managed/${encodeURIComponent(org)}/${id}`;
      if (
        (await deps.lifecycle(org)).storageLeases[uploadLease(id)]?.path ===
        path
      ) {
        // A crash before manifest creation cannot have exposed an upload URI.
        // Persist a tombstone so a delayed initializer cannot resurrect it.
        file = await deps.transact(
          org,
          id,
          (r: ManagedFile | null) =>
            r || {
              id,
              actor,
              name: "Cancelled initialization",
              mime: "application/octet-stream",
              bytes: 0,
              crc32c: "AAAAAA==",
              visibility: "private",
              path,
              createdAt: Date.now(),
              state: "initializing",
              offset: 0,
            },
        );
      }
    }
    if (
      !file ||
      (!visibleFile(file, actor) &&
        !(adminRemoval && ["owner", "admin"].includes(member.role)))
    )
      throw new FileError(404, "File not found");
    return file;
  };
  const finish = async (file: ManagedFile) => {
    if (file.state === "ready" || file.state === "deleted") {
      await deps.release(org, uploadLease(file.id), file.path);
      return file;
    }
    if (file.state !== "uploading") return file;
    const progress = await deps.provider.progress(file);
    const result: ManagedFile = await deps.transact(
      org,
      file.id,
      (r: ManagedFile) => {
        if (r.state !== "uploading") return r;
        if (
          !Number.isSafeInteger(progress.offset) ||
          progress.offset < r.offset ||
          progress.offset > r.bytes
        )
          throw new FileError(
            409,
            "Provider upload offset changed unexpectedly",
          );
        if (progress.object) {
          if (
            progress.object.size !== r.bytes ||
            progress.object.crc32c !== r.crc32c ||
            !/^[0-9]+$/.test(progress.object.generation)
          )
            throw new FileError(
              409,
              "File integrity check failed; cancel this upload",
            );
          r.state = "ready";
          r.generation = progress.object.generation;
          r.completedAt = Date.now();
          delete r.pending;
        } else if (
          r.pending &&
          progress.offset >= r.pending.offset + r.pending.bytes
        )
          delete r.pending;
        r.offset = progress.offset;
        return r;
      },
    );
    if (result.state === "ready")
      await deps.release(org, uploadLease(file.id), file.path);
    return result;
  };
  if (req.method === "GET") {
    const q = req.query || {};
    if (!q.id) {
      const limit = q.limit === undefined ? 25 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new FileError(422, "File page limit must be 1 to 100");
      const after = q.after ? fileKey(q.after) : "";
      const rows = (await deps.list(org, after, limit + 1)) as ManagedFile[];
      const page = rows.slice(0, limit);
      return {
        owner: "hyperflow",
        items: page.filter((f) => visibleFile(f, actor)).map(publicFile),
        next: rows.length > limit ? page.at(-1)!.id : null,
      };
    }
    const file = await read(fileKey(q.id));
    if (q.download === "1") {
      if (file.state !== "ready")
        throw new FileError(409, "File is not ready for download");
      return {
        owner: "hyperflow",
        file: publicFile(file),
        ...(await deps.provider.download(file)),
        access:
          "Private bearer download expires after 60 seconds; copies already downloaded remain outside HyperFlow.",
      };
    }
    return { owner: "hyperflow", file: publicFile(file) };
  }
  if (req.method !== "POST") throw new FileError(405, "Method not allowed");
  const body = req.body || {},
    id = fileKey(body.id);
  if (body.operation === "start") {
    const candidate = newFile(body, actor, org);
    const prior = await deps.read(org, id);
    candidate.bucket = prior?.bucket || deps.bucket();
    if (prior && !sameFile(prior, candidate))
      throw new FileError(409, "File request identity conflict");
    if (prior && ["ready", "deleted", "deleting"].includes(prior.state))
      return { owner: "hyperflow", file: publicFile(prior) };
    await deps.reserve(org, uploadLease(id), candidate.path);
    let file: ManagedFile = await deps.transact(
      org,
      id,
      (r: ManagedFile | null) => {
        if (r && !sameFile(r, candidate))
          throw new FileError(409, "File request identity conflict");
        return r || candidate;
      },
    );
    if (file.state === "initializing") {
      const sessionSecret = await deps.provider.create(file);
      file = await deps.transact(org, id, (r: ManagedFile) => {
        if (r.state === "initializing") {
          r.sessionSecret = sessionSecret;
          r.state = "uploading";
        }
        return r;
      });
      // A losing initializer never uploads bytes or exposes its session URI.
    }
    if (file.state === "ready" || file.state === "deleted")
      await deps.release(org, uploadLease(id), file.path);
    return { owner: "hyperflow", file: publicFile(file) };
  }
  let file = await read(id, body.operation === "delete");
  if (body.operation === "delete") {
    if (file.actor !== actor && !["admin", "owner"].includes(member.role))
      throw new FileError(
        403,
        "File author or organization administrator required",
      );
    const removalReceipt = (f: ManagedFile) =>
      visibleFile(f, actor)
        ? publicFile(f)
        : {
            owner: "hyperflow",
            id: f.id,
            state: f.state,
            deletedAt: f.deletedAt,
            deletedBy: f.deletedBy,
          };
    if (file.state === "deleted") {
      await deps.release(org, deleteLease(id), file.path);
      await deps.release(org, uploadLease(id), file.path);
      return { owner: "hyperflow", file: removalReceipt(file) };
    }
    await deps.reserve(org, deleteLease(id), file.path);
    file = await deps.transact(org, id, (r: ManagedFile) => {
      if (r.state !== "deleted") r.state = "deleting";
      return r;
    });
    await deps.provider.close(file);
    file = await deps.transact(org, id, (r: ManagedFile) => {
      r.state = "deleted";
      r.deletedAt = Date.now();
      r.deletedBy = actor;
      delete r.sessionSecret;
      delete r.pending;
      return r;
    });
    await deps.release(org, uploadLease(id), file.path);
    await deps.release(org, deleteLease(id), file.path);
    return {
      owner: "hyperflow",
      file: removalReceipt(file),
      retained:
        "File receipt and provider soft-deleted versions/backups, if configured. No backup erasure claimed.",
    };
  }
  if (file.actor !== actor)
    throw new FileError(403, "The upload author must reconcile this operation");
  if (body.operation === "reconcile")
    return { owner: "hyperflow", file: publicFile(await finish(file)) };
  if (body.operation !== "chunk")
    throw new FileError(
      422,
      "Supported file operations are start, chunk, reconcile and delete",
    );
  if (
    typeof body.content !== "string" ||
    body.content.length > Math.ceil(FILE_CHUNK_BYTES / 3) * 4 ||
    !Number.isInteger(body.offset) ||
    body.offset < 0 ||
    body.offset % FILE_CHUNK_BYTES !== 0
  )
    throw new FileError(
      422,
      "A bounded base64 chunk and aligned offset are required",
    );
  const bytes = Buffer.from(body.content, "base64");
  if (
    !bytes.length ||
    bytes.toString("base64") !== body.content ||
    bytes.length !== Math.min(FILE_CHUNK_BYTES, file.bytes - body.offset)
  )
    throw new FileError(422, "Chunk size or encoding is invalid");
  const hash = createHash("sha256").update(bytes).digest("hex");
  file = await deps.transact(org, id, (r: ManagedFile) => {
    if (r.chunks?.[body.offset] && r.chunks[body.offset] !== hash)
      throw new FileError(409, "Chunk identity conflict");
    if (r.state === "ready" && r.chunks?.[body.offset] === hash) return r;
    if (r.state !== "uploading")
      throw new FileError(409, "Upload is not accepting data");
    if (
      r.pending &&
      (r.pending.offset !== body.offset || r.pending.hash !== hash)
    )
      throw new FileError(409, "Reconcile the pending chunk first");
    if (!r.pending && r.offset !== body.offset) {
      if (
        r.chunks?.[body.offset] === hash &&
        r.offset >= body.offset + bytes.length
      )
        return r;
      throw new FileError(
        409,
        "Upload offset changed; reconcile the original file",
      );
    }
    r.chunks = { ...r.chunks, [body.offset]: hash };
    r.pending = { offset: body.offset, hash, bytes: bytes.length };
    return r;
  });
  if (file.state === "ready")
    return { owner: "hyperflow", file: publicFile(await finish(file)) };
  const progress = await deps.provider.progress(file);
  if (!progress.object && progress.offset < body.offset + bytes.length) {
    if (progress.offset < body.offset)
      throw new FileError(409, "Provider offset has not reached this chunk");
    // Replaying identical bytes is safe even if the provider accepted only a prefix.
    await deps.provider.put(
      file,
      progress.offset,
      bytes.subarray(progress.offset - body.offset),
    );
  }
  return { owner: "hyperflow", file: publicFile(await finish(file)) };
}
export async function handleFiles(
  req: Parameters<typeof execute>[0],
  member: Member,
  deps = fileDependencies,
) {
  try {
    return await execute(req, member, deps);
  } catch (e) {
    if (e instanceof FileError) throw e;
    if (e instanceof LifecycleError) throw new FileError(e.status, e.message);
    // Provider errors can contain bearer upload URIs. Never return or log them.
    throw new FileError(
      503,
      "File operation is unresolved. Reconcile the original file before retrying.",
    );
  }
}
