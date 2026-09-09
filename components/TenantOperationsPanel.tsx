import { TenantLifecyclePanel } from './TenantLifecyclePanel';
import { ManagedFilesPanel } from './ManagedFilesPanel';
import React, { useEffect, useState } from "react";
import { firebaseService } from "../services/firebaseService";
import { API_GROUPS } from "../lib/tenantControl/model";
const field = "rounded-lg border p-2 bg-white text-slate-900";
const button = "rounded-lg border px-3 py-2 font-semibold disabled:opacity-40";
export function TenantOperationsPanel() {
  const [data, setData] = useState<any>(null),
    [name, setName] = useState(""),
    [days, setDays] = useState(30),
    [scopes, setScopes] = useState<string[]>(["flows:read"]),
    [limit, setLimit] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [credential, setCredential] = useState(""),
    [pending, setPending] = useState<any>(null);
  async function request(body?: any) {
    const r = await firebaseService.authorizedFetch(
      "/api/tenant",
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {},
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || "Account operation failed");
    return value;
  }
  async function refresh() {
    const value = await request();
    setData(value);
    setLimit(value.dailyLimit);
  }
  useEffect(() => {
    let live = true;
    request()
      .then((r) => {
        if (live) {
          setData(r);
          setLimit(r.dailyLimit);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function command(body: any) {
    setBusy(true);
    setError("");
    try {
      const result = await request(body);
      if (result.credentialPrefix) {
        setCredential(result.credentialPrefix + body.secret);
        setPending(null);
      }
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function issue(operation: string, id?: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const body = {
      operation,
      id,
      revision: data.revision,
      requestId: crypto.randomUUID(),
      name,
      scopes,
      expiresAt: Date.now() + days * 86400000,
      secret: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
        "",
      ),
    };
    setCredential("");
    setPending(body);
    void command(body);
  }
  return (
    <section className="p-6 space-y-5 bg-slate-50 text-slate-900 overflow-auto">
      <h1 className="text-2xl font-bold">Account operations</h1>
      <p>
        Manage HyperFlow API access and request limits. Communications Service
        manages its own credentials and records separately.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          refresh()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Refresh account records
      </button>
      <button
        className={button}
        disabled={!credential}
        onClick={() => setCredential("")}
      >
        Hide credential
      </button>
      {credential && (
        <div className="border p-4 space-y-2">
          <label>
            New credential — copy it to your secret manager
            <textarea
              className={field + " w-full"}
              readOnly
              value={credential}
            />
          </label>
          <p>
            This value is held only in this screen. The server stores a salted
            hash. If you lose it, rotate or revoke the client.
          </p>
        </div>
      )}
      {pending && (
        <div className="border p-4">
          <p>
            The original credential request is retained until its result is
            confirmed. Retry uses the same secret and request, preventing
            duplicate clients. Refreshing the page loses the local secret; use
            the client list to rotate or revoke an uncertain result.
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const current = await request();
                setData(current);
                const retry = { ...pending, revision: current.revision };
                setPending(retry);
                await command(retry);
              } catch (e: any) {
                setError(e.message);
                setBusy(false);
              }
            }}
          >
            Retry same credential request
          </button>
        </div>
      )}
      {data && (
        <>
          <form
            className="border rounded-lg p-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              issue("create_client");
            }}
          >
            <h2 className="text-xl font-semibold">Create API access</h2>
            <label>
              Client name{" "}
              <input
                className={field}
                required
                maxLength={120}
                value={name}
                disabled={busy || !!pending}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Expires in days{" "}
              <input
                className={field}
                type="number"
                min={1}
                max={365}
                required
                value={days}
                disabled={busy || !!pending}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <p>
              Choose exactly which app areas this client may read or change.
              Write access can approve or execute the area's supported
              operations under your membership and existing provider policies.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {API_GROUPS.map((group) => (
                <fieldset key={group} className="border rounded p-2">
                  <legend>{group}</legend>
                  {(group==='tenant'?["read"]:["read", "write"]).map((mode) => {
                    const scope = group + ":" + mode;
                    return (
                      <label key={scope} className="mr-3">
                        <input
                          type="checkbox"
                          checked={scopes.includes(scope)}
                          disabled={busy || !!pending}
                          onChange={(e) =>
                            setScopes((old) =>
                              e.target.checked
                                ? [...old, scope]
                                : old.filter((s) => s !== scope),
                            )
                          }
                        />{" "}
                        {mode === "read" ? "Read" : "Change"}
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
            <button
              className={button}
              disabled={busy || !!pending || !name.trim() || !scopes.length}
            >
              Create scoped credential
            </button>
          </form>
          <form
            className="border rounded-lg p-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void command({
                operation: "budget",
                revision: data.revision,
                dailyLimit: limit,
              });
            }}
          >
            <h2 className="text-xl font-semibold">Daily API request budget</h2>
            <label>
              Requests per UTC day{" "}
              <input
                className={field}
                type="number"
                min={0}
                max={1000000}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <p>
              Zero means no API request cap. Counts cover these API clients,
              including authorized requests that later fail. Browser sessions,
              provider charges and the separate SMS/phone contact limits are
              excluded.
            </p>
            <button className={button} disabled={busy || !!pending}>
              Save API request budget
            </button>
          </form>
          <h2 className="text-xl font-semibold">API clients</h2>
          {data.clients.length === 0 && (
            <p>No API clients have been created.</p>
          )}
          {data.clients.map((c: any) => (
            <article key={c.id} className="border rounded p-4 space-y-2">
              <h3 className="font-bold">{c.name}</h3>
              <p>
                {c.revokedAt
                  ? "Revoked"
                  : c.expiresAt <= Date.now()
                    ? "Expired"
                    : "Active"}{" "}
                · expires {new Date(c.expiresAt).toLocaleString()}
              </p>
              <p className="break-all text-sm">
                {c.id} · {c.scopes.join(", ")}
              </p>
              {!c.revokedAt && (
                <>
                  <button
                    className={button}
                    disabled={busy || !!pending}
                    onClick={() => issue("rotate_client", c.id)}
                  >
                    Rotate {c.name}
                  </button>
                  <button
                    className={button}
                    disabled={busy || !!pending}
                    onClick={() =>
                      void command({
                        operation: "revoke_client",
                        id: c.id,
                        revision: data.revision,
                      })
                    }
                  >
                    Revoke {c.name}
                  </button>
                </>
              )}
            </article>
          ))}
          <h2 className="text-xl font-semibold">Recent API use</h2>
          {Object.entries<any>(data.usage || {})
            .sort()
            .reverse()
            .map(([day, row]) => (
              <p key={day}>
                {day}: {row.requests} requests
              </p>
            ))}
          <h2 className="text-xl font-semibold">Administration history</h2>
          <p>
            Up to 1,000 recent events and 90 days of API-use counters are
            retained in this view.
          </p>
          {[...(data.audit || [])]
            .reverse()
            .slice(0, 50)
            .map((a: any) => (
              <p key={a.id} className="text-sm">
                {new Date(a.at).toLocaleString()} · {a.operation} · {a.resource}{" "}
                · {a.actor}
              </p>
            ))}
        </>
      )}
      <TenantLifecyclePanel />
      <ManagedFilesPanel />
    </section>
  );
}
