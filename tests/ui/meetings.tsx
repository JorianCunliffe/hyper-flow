import React from "react";
import { createRoot } from "react-dom/client";
import { MeetingsPanel } from "../../components/MeetingsPanel";
import { firebaseService } from "../../services/firebaseService";
let rows: any[] = [];
firebaseService.authorizedFetch = async (input, options = {}) => {
  const url = new URL(String(input), "http://fixture");
  const body = options.body ? JSON.parse(String(options.body)) : null;
  document.getElementById("request-log")!.textContent = JSON.stringify(
    { path: url.pathname, body },
    null,
    2,
  );
  const result = (data: unknown) => new Response(JSON.stringify(data));
  if (url.pathname === "/api/commitments") return result({ data: [] });
  if (body) {
    const row = {
      id: "fixture-meeting",
      title: body.title,
      recorded_at: body.occurredAt,
      metadata: { ...body, version: 1 },
      history: [
        {
          version: 1,
          source_version: body.sourceVersion,
          created_at: new Date().toISOString(),
        },
      ],
    };
    rows = [row];
    return result({ item: row, receipt: { duplicate: false } });
  }
  return result(
    url.searchParams.has("id") ? { item: rows[0] } : { data: rows, next: null },
  );
};
createRoot(document.getElementById("root")!).render(
  <MeetingsPanel
    orgId="fixture"
    projects={
      [
        { id: "alpha", name: "Alpha report" },
        { id: "beta", name: "Beta project" },
      ] as any
    }
    onOpenObligations={() => {
      document.getElementById("request-log")!.textContent =
        "Opened obligations";
    }}
  />,
);
