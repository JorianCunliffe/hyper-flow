import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { HttpCommunicationsClient } from "../../lib/communications/client";
import { executeVisibleStep } from "../../lib/visibleFlows/runtime";
import type { FlowRun, FlowStep } from "../../lib/visibleFlows/model";
test("Phase 06 visible-flow context uses the real Communications HTTP contract and external project scope", async () => {
  const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;
  assert.ok(checkout);
  const { createPhase02Database } = await import(
    pathToFileURL(resolve(checkout, "test/fixtures/phase02Database.js")).href
  );
  const fixture = await createPhase02Database(
    "phase06_context",
    "local_phase06",
  );
  try {
    const client = new HttpCommunicationsClient({
      baseUrl: await fixture.app.listen({ host: "127.0.0.1", port: 0 }),
      apiKey: "local_phase06",
    });
    await client.importMeeting("phase06_context", {
      source: "upload",
      externalId: "phase06",
      sourceVersion: "1",
      title: "Supplier update",
      occurredAt: "2026-09-08T09:00:00+10:00",
      attendees: [],
      topics: [
        {
          id: "alpha",
          title: "Alpha supplier",
          projectId: "alpha",
          segments: [
            {
              id: "one",
              speakerId: null,
              text: "Controlled alpha source receipt.",
            },
          ],
        },
        {
          id: "beta",
          title: "Beta confidential",
          projectId: "beta",
          segments: [
            {
              id: "two",
              speakerId: null,
              text: "Excluded beta source receipt.",
            },
          ],
        },
      ],
      allowedProjectIds: ["alpha", "beta"],
    });
    const run = { projectId: "alpha" } as FlowRun;
    const step = {
      id: "context",
      action: "read_context",
      inputs: {},
    } as FlowStep;
    const outcome = await executeVisibleStep(
      "phase06_context",
      run,
      step,
      "fixture-operation",
      { client, projectExists: async () => true },
    );
    assert.equal(outcome.status, "success");
    assert.match(
      JSON.stringify(outcome.output),
      /Controlled alpha source receipt/,
    );
    assert.doesNotMatch(
      JSON.stringify(outcome.output),
      /Excluded beta source receipt/,
    );
  } finally {
    await fixture.close();
  }
});
