import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";
test("Phase 08 actual Firebase proposals and Communications observations preserve cold claims, approval and isolation", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
  const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;
  assert.ok(checkout);
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: "demo-hyperflow",
    client_email: "fixture@demo-hyperflow.iam.gserviceaccount.com",
    private_key: privateKey,
  });
  process.env.FIREBASE_DATABASE_URL = "https://demo-hyperflow.firebaseio.com";
  const { createPhase02Database } = await import(
    pathToFileURL(resolve(checkout, "test/fixtures/phase02Database.js")).href
  );
  const cs = await createPhase02Database("phase08_fixture", "phase08_key");
  const address = await cs.app.listen({ host: "127.0.0.1", port: 0 });
  process.env.COMMUNICATIONS_API_URL = address;
  process.env.COMMUNICATIONS_API_KEY = "phase08_key";
  const { handleCalendar } = await import("../../lib/calendar/api");
  const { CalendarError } = await import("../../lib/calendar/model");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const member = { orgId: "phase08_fixture", uid: "calendar_ceo" };
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.database();
      await set(ref(db, `users/${member.uid}`), { orgId: member.orgId });
      await set(
        ref(db, `organizations/${member.orgId}/members/${member.uid}`),
        { role: "owner" },
      );
      await set(ref(db, `projects/${member.orgId}/projects`), [
        {
          id: "alpha",
          name: "Alpha",
          company: "Fixture",
          type: "test",
          startDate: 1,
          createdAt: 1,
          updatedAt: 1,
          milestones: [],
        },
      ]);
    });
    let writes = 0;
    const events = new Map<string, any>();
    const provider = {
      calendars: async () => [
        { id: "diary", summary: "Fixture", accessRole: "owner" },
      ],
      events: async () => [...events.values()],
      get: async (_id: string, eventId: string) => {
        if (!events.has(eventId)) throw new CalendarError(404, "Not found");
        return events.get(eventId);
      },
      write: async (
        _id: string,
        change: any,
        eventId: string,
        hash: string,
      ) => {
        writes++;
        const event = {
          id: eventId,
          etag: "receipt-etag",
          summary: change.summary,
          description: change.description,
          start: { dateTime: change.start },
          end: { dateTime: change.end },
          extendedProperties: { private: { hyperflowOperation: hash } },
        };
        events.set(eventId, event);
        return event;
      },
    };
    const deps = { provider: () => provider };
    const configured: any = await handleCalendar(
      {
        method: "POST",
        body: {
          operation: "configure",
          projectId: "alpha",
          expectedPolicyRevision: 0,
          policy: {
            connectionId: "google_fixture",
            calendarId: "diary",
            timezone: "Australia/Brisbane",
            startHour: 9,
            endHour: 17,
            bufferMinutes: 15,
            bookingEnabled: true,
          },
        },
      },
      member,
      deps,
    );
    const calendarKey = configured.item.id;
    const proposed: any = await handleCalendar(
      {
        method: "POST",
        body: {
          operation: "propose",
          projectId: "alpha",
          calendarKey,
          change: {
            operation: "create",
            summary: "Controlled calendar acceptance",
            description: "No external invitees",
            start: "2026-09-10T00:00:00Z",
            end: "2026-09-10T01:00:00Z",
            timezone: "Australia/Brisbane",
          },
        },
      },
      member,
      deps,
    );
    const proposal = proposed.item.proposals[0];
    assert.equal(proposal.ask.token, undefined);
    const approved: any = await handleCalendar(
      {
        method: "POST",
        body: {
          operation: "approve",
          projectId: "alpha",
          calendarKey,
          proposalId: proposal.id,
          expectedRevision: proposal.revision,
          hash: proposal.hash,
        },
      },
      member,
      deps,
    );
    const p = approved.item.proposals[0];
    const request = {
      method: "POST",
      body: {
        operation: "execute",
        projectId: "alpha",
        calendarKey,
        proposalId: p.id,
        expectedRevision: p.revision,
        hash: p.hash,
      },
    };
    const outcomes = await Promise.allSettled([
      handleCalendar(request, member, deps),
      handleCalendar(request, member, deps),
    ]);
    assert.equal(writes, 1);
    const success: any = outcomes.find((r) => r.status === "fulfilled");
    assert.equal(success.value.item.proposals[0].status, "verified");
    assert.equal(success.value.item.proposals[0].context.state, "synced");
    const canonical = await cs.sql.query(
      "select title,metadata from calendar_events where tenant_id=$1",
      [member.orgId],
    );
    assert.equal(canonical.rows.length, 1);
    assert.equal(canonical.rows[0].metadata.external_project_id, "alpha");
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `calendar_ledgers/${member.orgId}`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `calendar_ledgers/${member.orgId}/forged`,
        ),
        { approvedBy: member.uid },
      ),
    );
    const { listCalendarLedgers } = await import("../../lib/serverStore");
    assert.deepEqual(await listCalendarLedgers("other_tenant"), []);
  } finally {
    await env.cleanup();
    await cs.close();
    await Promise.all(getApps().map(deleteApp));
  }
});
