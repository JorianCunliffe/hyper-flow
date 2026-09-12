import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackRequestText, recordReceptionistIntake } from '../lib/cockpit/receptionist.js';
import type { Commitment } from '../lib/commitments/model.js';
import type { AgentInboxJob, TenantAgentProfile } from '../types.js';
import type { CommunicationResult } from '../lib/communications/types.js';

test('captures explicit caller callback wording, including separate timing turns', () => {
  for (const wording of ["Please record that I'd like a call back about communications test tomorrow.", 'Could someone call me back?', 'Please ring me tomorrow.', 'Call me back about the invoice.']) assert.equal(callbackRequestText(wording), wording);
  assert.equal(callbackRequestText('What was the latest SMS code?'), null);
  assert.equal(callbackRequestText('Please call me back.\nActually, cancel that.'), null);
  assert.equal(callbackRequestText("I don't need a callback."), null);
  assert.equal(callbackRequestText('No callback is needed.'), null);
  assert.equal(callbackRequestText('Please call me back.\nNo need to call me back.'), null);
});

test('callback intake is a replay-safe review candidate with missing terms, not a promised call', async () => {
  const job = { orgId: 'org', communicationId: 'comm', threadId: 'thread', personId: 'person', channel: 'voice' } as AgentInboxJob;
  const profile = { receptionistEnabled: true, receptionistProjectId: 'intake', primaryUserId: 'reviewer', timezone: 'Australia/Brisbane' } as TenantAgentProfile;
  const communication = { id: 'comm', tenantId: 'org', personId: 'person', channel: 'voice', status: 'completed', content: 'Please call me back.\nTomorrow morning.', occurredAt: '2026-09-12T00:00:00Z' } as CommunicationResult;
  const rows = new Map<string, Commitment>();
  const deps = {
    findProject: async () => ({id:'intake'}),
    requireOrganizationMember: async (uid:string, org:string) => { assert.equal(uid,'reviewer'); assert.equal(org,'org'); },
    transactOperationalCommitment: async (_org:string, id:string, update:any) => { const row = update(rows.get(id) || null); rows.set(id,row); return row; },
  } as any;
  const details = { communication, callbackText: callbackRequestText(communication.content)! };
  const row = (await recordReceptionistIntake(job, profile, details, deps))!;
  assert.equal(row.state, 'candidate');
  assert.equal(row.reviewerUid, 'reviewer');
  assert.equal(row.terms.owner, '');
  assert.equal(row.terms.dueAt, '');
  assert.equal(row.terms.beneficiary, 'contact:person');
  assert.match(row.terms.criteria, /Tomorrow morning/);
  assert.match(row.terms.criteria, /thread: thread/);
  assert.equal(row.review?.kind, 'clarify');
  assert.deepEqual(row.review?.ask.fields?.map(f => f.name), ['owner','dueAt']);
  assert.equal(row.followUp.enabled, false);
  await recordReceptionistIntake(job, profile, details, deps);
  assert.equal(rows.size, 1);
  assert.equal(rows.get(row.id)?.version, 1);
  assert.equal(await recordReceptionistIntake(job, {...profile,receptionistEnabled:false}, details, deps), null);
  for (const change of [{tenantId:'other'}, {id:'other'}, {personId:'other'}, {channel:'sms'}, {outcome:{memory_eligible:false}}]) {
    await assert.rejects(recordReceptionistIntake(job, profile, {...details,communication:{...communication,...change} as CommunicationResult}, deps), /source does not match/);
  }
  await assert.rejects(recordReceptionistIntake(job, profile, details, {...deps,requireOrganizationMember:async()=>{throw new Error('membership revoked');}}), /membership revoked/);
});
