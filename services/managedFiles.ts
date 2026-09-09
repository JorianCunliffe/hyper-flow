import { crc32cUpdate, crc32cBase64 } from "../lib/files/crc32c";
import { FILE_CHUNK_BYTES, MAX_FILE_BYTES } from "../lib/files/model";
export async function uploadManagedFile(
  file: Blob,
  name: string,
  options: {
    id?: string;
    visibility: "private" | "organization";
    request: (query: string, body?: any) => Promise<any>;
    checkIdentity: () => void;
    progress?: (offset: number, total: number) => void;
  },
) {
  if (file.size < 1 || file.size > MAX_FILE_BYTES)
    throw new Error("Files must contain 1 byte to 256 MB");
  const id = options.id || crypto.randomUUID();
  let crc = 0;
  for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
    options.checkIdentity();
    crc = crc32cUpdate(
      new Uint8Array(
        await file.slice(offset, offset + FILE_CHUNK_BYTES).arrayBuffer(),
      ),
      crc,
    );
  }
  options.checkIdentity();
  let result = await options.request("", {
    operation: "start",
    id,
    name,
    mime: file.type.split(";")[0] || "application/octet-stream",
    bytes: file.size,
    crc32c: crc32cBase64(crc),
    visibility: options.visibility,
  });
  options.checkIdentity();
  if (result.file.state === "deleting" || result.file.state === "deleted")
    throw new Error("This file was cancelled. Choose a new upload identity.");
  while (result.file.state !== "ready") {
    options.checkIdentity();
    const offset = result.file.pending?.offset ?? result.file.offset;
    if (offset >= file.size) {
      result = await options.request("", { operation: "reconcile", id });
      if (result.file.state !== "ready")
        throw new Error(
          "Upload completion is unresolved. Reconcile this file.",
        );
      break;
    }
    const bytes = new Uint8Array(
      await file.slice(offset, offset + FILE_CHUNK_BYTES).arrayBuffer(),
    );
    let binary = "";
    for (let at = 0; at < bytes.length; at += 8192)
      binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
    options.checkIdentity();
    result = await options.request("", {
      operation: "chunk",
      id,
      offset,
      content: btoa(binary),
    });
    options.checkIdentity();
    options.progress?.(result.file.offset, file.size);
  }
  options.checkIdentity();
  return result.file;
}
