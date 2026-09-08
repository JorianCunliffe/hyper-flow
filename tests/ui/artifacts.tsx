import React from "react";
import { createRoot } from "react-dom/client";
import { ArtifactsPanel } from "../../components/ArtifactsPanel";
import { firebaseService } from "../../services/firebaseService";
const data: any = {
  items: [],
  templates: [
    {
      id: "weekly-docx",
      version: 1,
      name: "Weekly operating report DOCX",
      format: "docx",
    },
  ],
  registryRevision: 0,
  connections: [],
};
firebaseService.authorizedFetch = async (input, options = {}) => {
  const url = new URL(String(input), "http://localhost"),
    b = options.body ? JSON.parse(String(options.body)) : null;
  document.getElementById("request-log")!.textContent = JSON.stringify(
    b,
    null,
    2,
  );
  if (!url.searchParams.get("projectId") && !b)
    return Response.json({
      projects: [{ id: "alpha", name: "Controlled fixture project" }],
    });
  if (b?.operation === "prepare")
    data.items.push({
      id: "a".repeat(64),
      projectId: "alpha",
      revision: 1,
      inputHash: "fixture",
      createdAt: Date.now(),
      template: data.templates[0],
      status: "proposed",
    });
  if (b?.operation === "approve") {
    data.items[0].status = "approved";
    data.items[0].revision++;
  }
  if (url.searchParams.get("id"))
    return Response.json({
      item: data.items[0],
      preview: [
        {
          title: "Overview",
          paragraphs: [
            "Controlled fixture: one accepted obligation remains open. Sources and input approval precede generation.",
          ],
        },
      ],
    });
  return Response.json(b ? { item: data.items[0] } : data);
};
createRoot(document.getElementById("root")!).render(<ArtifactsPanel />);
