import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../App";
import { firebaseService } from "../../services/firebaseService";
let org: string | null = "org_revocation_fixture";
firebaseService.isConfigured = () => true;
firebaseService.getCurrentOrgId = () => org;
firebaseService.getCurrentUser = () =>
  ({ uid: "revocation_fixture", email: "fixture@example.com" }) as any;
firebaseService.save = async () => {};
firebaseService.authorizedFetch = async () =>
  Response.json({ items: [], connections: [], projects: [], schedules: [] });
window.addEventListener("firebase-auth-changed", (e) => {
  if ((e as CustomEvent).detail?.accessRevoked) org = null;
});
firebaseService.subscribe = (callback, onError) => {
  const timer = setTimeout(
    () =>
      callback(
        org
          ? {
              projects: [
                {
                  id: "alpha",
                  name: "Confidential fixture project",
                  milestones: [],
                } as any,
              ],
              settings: {} as any,
              scratchTasks: [],
              activityLogs: [],
            }
          : null,
      ),
    0,
  );
  document.getElementById("revoke")!.onclick = () => {
    onError?.(
      Object.assign(
        new Error("Permission denied by controlled membership fixture"),
        { code: "PERMISSION_DENIED" },
      ),
    );
  };
  return () => clearTimeout(timer);
};
createRoot(document.getElementById("root")!).render(<App />);
