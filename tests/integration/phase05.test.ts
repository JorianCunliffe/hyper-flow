import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { HttpCommunicationsClient } from "../../lib/communications/client";
import { handleMeetingRequest } from "../../lib/communications/meetings";
import { handleMemoryContextRequest } from "../../lib/communications/memoryContext";
import { handleCommitments } from "../../lib/commitments/api";
import type { Commitment } from "../../lib/commitments/model";
test("Phase 05: transcript to scoped evidence to accepted Ask, with duplicate and correction recovery", async () => {
  const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;
  assert.ok(checkout);
  const load = (file: string) =>
    import(pathToFileURL(resolve(checkout, file)).href);
  const { createPhase02Database } = await load(
    "test/fixtures/phase02Database.js",
  );
  const { createPostgresClient } = await load("database.js");
  const { tenantDatabase } = await load("tenantContext.js");
  const { storeCommitments } = await load("enrichment.js");
  const tenant = "phase05_acceptance",
    key = "local-phase05";
  const { app, sql, close } = await createPhase02Database(tenant, key);
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new HttpCommunicationsClient({
      baseUrl: address,
      apiKey: key,
    });
    const projects = async () => [{ id: "alpha" }, { id: "beta" }] as any,
      member = { orgId: tenant, uid: "ceo" };
    const input = {
      source: "upload",
      externalId: "review",
      sourceVersion: "1",
      title: "CEO review",
      occurredAt: "2026-09-08T09:00:00+10:00",
      attendees: [],
      topics: [
        {
          id: "a",
          title: "Report",
          projectId: "alpha",
          segments: [
            {
              id: "a1",
              speaker: "Unknown speaker",
              text: "I will send the report Friday.",
            },
          ],
        },
        {
          id: "b",
          title: "Other matter",
          projectId: "beta",
          segments: [{ id: "b1", text: "Budget is still under review." }],
        },
      ],
    };
    const ingest = (body: any) =>
      handleMeetingRequest({ method: "POST", body }, member, {
        client,
        projects,
      }) as Promise<any>;
    const first = await ingest(input);
    const retry = await ingest(input);
    assert.equal(first.item.id, retry.item.id);
    assert.equal(retry.receipt.duplicate, true);
    const topics = first.item.metadata.topics;
    assert.notEqual(topics[0].threadId, topics[1].threadId);
    const evidence = (
      await sql.query(
        "select * from communications where communication_id=$1",
        [topics[0].communicationId],
      )
    ).rows[0];
    await storeCommitments(
      tenantDatabase(createPostgresClient(sql), tenant),
      evidence,
      {},
    );
    const records = new Map<string, Commitment>();
    const deps = {
      projects,
      people: async () => [],
      member: async (uid: string) => ({
        ...member,
        uid,
        role: "member" as const,
      }),
      memory: (request: any, actor: any) =>
        handleMemoryContextRequest(request, actor, {
          client,
          listProjects: projects,
        }),
      read: async (_: string, id: string) => records.get(id) || null,
      list: async () => ({ rows: [...records.values()], next: null }),
      transact: async (
        _: string,
        id: string,
        update: (row: Commitment | null) => Commitment,
      ) => {
        const row = update(records.get(id) || null);
        records.set(id, row);
        return row;
      },
    };
    const request = (method: string, body?: any, query?: any) =>
      handleCommitments({ method, body, query }, member, deps) as Promise<any>;
    const candidates = await request("GET", undefined, {
      view: "candidates",
      projectId: "alpha",
      threadId: topics[0].threadId,
    });
    assert.equal(candidates.data.length, 1);
    const imported = await request("POST", {
      projectId: "alpha",
      threadId: topics[0].threadId,
      sourceId: candidates.data[0].id,
    });
    const duplicate = await request("POST", {
      projectId: "alpha",
      threadId: topics[0].threadId,
      sourceId: candidates.data[0].id,
    });
    assert.equal(imported.item.id, duplicate.item.id);
    const terms = {
      owner: "user:ceo",
      beneficiary: "user:ceo",
      deliverable: "Send the report",
      criteria: "Reviewed report attached",
      dueAt: "2026-09-11T17:00:00+10:00",
      timezone: "Australia/Brisbane",
    };
    const respond = (row: any, extra: any) =>
      request("PATCH", {
        id: row.id,
        expectedVersion: row.version,
        action: "respond",
        askId: row.review.ask.id,
        ...extra,
      });
    const clarified = await respond(imported.item, {
      terms,
      note: "CEO supplies the missing owner, beneficiary and delivery criteria.",
    });
    assert.equal(clarified.item.state, "candidate");
    const accepted = await respond(clarified.item, {
      decision: "approved",
      note: "CEO explicitly accepts the reviewed report and deadline.",
    });
    assert.equal(accepted.item.state, "accepted");
    const correction = structuredClone(input);
    correction.sourceVersion = "2";
    correction.topics[0].segments[0].text = "Report is a proposal only.";
    await ingest({ ...correction, expectedVersion: 1 });
    assert.deepEqual(records.get(accepted.item.id)?.terms, accepted.item.terms);
    assert.equal(records.get(accepted.item.id)?.state, "accepted");
    await assert.rejects(
      handleMeetingRequest(
        { method: "GET", query: { id: first.item.id } },
        member,
        { client, projects: async () => [{ id: "alpha" }] as any },
      ),
      { status: 403 },
    );
    assert.equal(
      (await sql.query("select count(*)::int n from outbound_operations"))
        .rows[0].n,
      0,
    );
  } finally {
    await close();
  }
});
