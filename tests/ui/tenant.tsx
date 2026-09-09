import React from "react";
import { createRoot } from "react-dom/client";
import { TenantOperationsPanel } from "../../components/TenantOperationsPanel";
import { firebaseService } from "../../services/firebaseService";
const data: any = {
  organizationId: "org_fixture",
  revision: 0,
  clients: [],
  dailyLimit: 0,
  usage: {},
  audit: [],
};
let lost = true;
firebaseService.authorizedFetch = async (_input, options = {}) => {
  if(String(_input).includes('view=lifecycle'))return Response.json({owner:'hyperflow',databaseGuardsEnabled:false,lifecycle:{state:'active',revision:0,receipts:{}},datasets:['projects']});
  const b = options.body ? JSON.parse(String(options.body)) : null;
  if (!b) return Response.json(data);
  if (b.operation === "create_client") {
    if (!data.clients.length) {
      data.clients.push({
        id: "client_fixture",
        name: b.name,
        scopes: b.scopes,
        createdAt: Date.now(),
        expiresAt: b.expiresAt,
        revision: 1,
      });
      data.revision++;
    }
    if (lost) {
      lost = false;
      return Response.json(
        {
          error:
            "Controlled lost response after the client was saved. Retry the original request.",
        },
        { status: 503 },
      );
    }
    return Response.json({
      item: data.clients[0],
      revision: data.revision,
      credentialPrefix: "hf.org_fixture.client_fixture.",
    });
  }
  if (b.operation === "budget") {
    data.dailyLimit = b.dailyLimit;
    data.revision++;
  }
  if (b.operation === "revoke_client") {
    data.clients[0].revokedAt = Date.now();
    data.revision++;
  }
  return Response.json({ revision: data.revision });
};
createRoot(document.getElementById("root")!).render(<TenantOperationsPanel />);
