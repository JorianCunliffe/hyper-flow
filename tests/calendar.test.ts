import test from "node:test";
import assert from "node:assert/strict";
import { handleCalendar } from "../lib/calendar/api";
import {
  calendarKey,
  CalendarError,
  assertAvailable,
  assertPersonalEvent,
  validateChange,
  type CalendarLedger,
  type CalendarPolicy,
  type DiaryEvent,
} from "../lib/calendar/model";
import { calendarInstant } from "../lib/calendar/time";
import type { CalendarStore } from "../lib/calendar/store";
import { GoogleCalendar, CALENDAR_WRITE_SCOPE } from "../lib/calendar/google";
const member = { orgId: "tenant-a", uid: "ceo" };
const policy: CalendarPolicy = {
  connectionId: "google_fixture",
  calendarId: "diary",
  projectId: "alpha",
  timezone: "Australia/Brisbane",
  startHour: 9,
  endHour: 17,
  bufferMinutes: 15,
  bookingEnabled: true,
  revision: 1,
  configuredBy: "ceo",
};
const change = {
  operation: "create",
  summary: "Prepare weekly report",
  description: "Controlled fixture",
  start: "2026-09-10T00:00:00Z",
  end: "2026-09-10T01:00:00Z",
  timezone: policy.timezone,
  sourceIds: ["ob_fixture"],
};
function fixture() {
  const rows = new Map<string, CalendarLedger>();
  let tail = Promise.resolve();
  const store: CalendarStore = {
    read: async (org, id) => structuredClone(rows.get(org + id) || null),
    list: async (org) =>
      [...rows.entries()]
        .filter(([key]) => key.startsWith(org))
        .map(([, row]) => structuredClone(row)),
    transact: async (org, id, update) => {
      let release!: () => void;
      const prior = tail;
      tail = new Promise<void>((resolve) => (release = resolve));
      await prior;
      try {
        const row = JSON.parse(
          JSON.stringify(update(structuredClone(rows.get(org + id) || null))),
        );
        rows.set(org + id, row);
        return structuredClone(row);
      } finally {
        release();
      }
    },
  };
  const id = calendarKey(policy.connectionId, policy.calendarId);
  rows.set(member.orgId + id, {
    id,
    connectionId: policy.connectionId,
    calendarId: policy.calendarId,
    policies: { alpha: policy },
    proposals: {},
  });
  const events = new Map<string, DiaryEvent>();
  let writes = 0,
    lost = false;
  let beforeWrite: () => Promise<void> = async () => {};
  const provider = {
    calendars: async () => [
      { id: "diary", summary: "Fixture diary", accessRole: "owner" },
    ],
    events: async () => [...events.values()],
    get: async (_calendar: string, eventId: string) => {
      const event = events.get(eventId);
      if (!event) throw new CalendarError(404, "Not found");
      return structuredClone(event);
    },
    write: async (_calendar: string, c: any, eventId: string, hash: string) => {
      writes++;
      await beforeWrite();
      if (c.operation === "cancel") {
        events.delete(eventId);
        return {} as DiaryEvent;
      }
      const event: DiaryEvent = {
        id: eventId,
        etag: "etag-" + writes,
        summary: c.summary,
        description: c.description,
        start: { dateTime: c.start },
        end: { dateTime: c.end },
        extendedProperties: { private: { hyperflowOperation: hash } },
      };
      events.set(eventId, event);
      if (lost) throw new Error("Connection lost after provider acceptance");
      return event;
    },
  };
  const deps = {
    store,
    provider: () => provider,
    projects: async () => [{ id: "alpha", name: "Alpha" }] as any,
    connections: async () => [],
    member: async (uid: string) => {
      if (uid !== "ceo") throw new CalendarError(403, "Membership revoked");
      return { role: "owner" } as any;
    },
    sync: async () => ({ event: { id: "calendar_context" } }),
  };
  const request = (body: any, actor = member) =>
    handleCalendar(
      {
        method: "POST",
        body: { projectId: "alpha", calendarKey: id, ...body },
      },
      actor,
      deps,
    );
  const propose = async (c = change) => {
    const result: any = await request({ operation: "propose", change: c });
    const p = result.item.proposals.at(-1);
    const approved: any = await request({
      operation: "approve",
      proposalId: p.id,
      expectedRevision: p.revision,
      hash: p.hash,
    });
    return approved.item.proposals.find((row: any) => row.id === p.id);
  };
  return {
    store,
    request,
    propose,
    id,
    events,
    provider,
    deps,
    get writes() {
      return writes;
    },
    set lost(value: boolean) {
      lost = value;
    },
    set beforeWrite(fn: () => Promise<void>) {
      beforeWrite = fn;
    },
  };
}
test("calendar proposals require exact separate approval, preserve draft-only authority, and execute once with verified receipts", async () => {
  const f = fixture();
  const raw: any = await f.request({ operation: "propose", change });
  const proposal = raw.item.proposals[0];
  assert.equal(proposal.status, "review");
  assert.equal(proposal.ask.token, undefined);
  assert.equal(f.writes, 0);
  await assert.rejects(
    f.request({
      operation: "execute",
      proposalId: proposal.id,
      hash: proposal.hash,
      expectedRevision: 1,
    }),
    /approved/,
  );
  await assert.rejects(
    f.request({
      operation: "approve",
      proposalId: proposal.id,
      hash: "changed",
      expectedRevision: 1,
    }),
    /exact/,
  );
  await assert.rejects(
    f.request(
      {
        operation: "approve",
        proposalId: proposal.id,
        hash: proposal.hash,
        expectedRevision: 1,
      },
      { ...member, uid: "other" },
    ),
    /reviewer/,
  );
  const approved: any = await f.request({
    operation: "approve",
    proposalId: proposal.id,
    hash: proposal.hash,
    expectedRevision: 1,
  });
  const p = approved.item.proposals[0];
  const run = {
    operation: "execute",
    proposalId: p.id,
    hash: p.hash,
    expectedRevision: p.revision,
  };
  const result: any = await f.request(run);
  assert.equal(result.item.proposals[0].status, "verified");
  assert.equal(result.item.proposals[0].context.state, "synced");
  await f.request(run);
  assert.equal(f.writes, 1);
  await assert.rejects(
    f.request({
      operation: "propose",
      change: { ...change, attendees: [{ email: "outside@example.test" }] },
    }),
    /invitations/,
  );
  const other: any = await handleCalendar(
    { method: "GET" },
    { orgId: "other", uid: "ceo" },
    f.deps,
  );
  assert.equal(other.items.length, 0);
});
test("lost calendar response is reconciled by stable provider identity without repeating the write", async () => {
  const f = fixture(),
    p = await f.propose();
  f.lost = true;
  const result: any = await f.request({
    operation: "execute",
    proposalId: p.id,
    hash: p.hash,
    expectedRevision: p.revision,
  });
  assert.equal(result.item.proposals[0].status, "uncertain");
  await assert.rejects(
    f.request({
      operation: "execute",
      proposalId: p.id,
      hash: p.hash,
      expectedRevision: p.revision,
    }),
    /reconcile/,
  );
  const fixed: any = await f.request({
    operation: "reconcile",
    proposalId: p.id,
  });
  assert.equal(fixed.item.proposals[0].status, "verified");
  assert.equal(f.writes, 1);
});
test("one calendar lock prevents concurrent HyperFlow bookings and rechecks current availability", async () => {
  const f = fixture(),
    one = await f.propose(),
    two = await f.propose();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  f.beforeWrite = async () => {
    entered();
    await gate;
  };
  const first = f.request({
    operation: "execute",
    proposalId: one.id,
    hash: one.hash,
    expectedRevision: one.revision,
  });
  await started;
  await assert.rejects(
    f.request({
      operation: "execute",
      proposalId: two.id,
      hash: two.hash,
      expectedRevision: two.revision,
    }),
    /Another operation/,
  );
  release();
  await first;
  const blocked: any = await f.request({
    operation: "execute",
    proposalId: two.id,
    hash: two.hash,
    expectedRevision: two.revision,
  });
  assert.equal(
    blocked.item.proposals.find((p: any) => p.id === two.id).status,
    "conflict",
  );
  assert.equal(f.writes, 1);
});
test("changed event revisions and disabled policy block writes; cancellation verifies absence", async () => {
  const f = fixture(),
    p = await f.propose();
  await f.store.transact(member.orgId, f.id, (row) => {
    row!.policies.alpha.bookingEnabled = false;
    return row!;
  });
  await assert.rejects(
    f.request({
      operation: "execute",
      proposalId: p.id,
      hash: p.hash,
      expectedRevision: p.revision,
    }),
    /disabled/,
  );
  assert.equal(f.writes, 0);
  await f.store.transact(member.orgId, f.id, (row) => {
    row!.policies.alpha.bookingEnabled = true;
    return row!;
  });
  f.events.set("existing", {
    id: "existing",
    etag: "e1",
    summary: "Original",
    start: { dateTime: change.start },
    end: { dateTime: change.end },
  });
  const update = await f.propose({
    ...change,
    operation: "update",
    eventId: "existing",
    etag: "e1",
  } as any);
  f.events.get("existing")!.etag = "e2";
  const held: any = await f.request({
    operation: "execute",
    proposalId: update.id,
    hash: update.hash,
    expectedRevision: update.revision,
  });
  assert.equal(
    held.item.proposals.find((p: any) => p.id === update.id).status,
    "conflict",
  );
  assert.equal(f.writes, 0);
  const cancel = await f.propose({
    ...change,
    operation: "cancel",
    eventId: "existing",
    etag: "e2",
  } as any);
  const result: any = await f.request({
    operation: "execute",
    proposalId: cancel.id,
    hash: cancel.hash,
    expectedRevision: cancel.revision,
  });
  assert.equal(
    result.item.proposals.find((p: any) => p.id === cancel.id).receipt.status,
    "observed_cancelled",
  );
  assert.equal(f.events.has("existing"), false);
});
test("calendar local times reject daylight-saving ambiguity, invalid dates, unsafe series and hidden conflicts", () => {
  assert.equal(
    calendarInstant("2026-09-10T10:00", "Australia/Brisbane"),
    "2026-09-10T00:00:00.000Z",
  );
  assert.throws(
    () => calendarInstant("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => calendarInstant("2026-11-01T01:30", "America/New_York"),
    /twice/,
  );
  assert.throws(
    () => calendarInstant("2026-02-30T10:00", "Australia/Brisbane"),
    /valid/,
  );
  const c = validateChange(change, policy);
  assert.throws(
    () =>
      assertAvailable(
        c,
        [
          {
            id: "all-day",
            etag: "x",
            start: { date: "2026-09-10" },
            end: { date: "2026-09-11" },
          },
        ],
        policy,
      ),
    /all-day/,
  );
  assert.throws(
    () =>
      assertPersonalEvent(
        { id: "series", etag: "x", recurrence: ["RRULE:FREQ=WEEKLY"] },
        c,
      ),
    /whole-series/,
  );
  assert.throws(
    () =>
      assertPersonalEvent(
        {
          id: "instance",
          etag: "x",
          recurringEventId: "series",
          start: { dateTime: change.start },
          end: { dateTime: change.end },
        },
        c,
      ),
    /Explicitly/,
  );
});
test("Google adapter sends conditional writes, keeps existing private properties and never supplies guests", async () => {
  const requests: any[] = [];
  const google = new GoogleCalendar("org", "connection", {
    connections: async () =>
      [
        {
          id: "connection",
          state: "connected",
          scopes: [CALENDAR_WRITE_SCOPE],
        },
      ] as any,
    token: async () => "fixture-token",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          id: "event",
          etag: "e1",
          extendedProperties: { private: { existing: "preserved" } },
        }),
      );
    },
  });
  await google.write(
    "diary",
    {
      ...validateChange(change, policy),
      operation: "update",
      eventId: "event",
      etag: "e1",
    },
    "event",
    "hash",
  );
  const write = requests.at(-1);
  assert.equal(write.init.headers["If-Match"], "e1");
  const body = JSON.parse(write.init.body);
  assert.equal(body.extendedProperties.private.existing, "preserved");
  assert.equal(body.attendees, undefined);
  assert.match(write.url, /sendUpdates=none/);
});

test("calendar authority changes before dispatch and competing connection aliases cannot bypass the calendar lock", async () => {
  const f = fixture(),
    p = await f.propose();
  assert.equal(
    calendarKey("first-account", "diary"),
    calendarKey("second-account", "diary"),
  );
  await assert.rejects(
    f.request({
      operation: "configure",
      expectedPolicyRevision: 1,
      policy: { ...policy, connectionId: "another-account" },
    }),
    /another connected account/,
  );
  f.provider.events = async () => {
    await f.store.transact(member.orgId, f.id, (row) => {
      row!.policies.alpha.bookingEnabled = false;
      row!.policies.alpha.revision++;
      return row!;
    });
    return [];
  };
  const result: any = await f.request({
    operation: "execute",
    proposalId: p.id,
    hash: p.hash,
    expectedRevision: p.revision,
  });
  assert.equal(result.item.proposals[0].status, "conflict");
  assert.equal(f.writes, 0);
});
test("an independently created overlapping event is detected after writing without silent rollback or repeated booking", async () => {
  const f = fixture(),
    p = await f.propose();
  f.beforeWrite = async () => {
    f.events.set("external-race", {
      id: "external-race",
      etag: "external",
      start: { dateTime: change.start },
      end: { dateTime: change.end },
    });
  };
  const result: any = await f.request({
    operation: "execute",
    proposalId: p.id,
    hash: p.hash,
    expectedRevision: p.revision,
  });
  assert.equal(result.item.proposals[0].status, "conflict");
  assert.equal(result.item.proposals[0].receipt.status, "observed_conflict");
  assert.equal(f.writes, 1);
  assert.equal(f.events.size, 2);
});
