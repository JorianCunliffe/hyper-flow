import React from "react";
import { createRoot } from "react-dom/client";
import { PublishingPanel } from "../../components/PublishingPanel";
import { firebaseService } from "../../services/firebaseService";
const items: any[] = [];
firebaseService.authorizedFetch = async (input, options = {}) => {
  const url = new URL(String(input), "http://localhost"),
    b = options.body ? JSON.parse(String(options.body)) : null;
  if (!url.searchParams.get("projectId") && !b)
    return Response.json({
      projects: [{ id: "alpha", name: "Controlled publishing fixture" }],
    });
  if (b?.operation === "create") {
    items.push({
      id: "draft-one",
      projectId: "alpha",
      content: b.content,
      sourceNotes: b.sourceNotes,
      kind: b.kind,
      revision: 1,
      contentHash: "controlled-fingerprint",
      history: [],
      state: "draft",
    });
    return Response.json({ item: items[0] });
  }
  if (b?.operation === "edit") {
    const { history, ...previous } = items[0];
    history.push(structuredClone(previous));
    Object.assign(items[0], {
      content: b.content,
      sourceNotes: b.sourceNotes,
      revision: items[0].revision + 1,
    });
    return Response.json({ item: items[0] });
  }
  if (url.searchParams.get("id")) return Response.json({ item: items[0] });
  return Response.json({
    items: items.map((p) => ({ ...p, title: p.content.title })),
    targets: [],
    adapters: [],
    revision: 1,
  });
};
createRoot(document.getElementById("root")!).render(<PublishingPanel />);
