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
test("Phase 07 real stores: cockpit, shared relationship context, public intake and concurrent contact limits", async () => {
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
  const tenant = "phase07_fixture",
    key = "local_phase07";
  const cs = await createPhase02Database(tenant, key);
  const address = await cs.app.listen({ host: "127.0.0.1", port: 0 });
  process.env.COMMUNICATIONS_API_URL = address;
  process.env.COMMUNICATIONS_API_KEY = key;
  const { HttpCommunicationsClient } =
    await import("../../lib/communications/client");
  const client = new HttpCommunicationsClient();
  const { handleCockpit } = await import("../../lib/cockpit/api");
  const { handleCommitments } = await import("../../lib/commitments/api");
  const { channelOperatingContext } =
    await import("../../lib/cockpit/channelContext");
  const { recordReceptionistIntake } =
    await import("../../lib/cockpit/receptionist");
  const { buildVoiceAgentContext } =
    await import("../../lib/voiceAgentContext");
  const {
    saveTenantAgentProfile,
    claimContactDispatch,
    listOperationalCommitments,
    enqueueAgentInboxJob,
    claimAgentInboxJobs,
    replayAgentInboxJob,
    finishAgentInboxJob,
  } = await import("../../lib/serverStore");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const member = { orgId: tenant, uid: "phase07_ceo" };
  try {
    for (const name of ["CEO", "Alex", "Pat"]) {
      const response = await fetch(address + "/v1/contacts", {
        method: "POST",
        headers: {
          "X-API-Key": key,
          "X-Tenant-Id": tenant,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          identities: [
            { type: "email", value: `${name.toLowerCase()}@example.test` },
          ],
        }),
      });
      assert.equal(response.ok, true);
    }
    const people = await client.listPeople(tenant);
    const ceo = people.find((p) => p.name === "CEO")!,
      alex = people.find((p) => p.name === "Alex")!,
      pat = people.find((p) => p.name === "Pat")!;
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.database();
      await set(ref(db, `users/${member.uid}`), { orgId: tenant });
      await set(ref(db, `organizations/${tenant}/members/${member.uid}`), {
        role: "owner",
      });
      await set(
        ref(db, `projects/${tenant}/projects`),
        ["alpha", "beta"].map((id) => ({
          id,
          name: id,
          company: "Fixture",
          type: "test",
          startDate: 1,
          createdAt: 1,
          updatedAt: 1,
          milestones: [],
        })),
      );
    });
    let profile = await saveTenantAgentProfile(tenant, {
      primaryPersonId: ceo.id,
      primaryUserId: member.uid,
      allowedProjectIds: ["alpha"],
      personProjectAccess: [
        { personId: ceo.id, projectIds: ["alpha"] },
        { personId: alex.id, projectIds: ["alpha"] },
      ],
      serviceIdentities: { phone: "+61400000999" },
      receptionistEnabled: true,
      receptionistProjectId: "alpha",
      contactWindow: {
        startHour: 9,
        endHour: 17,
        maxPerDay: 1,
        maxPerContact: 1,
      },
    });
    const create = async (
      projectId: string,
      owner: string,
      deliverable: string,
    ) => {
      const result: any = await handleCommitments(
        {
          method: "POST",
          body: {
            projectId,
            terms: {
              owner,
              beneficiary: `user:${member.uid}`,
              deliverable,
              criteria: "Reviewed fixture evidence",
              dueAt: "2026-09-11T17:00:00+10:00",
              timezone: "Australia/Brisbane",
            },
          },
        },
        member,
      );
      return handleCommitments(
        {
          method: "PATCH",
          body: {
            id: result.item.id,
            projectId,
            action: "respond",
            expectedVersion: result.item.version,
            askId: result.item.review.ask.id,
            decision: "approved",
            note: "Controlled fixture acceptance",
          },
        },
        member,
      );
    };
    await create("alpha", `contact:${alex.id}`, "Deliver supplier update");
    await create("beta", `contact:${pat.id}`, "Excluded beta obligation");
    const cockpit: any = await handleCockpit(
      { method: "GET", query: { view: "waiting", projectId: "alpha" } },
      member,
    );
    assert.equal(cockpit.items.length, 1);
    assert.equal(cockpit.items[0].deliverable, "Deliver supplier update");
    const { handleVisibleFlows } = await import("../../lib/visibleFlows/api");
    const { runVisibleRoutine } =
      await import("../../lib/cockpit/scheduledRoutines");
    const { readVisibleFlow } = await import("../../lib/serverStore");
    let flow = (
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId: "alpha",
            plan: {
              name: "Scheduled operating read",
              steps: [
                {
                  id: "operations",
                  name: "Read current operations",
                  action: "read_operations",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: {},
                  sources: [],
                },
              ],
            },
          },
        },
        member,
      )
    ).item!;
    flow = (
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "approve",
            id: flow.id,
            version: 1,
            hash: flow.versions[0].hash,
            expectedRevision: flow.revision,
          },
        },
        member,
      )
    ).item!;
    const scheduled: any = await handleCockpit(
      {
        method: "POST",
        body: {
          operation: "schedule",
          projectId: "alpha",
          definitionId: flow.id,
          version: 1,
          hash: flow.versions[0].hash,
          enabled: true,
          localTime: "08:00",
        },
      },
      member,
    );
    const first = await runVisibleRoutine(
      scheduled.schedule,
      "controlled-occurrence",
    );
    const replayRun = await runVisibleRoutine(
      scheduled.schedule,
      "controlled-occurrence",
    );
    assert.equal(first.runId, replayRun.runId);
    const persisted = (await readVisibleFlow(tenant, flow.id))!;
    assert.equal(persisted.runs.length, 1);
    assert.equal(persisted.runs[0].status, "completed");
    assert.match(JSON.stringify(persisted.runs[0]), /Deliver supplier update/);
    assert.doesNotMatch(
      JSON.stringify(persisted.runs[0]),
      /Excluded beta obligation/,
    );
    await handleVisibleFlows(
      {
        method: "POST",
        body: {
          operation: "revise",
          id: flow.id,
          expectedRevision: persisted.revision,
          plan: flow.versions[0].plan,
        },
      },
      member,
    );
    const disabled: any = await handleCockpit(
      {
        method: "POST",
        body: {
          operation: "schedule",
          projectId: "alpha",
          definitionId: flow.id,
          enabled: false,
        },
      },
      member,
    );
    assert.match(disabled.notice, /disabled/);
    const shared = await channelOperatingContext(tenant, alex.id, "alpha");
    assert.equal(shared.audience, "relationship");
    assert.doesNotMatch(
      JSON.stringify(shared),
      /Excluded beta obligation|sourceCommunicationIds|reviewerUid/,
    );
    await saveTenantAgentProfile(tenant, {conversation:{prompt:'Use the phrase status pack.',voicePrompt:'Ask one question at a time.',smsPrompt:'Keep replies brief.'}});
    for (const channel of ['email','sms','voice','recording']) {
      const response=await fetch(address+'/v1/communications',{method:'POST',headers:{'X-API-Key':key,'X-Tenant-Id':tenant,'Content-Type':'application/json'},body:JSON.stringify({direction:'inbound',channel,identity:'ceo@example.test',person_id:ceo.id,thread_id:'thread_continuity_fixture',content:`Confirmed ${channel} evidence: the status pack is due Wednesday.`,correlation:{external_project_id:'alpha'}})});
      assert.equal(response.status,201,await response.text());
    }
      // Mirror an actual provider SMS arriving before any project association.
      const smsThread=(await cs.sql.query("insert into sms_threads(tenant_id,phone_number,twilio_number,contact_id) values($1,'+61400000111','+61400000999',$2) returning id",[tenant,ceo.id])).rows[0].id;
      await cs.sql.query("insert into sms_messages(tenant_id,thread_id,direction,role,content,status,communication_id,communication_thread_id) values($1,$2,'inbound','user','For alpha the test code is BLUE HERON 47','received','comm_live_sms_fixture','thread_continuity_fixture')",[tenant,smsThread]);
      const smsDetail=await client.getCommunication(tenant,'comm_live_sms_fixture');
      assert.equal(smsDetail.sender,'+61400000111');
      assert.equal(smsDetail.personId,ceo.id);
      assert.deepEqual(smsDetail.recipients,['+61400000999']);
      const pendingJob={id:'comm_live_sms_fixture',orgId:tenant,communicationId:'comm_live_sms_fixture',eventId:'evt_live_sms_fixture',channel:'sms' as const,personId:ceo.id};
      await enqueueAgentInboxJob({...pendingJob,id:'unrelated_pending'});
      await enqueueAgentInboxJob(pendingJob);
      const claimed=await claimAgentInboxJobs(1,Date.now(),{orgId:tenant,jobId:pendingJob.id});
      assert.equal(claimed.length,1);assert.equal(claimed[0].id,pendingJob.id);
      assert.equal((await claimAgentInboxJobs(1,Date.now(),{orgId:tenant,jobId:pendingJob.id})).length,0);
      await finishAgentInboxJob(claimed[0],{status:'needs_review',error:'Provider cap reached'});
      const replayed = await replayAgentInboxJob(tenant,pendingJob.id);
      assert.equal(replayed.status,'pending');
      assert.equal(replayed.attemptCount,0);
      await assert.rejects(replayAgentInboxJob(tenant,pendingJob.id),/Only failed/);
      await assert.rejects(replayAgentInboxJob('other_tenant',pendingJob.id),/Only failed/);
      const retried = await claimAgentInboxJobs(1,Date.now(),{orgId:tenant,jobId:pendingJob.id});
      assert.equal(retried.length,1);
      await finishAgentInboxJob(retried[0],{status:'completed'});
      await assert.rejects(replayAgentInboxJob(tenant,pendingJob.id),/Only failed/);
      assert.equal((await claimAgentInboxJobs(1,Date.now(),{orgId:tenant,jobId:pendingJob.id})).length,0);
      const voice = await buildVoiceAgentContext({
      request_id: "voice-a",
      tenant_id: tenant,
      person_id: ceo.id,
        thread_id: "thread_continuity_fixture",
      communication_id: "comm-a",
      service_identity: "+61400000999",
      utterance: "alpha",
    });
    assert.match(JSON.stringify(voice), /Deliver supplier update/);
    assert.match(voice.instructions,/Use the phrase status pack/);
    assert.match(voice.instructions,/Ask one question at a time/);
    assert.doesNotMatch(voice.instructions,/Keep replies brief/);
    const history=(voice.project?.context as any)?.history;
      assert.equal(history.status,'current');
      assert.ok(history.sources.some((source:any)=>source.id==='comm_live_sms_fixture' && source.text.includes('BLUE HERON 47')));
    assert.deepEqual(new Set(history.sources.map((source:any)=>source.channel)),new Set(['email','sms','voice','recording']));
    assert.doesNotMatch(JSON.stringify(voice), /Excluded beta obligation/);
    const publicVoice = await buildVoiceAgentContext({
      request_id: "voice-b",
      tenant_id: tenant,
      person_id: pat.id,
      thread_id: "thread-b",
      communication_id: "comm-b",
      service_identity: "+61400000999",
    });
    assert.equal(publicVoice.project, undefined);
    assert.deepEqual(publicVoice.candidates, []);
    assert.match(publicVoice.instructions, /Do not disclose/);
    const job = {
      orgId: tenant,
      communicationId: "comm-public-fixture",
      personId: pat.id,
      channel: "voice",
    } as any;
    const intake = await recordReceptionistIntake(job, profile);
    const replay = await recordReceptionistIntake(job, profile);
    assert.equal(intake!.id, replay!.id);
    assert.equal(intake!.state, "candidate");
    assert.equal(intake!.terms.dueAt, "");
    const now = Date.parse("2026-09-09T00:00:00Z");
    const claims = await Promise.all(
      ["one", "two"].map((operationId) =>
        claimContactDispatch(
          tenant,
          {
            operationId,
            target: "+61400000111",
            channel: "sms",
            coalesce: false,
          },
          now,
        ),
      ),
    );
    assert.equal(claims.filter((c) => c.allowed).length, 1);
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `contact_dispatch_days/${tenant}`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `contact_dispatch_days/${tenant}/forged`,
        ),
        { attempts: [] },
      ),
    );
    profile = await saveTenantAgentProfile(tenant, {
      personProjectAccess: [{ personId: ceo.id, projectIds: ["alpha"] }],
    });
    assert.equal(
      (await channelOperatingContext(tenant, alex.id, "alpha")).audience,
      "unavailable",
    );
    assert.equal(
      (await listOperationalCommitments("other_tenant")).rows.length,
      0,
    );
  } finally {
    await env.cleanup();
    await cs.close();
    await Promise.all(getApps().map(deleteApp));
  }
});
