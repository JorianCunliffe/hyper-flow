import React from "react";
import { createRoot } from "react-dom/client";
import { VisibleFlowsPanel } from "../../components/VisibleFlowsPanel";
import { firebaseService } from "../../services/firebaseService";
const records = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  projectId: "alpha",
  revision: 1,
  runs: [],
  versions: [
    {
      version: 1,
      hash: "controlled",
      createdAt: Date.now(),
      createdBy: "fixture",
      missing: [],
      ask: {
        id: "fixture-ask-" + n,
        prompt: "Review controlled flow " + n,
        status: "open",
      },
      plan: {
        name: "Controlled page " + n,
        steps: [
          {
            id: "read",
            name: "Read accepted work " + n,
            action: "read_operations",
            owner: "fixture",
            dependsOn: [],
            inputs: {},
            sources: [],
          },
        ],
      },
    },
  ],
}));
const catalog = {
  read_operations: {
    label: "Read accepted work",
    required: [],
    effect: "Read only",
  },
};
firebaseService.authorizedFetch = async (input) => {
  const q = new URL(String(input), "http://localhost").searchParams;
  if (q.get("id"))
    return Response.json({
      item: records.find((r) => r.id === q.get("id")),
      catalog,
    });
  const index = q.get("after") ? 1 : 0;
  const row = records[index];
  return Response.json({
    items: [
      {
        id: row.id,
        name: row.versions[0].plan.name,
        revision: row.revision,
        projectId: "alpha",
      },
    ],
    next: index === 0 ? row.id : null,
    catalog,
  });
};
createRoot(document.getElementById("root")!).render(
  <VisibleFlowsPanel
    projects={[{ id: "alpha", name: "Controlled pagination project" }] as any}
  />,
);
