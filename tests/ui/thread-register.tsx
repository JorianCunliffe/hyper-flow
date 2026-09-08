import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThreadRegister } from '../../components/ThreadRegister';
import { firebaseService } from '../../services/firebaseService';
import type { ThreadRegisterEntry } from '../../lib/communications/types';

const alex = '11111111-1111-4111-8111-111111111111';
const blair = '22222222-2222-4222-8222-222222222222';
const threads: ThreadRegisterEntry[] = [{
  thread_id: 'thread_alpha', title: 'Alpha settlement', status: 'open', external_project_id: 'alpha', person_id: alex,
  participant_identity: 'alex@example.com', last_channel: 'sms', last_activity_at: '2026-09-03T00:00:00Z',
  resolution_confidence: 0.87, resolution_method: 'ranked_match',
  participants: [{ person_id: alex, identity_value: 'alex@example.com', channel: 'email' }, { person_id: blair, identity_value: 'blair@example.com', channel: 'email' }],
  communications: [{ communication_id: 'comm_email', thread_id: 'thread_alpha', channel: 'email', direction: 'inbound', subject: 'Alpha settlement timing', body: 'Please confirm the planned settlement timing.', occurred_at: '2026-09-02T23:00:00Z' }],
  decisions: [{ resolution_id: 'trd_1', action: 'attached', method: 'ranked_match', created_at: '2026-09-02T23:00:00Z' }], corrections: []
}, {
  thread_id: 'thread_beta', title: 'Beta design', status: 'open', external_project_id: 'beta', person_id: blair,
  participant_identity: 'blair@example.com', last_channel: 'voice', last_activity_at: '2026-09-02T22:00:00Z',
  participants: [{ person_id: blair, identity_value: '+61400000222', channel: 'voice' }], communications: [], decisions: [], corrections: []
}];
threads[0].communications.push(...Array.from({ length: 22 }, (_, index) => ({
  communication_id: `comm_history_${index}`, thread_id: 'thread_alpha', channel: 'sms', direction: 'inbound',
  subject: `Earlier settlement note ${index + 1}`, body: 'Synthetic history for paging verification.',
  occurred_at: new Date(Date.parse('2026-09-02T22:00:00Z') - index * 60000).toISOString()
})));
const log: unknown[] = [];
firebaseService.authorizedFetch = async (input, options = {}) => {
  const url = new URL(String(input), location.origin);
  const body = options.body ? JSON.parse(String(options.body)) : null;
  log.push({ method: options.method || 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body });
  document.getElementById('request-log')!.textContent = JSON.stringify(log, null, 2);
  if (url.pathname.endsWith('/candidates')) return Response.json({ candidates: [{ thread_id: 'thread_beta', score: 74, confidence: 0.74, excluded: false, signals: [{ name: 'person_overlap', value: 30 }, { name: 'topic_overlap', value: 12 }], thread: { thread_id: 'thread_beta', title: 'Beta design', status: 'open' } }] });
  if (options.method === 'PATCH') {
    Object.assign(threads.find(thread => thread.thread_id === body.threadId)!, body);
    return Response.json({ updated: true });
  }
  if (url.pathname.endsWith('/correction')) {
    const source = threads.find(thread => thread.communications.some(item => item.communication_id === body.communicationId))!;
    const communication = source.communications.find(item => item.communication_id === body.communicationId)!;
    source.communications = source.communications.filter(item => item !== communication);
    let destination = threads.find(thread => thread.thread_id === body.thread_id);
    if (!destination) { destination = { thread_id: 'thread_new', title: 'Separate conversation', status: 'open', participants: [], communications: [], decisions: [], corrections: [] }; threads.push(destination); }
    destination.communications.push({ ...communication, thread_id: destination.thread_id });
    destination.corrections.push({ feedback_id: 'feedback_fixture', reason_code: body.reason_code, reason_detail: body.reason_detail, active: true });
    return Response.json({ corrected: true, thread_id: destination.thread_id });
  }
  const filtered = threads.filter(thread => (!url.searchParams.get('projectId') || thread.external_project_id === url.searchParams.get('projectId'))
    && (!url.searchParams.get('threadId') || thread.thread_id === url.searchParams.get('threadId'))
    && (!url.searchParams.get('status') || url.searchParams.get('status') === 'all' || thread.status === url.searchParams.get('status'))
    && (!url.searchParams.get('personId') || thread.participants.some(person => person.person_id === url.searchParams.get('personId'))));
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 100);
  const communicationOffset = Number(url.searchParams.get('communicationOffset') || 0);
  const data = filtered.slice(offset, offset + limit).map(thread => ({ ...thread,
    communications_count: thread.communications.length,
    communications: thread.communications.slice(communicationOffset, communicationOffset + 20)
  }));
  return Response.json({ data, count: data.length, has_more: filtered.length > offset + limit });
};

createRoot(document.getElementById('root')!).render(<ThreadRegister orgId="fixture" projects={[{ id: 'alpha', name: 'Alpha project' }, { id: 'beta', name: 'Beta project' }] as any} people={[{ id: alex, name: 'Alex', email: 'alex@example.com' }, { id: blair, name: 'Blair', phone: '+61400000222' }]} />);
