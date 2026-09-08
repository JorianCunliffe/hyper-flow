import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpCommunicationsClient } from '../lib/communications/client.js';
import { assertEmailSendAllowed } from '../lib/communications/emailPolicy.js';
import { deliverAsk } from '../lib/asks/deliverAsk.js';
import { executeTask } from '../lib/executeTask.js';
import { accountEmailPolicy } from '../lib/communications/accountEmailPolicy.js';
import { requireProjectInTenant } from '../lib/apiAuth.js';

const contract = JSON.parse(readFileSync(new URL('../contracts/email-authority.v1.json', import.meta.url), 'utf8'));
function env(t: any, values: Record<string, string | undefined>) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
test('shared authority contract preserves explicit per-tenant grants and safe HyperFlow default', t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: JSON.stringify(contract.policies) });
  for (const item of contract.cases) {
    if (item.hyperflow) assert.doesNotThrow(() => assertEmailSendAllowed(item.tenant));
    else assert.throws(() => assertEmailSendAllowed(item.tenant), (e: any) => e.status === 403);
  }
  assert.throws(() => assertEmailSendAllowed(undefined), (e: any) => e.status === 403);
});
test('invalid server configuration fails closed without exposing configuration', t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: '{"ceo":"typo"}' });
  assert.throws(() => assertEmailSendAllowed('ceo'), (e: any) => e.status === 503 && !e.message.includes('typo'));
});
test('all email purposes reject before dispatch even with caller supplied approval', async t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: undefined });
  let requests = 0;
  const client = new HttpCommunicationsClient({ baseUrl: 'https://example.invalid', apiKey: 'test',
    fetchImpl: async url => { requests++; assert.ok(String(url).endsWith('/tenant-policy/email')); return Response.json({ mode: 'draft_only', version: '2026-09-08T00:00:00.000Z' }); } });
  for (const purpose of ['workflow_action', 'workflow_notification', 'human_ask', 'triage']) {
    await assert.rejects(client.sendEmail({
      to: ['person@example.invalid'], subject: 'test', text: 'test',
      correlation: { tenant_id: 'ceo', external_project_id: 'p', task_id: 't', run_id: 'r' },
      purpose: { type: purpose, ask_id: purpose === 'human_ask' ? 'a' : undefined },
      sendPolicy: 'automatic', approved: true
    } as any), (e: any) => e.status === 403);
  }
  assert.equal(requests, 4);
});
test('drafts, SMS and calls remain available under draft-only email', async t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: '{"ceo":"draft_only"}' });
  const paths: string[] = [];
  const client = new HttpCommunicationsClient({ baseUrl: 'https://example.invalid', apiKey: 'test',
    fetchImpl: async url => { paths.push(String(url)); return Response.json({ id: 'comm_test' }); } });
  await client.createMailboxDraft('ceo', 'mailbox', { to: ['a@example.invalid'], subject: 'draft', text: 'body' }, 'draft-1');
  const correlation = { tenant_id: 'ceo', external_project_id: 'p', task_id: 't', run_id: 'r' };
  await client.sendSms({ to: '+61400000000', from: '+61411111111', body: 'test', correlation });
  await client.startCall({ to: '+61400000000', from: '+61411111111', correlation,
    overrides: { systemMessage: 'Test', greetingText: 'Test', aiSpeaksFirst: true, liveTranscript: true } });
  assert.equal(paths.length, 3);
  assert.ok(paths.every(path => !path.endsWith('/emails')));
});
test('send-only task and Ask remain unsuccessful without dispatch', async t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: undefined, COMMUNICATIONS_API_URL: 'https://example.invalid',
    COMMUNICATIONS_API_KEY: 'test', PUBLIC_BASE_URL: 'https://hyperflow.invalid' });
  let requests = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => { requests++; assert.ok(String(url).endsWith('/tenant-policy/email')); return Response.json({ mode: 'draft_only', version: '2026-09-08T00:00:00.000Z' }); };
  t.after(() => { globalThis.fetch = oldFetch; });
  const result = await executeTask('send_email', JSON.stringify({ to: 'a@example.invalid', from: 'b@example.invalid', body: 'test' }), {}, {
    correlation: { orgId: 'ceo', projectId: 'p', nodeId: 't', runId: 'r' }
  });
  assert.equal(result.body.status, 'error');
  assert.equal(result.httpStatus, 403);
  assert.match(result.body.error, /draft-only/);
  await assert.rejects(deliverAsk({
    ask: { id: 'a', token: 'test', prompt: 'Answer?', nodeId: 't', projectId: 'p', runId: 'r' } as any,
    orgId: 'ceo', projectId: 'p', channel: 'email', recipient: 'a@example.invalid', personId: 'person',
    emailIdentity: 'email-identity'
  }), /draft-only/);
  assert.equal(requests, 2);
});
test('project scope lookup uses authenticated organization and rejects absent/foreign project', async () => {
  const lookups: unknown[] = [];
  const lookup: any = async (org: string, project: string) => {
    lookups.push([org, project]); return org === 'ceo' && project === 'owned' ? { project: {} } : null;
  };
  await requireProjectInTenant('ceo', 'owned', lookup);
  await assert.rejects(requireProjectInTenant('ceo', 'foreign', lookup), (e: any) => e.status === 403);
  await assert.rejects(requireProjectInTenant('ceo', undefined, lookup), (e: any) => e.status === 400);
  assert.deepEqual(lookups, [['ceo', 'owned'], ['ceo', 'foreign']]);
});

test('only organization owners and admins can change account email authority', async () => {
  const calls: unknown[] = [];
  const client: any = { getEmailPolicy: async (tenant: string) => { calls.push(tenant); return {}; },
    saveEmailPolicy: async (...args: unknown[]) => { calls.push(args); return {}; } };
  const body = { mode: 'allow_send', version: '2026-09-08T00:00:00.000Z', orgId: 'foreign' };
  await assert.rejects(accountEmailPolicy({ orgId: 'own', role: 'member' } as any, 'POST', body, client), (e: any) => e.status === 403);
  assert.equal(calls.length, 0);
  for (const role of ['owner', 'admin']) await accountEmailPolicy({ orgId: 'own', role } as any, 'POST', body, client);
  assert.deepEqual(calls, [['own', body.mode, body.version], ['own', body.mode, body.version]]);
});
test('invalid policy response fails closed before dispatch', async () => {
  const client = new HttpCommunicationsClient({ baseUrl: 'https://example.invalid', apiKey: 'test',
    fetchImpl: async url => { assert.ok(String(url).endsWith('/tenant-policy/email')); return Response.json({ mode: 'invalid' }); } });
  await assert.rejects(client.sendEmail({ correlation: { tenant_id: 'own' } } as any), (e: any) => e.status === 503);
});

test('account API displays the effective HyperFlow operator restriction', async t => {
  env(t, { EMAIL_SEND_POLICY_BY_TENANT: '{"own":"draft_only"}' });
  const client: any = { getEmailPolicy: async () => ({ mode: 'allow_send', configuredMode: 'allow_send', version: 'v1' }) };
  const result = await accountEmailPolicy({ orgId: 'own', role: 'member' } as any, 'GET', undefined, client);
  assert.equal(result.mode, 'draft_only');
});
