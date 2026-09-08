import React from "react";
import { createRoot } from "react-dom/client";
import { VisibleFlowsPanel } from "../../components/VisibleFlowsPanel";
import { firebaseService } from "../../services/firebaseService";
const catalog = {
  write_report: {
    label: "Prepare report draft",
    required: ["prompt"],
    effect: "Generates draft text; does not deliver",
  },
};
const proposal = {
  name: "Weekly report",
  steps: [
    {
      id: "report",
      name: "Prepare weekly draft",
      action: "write_report",
      owner: "",
      dependsOn: [],
      inputs: { prompt: "Summarize supplied evidence and identify unknowns." },
      sources: [],
    },
  ],
};
firebaseService.authorizedFetch = async (_input, options = {}) => {
  const body = options.body ? JSON.parse(String(options.body)) : null;
  document.getElementById("request-log")!.textContent = JSON.stringify(
    body,
    null,
    2,
  );
  return new Response(
    JSON.stringify(
      body?.operation === "compile" ? { proposal } : { items: [], catalog },
    ),
  );
};
createRoot(document.getElementById("root")!).render(
  <VisibleFlowsPanel
    projects={[{ id: "fixture", name: "Fixture project" }] as any}
  />,
);
