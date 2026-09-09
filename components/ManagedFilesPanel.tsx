import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
import { uploadManagedFile } from "../services/managedFiles";
async function request(query = "", body?: any) {
  const response = await firebaseService.authorizedFetch(
    "/api/files" + query,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "File access unavailable");
  return result;
}
export function ManagedFilesPanel({
  initialId,
}: {
  initialId?: string;
  key?: string;
}) {
  const [rows, setRows] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<File | null>(null),
    [id, setId] = useState(""),
    [visibility, setVisibility] = useState<"private" | "organization">(
      "private",
    ),
    [progress, setProgress] = useState("");
  const [download, setDownload] = useState<{
    url: string;
    expiresAt: number;
  } | null>(null);
  const [uploadName, setUploadName] = useState("");
  const load = async (after = "") => {
    const data = await request(
      initialId
        ? "?id=" + encodeURIComponent(initialId)
        : "?after=" + encodeURIComponent(after),
    );
    setRows((prior) =>
      after ? [...prior, ...data.items] : initialId ? [data.file] : data.items,
    );
    setNext(data.next || null);
  };
  useEffect(() => {
    let live = true;
    request(initialId ? "?id=" + encodeURIComponent(initialId) : "")
      .then((data) => {
        if (live) {
          setRows(initialId ? [data.file] : data.items);
          setNext(data.next || null);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [initialId]);
  useEffect(() => {
    if (!download) return;
    const timeout = setTimeout(
      () => setDownload(null),
      Math.max(0, download.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [download]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!selected) return;
    const activeId = id || crypto.randomUUID();
    setId(activeId);
    const uid = firebaseService.getCurrentUser()?.uid,
      org = firebaseService.getCurrentOrgId();
    await uploadManagedFile(selected, uploadName || selected.name, {
      id: activeId,
      visibility,
      request,
      checkIdentity: () => {
        if (
          firebaseService.getCurrentUser()?.uid !== uid ||
          firebaseService.getCurrentOrgId() !== org
        )
          throw new Error("Account changed; upload stopped.");
      },
      progress: (offset, total) =>
        setProgress(`${Math.round((100 * offset) / total)}% uploaded`),
    });
    setId("");
    setUploadName("");
    setSelected(null);
    setProgress("Upload verified");
    await load();
  }
  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="text-xl font-semibold">Files and recordings</h2>
      <p>
        Private files are available to their author. Organization files are
        shared with current members. Upload progress remains here if your
        connection stops.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void action(() => load())}>
        Refresh files
      </button>
      {!initialId && (
        <div className="space-y-2">
          <label className="block">
            File
            <input
              type="file"
              disabled={busy}
              onChange={(e) => setSelected(e.target.files?.[0] || null)}
            />
          </label>
          <label className="block">
            Visibility
            <select
              disabled={busy || !!id}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
            >
              <option value="private">Only me</option>
              <option value="organization">Organization members</option>
            </select>
          </label>
          {id && (
            <p>Upload identity: {id}. Choose the same file to continue.</p>
          )}
          <button
            disabled={busy || !selected}
            onClick={() => void action(upload)}
          >
            {id ? "Continue this upload" : "Upload file"}
          </button>
          {id && (
            <button
              disabled={busy}
              onClick={() => {
                setId("");
                setUploadName("");
                setSelected(null);
                setProgress("");
              }}
            >
              Choose a different upload
            </button>
          )}
          {progress && <p role="status">{progress}</p>}
        </div>
      )}
      {rows.map((file) => (
        <article key={file.id} className="border rounded p-3 space-y-2">
          <h3 className="font-semibold">{file.name}</h3>
          <p>
            {file.visibility} · {file.state} · {file.offset} / {file.bytes}{" "}
            bytes
          </p>
          {file.state === "ready" && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setDownload(
                    await request(
                      "?id=" + encodeURIComponent(file.id) + "&download=1",
                    ),
                  );
                })
              }
            >
              Prepare private download
            </button>
          )}
          {["uploading", "initializing"].includes(file.state) && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await request("", { operation: "reconcile", id: file.id });
                    await load();
                  })
                }
              >
                Check upload progress
              </button>
              {!initialId && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setId(file.id);
                    setUploadName(file.name);
                    setVisibility(file.visibility);
                    setSelected(null);
                    setError(
                      "Choose the original file, then Continue this upload.",
                    );
                  }}
                >
                  Resume with original file
                </button>
              )}
            </>
          )}
          {file.state !== "deleted" && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  if (
                    !window.confirm(
                      `Delete ${file.name}? This cancels unfinished uploads and removes the stored file. The receipt and provider backups remain.`,
                    )
                  )
                    return;
                  setDownload(null);
                  await request("", { operation: "delete", id: file.id });
                  await load();
                })
              }
            >
              {file.state === "deleting"
                ? "Reconcile file deletion"
                : "Delete file"}
            </button>
          )}
          {file.state === "deleted" && (
            <p>File removed. Its receipt and any provider backups remain.</p>
          )}
        </article>
      ))}
      {download && (
        <p>
          <a href={download.url} target="_blank" rel="noopener noreferrer">
            Download file
          </a>{" "}
          · This private link expires in one minute.
        </p>
      )}
      {next && (
        <button disabled={busy} onClick={() => void action(() => load(next))}>
          More files
        </button>
      )}
      <p>
        Files are limited to 256 MB. Deletion does not erase copies already
        downloaded or provider backups.
      </p>
    </section>
  );
}
