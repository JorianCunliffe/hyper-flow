import React, { useEffect, useState, useRef } from "react";
import { firebaseService } from "../services/firebaseService";
const button = "rounded border px-3 py-2 disabled:opacity-40";
async function request(query = "", body?: any) {
  const response = await firebaseService.authorizedFetch(
    "/api/tenant?view=lifecycle" + query,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Account recovery unavailable");
  return result;
}
export function TenantLifecyclePanel() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [data, setData] = useState<any>(null),
    [cs, setCs] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<any>(null),
    [dataset, setDataset] = useState("projects");
  useEffect(() => {
    let live = true;
    request()
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const working: any = data?.lifecycle?.activeOperation
    ? data.lifecycle.receipts[data.lifecycle.activeOperation]
    : Object.values<any>(data?.lifecycle?.receipts || {}).find(
        (r) => r.status === "working",
      );
  async function refresh() {
    setData(await request());
  }
  async function command(body: any) {
    setBusy(true);
    setError("");
    setPending(body);
    try {
      await request("", body);
      setPending(null);
      await refresh();
      if (body.service === "communications")
        setCs(await request("&service=communications"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setError("");
    try {
      const chunks: Uint8Array[] = [];
      let offset: number | null = 0,
        hash = "",
        size = 0;
      do {
        if (!mounted.current)
          throw new Error("Account view changed; export cancelled");
        const page = await request(
          "&dataset=" +
            encodeURIComponent(dataset) +
            "&revision=" +
            data.lifecycle.revision +
            "&offset=" +
            offset,
        );
        if (hash && hash !== page.sha256)
          throw new Error(
            "Export changed; restart from the current account revision",
          );
        hash = page.sha256;
        const bytes = Uint8Array.from(atob(page.content), (c) =>
          c.charCodeAt(0),
        );
        size += bytes.length;
        if (size > 50 * 1024 * 1024)
          throw new Error(
            "This export exceeds the 50 MB browser limit. Use the paged export API.",
          );
        chunks.push(bytes);
        offset = page.nextOffset;
      } while (offset !== null);
      const blob = new Blob(chunks as BlobPart[], { type: "application/json" });
      const actual = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (actual !== hash) throw new Error("Export integrity check failed");
      if (!mounted.current)
        throw new Error("Account view changed; export cancelled");
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "hyperflow-" + dataset + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="text-xl font-semibold">Account recovery and export</h2>
      <p>
        Owner access only. These controls pause database activity. File storage
        and external provider resources require separate cleanup. Deletion is
        not enabled here.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className={button}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          refresh()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Refresh recovery records
      </button>
      {data && (
        <>
          <p>
            HyperFlow: {data.lifecycle.state} · revision{" "}
            {data.lifecycle.revision}
          </p>
          {!data.databaseGuardsEnabled && (
            <p>Database suspension is not enabled on this deployment.</p>
          )}
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              request("&service=communications")
                .then(setCs)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Read Communications state
          </button>
          {cs && (
            <div>
              <p>
                Communications: {cs.tenant.status} · revision{" "}
                {cs.tenant.lifecycle_revision}
              </p>
              {["active", "suspended"].includes(cs.tenant.status) && (
                <button
                  className={button}
                  disabled={busy || !!pending}
                  onClick={() =>
                    void command({
                      service: "communications",
                      operation:
                        cs.tenant.status === "active" ? "suspend" : "resume",
                      revision: cs.tenant.lifecycle_revision,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  {cs.tenant.status === "active" ? "Suspend" : "Resume"}{" "}
                  Communications database
                </button>
              )}
            </div>
          )}
          {["active", "suspended"].includes(data.lifecycle.state) && (
            <button
              className={button}
              disabled={busy || !!pending || !data.databaseGuardsEnabled}
              onClick={() =>
                void command({
                  operation:
                    data.lifecycle.state === "active" ? "suspend" : "resume",
                  revision: data.lifecycle.revision,
                  requestId: crypto.randomUUID(),
                })
              }
            >
              {data.lifecycle.state === "active" ? "Suspend" : "Resume"}{" "}
              HyperFlow database
            </button>
          )}
          {(pending || working) && (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                const r = working;
                void command(
                  pending ||
                    (r.operation.startsWith("communications.")
                      ? JSON.parse(r.detail).request
                      : {
                          operation: r.operation,
                          revision: data.lifecycle.revision,
                          requestId: r.id,
                        }),
                );
              }}
            >
              Reconcile the pending operation
            </button>
          )}
          <label>
            Export dataset{" "}
            <select
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            >
              {data.datasets.map((x: string) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button
            className={button}
            disabled={busy || data.lifecycle.state !== "suspended"}
            onClick={() => void download()}
          >
            Download reviewed dataset
          </button>
          <p>
            Export requires suspension. Credentials, file contents and
            Communications records are excluded. Downloaded copies remain your
            responsibility.
          </p>
          {Object.values<any>(data.lifecycle.receipts || {})
            .sort((a, b) => b.at - a.at)
            .slice(0, 50)
            .map((r) => (
              <p key={r.id}>
                {new Date(r.at).toLocaleString()} · {r.operation}: {r.status}
                {r.detail ? " · " + r.detail : ""}
              </p>
            ))}
        </>
      )}
    </section>
  );
}
