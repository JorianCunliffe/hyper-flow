import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { GlassNavigation } from "../../components/GlassNavigation";
import type { AppView } from "../../lib/appView";
function Preview() {
  const [view, setView] = useState<AppView>("diary");
  const [project, setProject] = useState<string | null>(null);
  return (
    <>
      <GlassNavigation
        activeView={view}
        onNavigate={setView}
        approvals={3}
        projects={[{ id: "fixture", name: "Communications test" }]}
        selectedProjectId={project}
        onProject={setProject}
        onSettings={() => setView("tenant")}
        onNewProject={() => {}}
        onInvite={() => {}}
        onLogout={() => {}}
        signedIn
        storageKey="hf-navigation-fixture"
      />
      <main className="hf-app-content" style={{ padding: 32 }}>
        <h1>{view}</h1>
        <p>
          Navigation acceptance fixture — no live account or external actions.
        </p>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
