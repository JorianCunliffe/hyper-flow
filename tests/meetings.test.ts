import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMeetingRequest } from "../lib/communications/meetings";
import { CommunicationsApiError } from "../lib/communications/errors";
function fixture() {
  let existing: any = null,
    sent: any = null;
  const row: any = {
    id: "meeting",
    metadata: {
      version: 1,
      visibility: "project",
      topics: [{ projectId: "alpha" }],
    },
  };
  const client: any = {
    findMeeting: async () => existing,
    getMeeting: async () => row,
    listMeetings: async () => ({
      data: [
        row,
        {
          ...row,
          id: "foreign",
          metadata: { topics: [{ projectId: "beta" }] },
        },
      ],
      next: 50,
    }),
    importMeeting: async (org: string, input: any, actor: string) => {
      sent = { org, input, actor };
      return { id: row.id };
    },
  };
  const request = (method: string, body?: any, query?: any) =>
    handleMeetingRequest(
      { method, body, query },
      { orgId: "tenant", uid: "ceo" },
      { client, projects: async () => [{ id: "alpha" }] as any },
    );
  return {
    request,
    client,
    row,
    setExisting(value: any) {
      existing = value;
    },
    get sent() {
      return sent;
    },
  };
}
test("meeting imports derive tenant, actor and project authority from authenticated context", async () => {
  const f = fixture();
  await f.request("POST", {
    source: " generic ",
    externalId: " one ",
    topics: [{ projectId: "alpha" }],
    orgId: "foreign",
    initiator_id: "forged",
    allowedProjectIds: ["beta"],
    approved: true,
  });
  assert.equal(f.sent.org, "tenant");
  assert.equal(f.sent.actor, "ceo");
  assert.deepEqual(f.sent.input.allowedProjectIds, ["alpha"]);
  assert.equal(f.sent.input.approved, undefined);
  assert.equal(f.sent.input.source, "generic");
});
test("meeting reads and corrections enforce every topic scope and private source restrictions", async () => {
  const f = fixture();
  const page: any = await f.request("GET");
  assert.equal(page.data.length, 1);
  assert.equal(page.next, 50);
  for (const body of [
    { source: "generic", externalId: "one", topics: [{ projectId: "beta" }] },
    {
      source: "generic",
      externalId: "one",
      topics: [{ projectId: "alpha" }],
      visibility: "private",
    },
  ])
    await assert.rejects(f.request("POST", body), { status: 403 });
  f.setExisting({ metadata: { topics: [{ projectId: "beta" }] } });
  await assert.rejects(
    f.request("POST", {
      source: "generic",
      externalId: "one",
      topics: [{ projectId: "alpha" }],
    }),
    { status: 403 },
  );
  assert.equal(f.sent, null);
});
test("duplicate review never exposes another project meeting identifier", async () => {
  const f = fixture();
  f.client.importMeeting = async () => {
    throw new CommunicationsApiError("duplicate", 409, {
      error: "Review duplicate",
      details: { status: "needs_duplicate_review", matches: ["secret"] },
    });
  };
  await assert.rejects(
    f.request("POST", {
      source: "generic",
      externalId: "one",
      topics: [{ projectId: "alpha" }],
    }),
    (error: any) => {
      assert.deepEqual(error.details, { status: "needs_duplicate_review" });
      return true;
    },
  );
});
