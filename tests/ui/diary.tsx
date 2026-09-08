import React from "react";
import { createRoot } from "react-dom/client";
import { DiaryPanel } from "../../components/DiaryPanel";
import { firebaseService } from "../../services/firebaseService";
const policy = {
  connectionId: "google_fixture",
  calendarId: "Personal diary",
  projectId: "alpha",
  timezone: "Australia/Brisbane",
  startHour: 9,
  endHour: 17,
  bufferMinutes: 15,
  bookingEnabled: false,
  revision: 1,
};
const data: any = {
  items: [
    {
      id: "fixture",
      calendarId: "Personal diary",
      connectionId: "google_fixture",
      policies: [policy],
      proposals: [],
      observations: [],
    },
  ],
  projects: [{ id: "alpha", name: "Fixture project" }],
  connections: [
    {
      id: "google_fixture",
      provider: "google",
      accountEmail: "ceo@example.test",
    },
  ],
};
firebaseService.authorizedFetch = async (input, options = {}) => {
  const body = options.body ? JSON.parse(String(options.body)) : null;
  document.getElementById("request-log")!.textContent = JSON.stringify(
    body,
    null,
    2,
  );
  if (body?.operation === "propose")
    data.items[0].proposals.push({
      id: "proposal_fixture",
      projectId: "alpha",
      revision: 1,
      hash: "fixture_hash",
      change: body.change,
      status: "review",
      ask: {
        prompt:
          "Approve this exact personal diary event. No guests or invitations.",
        status: "open",
      },
    });
  return new Response(JSON.stringify(body ? { item: data.items[0] } : data));
};
createRoot(document.getElementById("root")!).render(<DiaryPanel />);
