import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, RefreshCw, X } from 'lucide-react';
import type { Project, CommunicationsPersonRef } from '../types';
import type { ThreadCandidate, ThreadCorrectionReason, ThreadRegisterCommunication, ThreadRegisterEntry, ThreadRegisterPatch, ThreadStatus } from '../lib/communications/types';
import { firebaseService } from '../services/firebaseService';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const reasons: Array<[ThreadCorrectionReason, string]> = [
  ['wrong_topic', 'Different topic'], ['wrong_person', 'Wrong person'], ['wrong_project', 'Wrong project'],
  ['time_gap', 'Separate conversation in time'], ['channel_boundary', 'Keep these channels separate'],
  ['duplicate_thread', 'These belong together'], ['other', 'Other']
];
const label = (value?: string | null) => (value || 'Unknown').replaceAll('_', ' ');
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'No activity date';
const title = (thread: Pick<ThreadRegisterEntry, 'title' | 'last_subject' | 'participant_identity' | 'thread_id'>) =>
  thread.title || thread.last_subject || thread.participant_identity || thread.thread_id;

async function registerRequest(path: string, options?: RequestInit) {
  const response = await firebaseService.authorizedFetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 404 && path.startsWith('/api/thread-register?')) {
      throw new Error('Conversation review is not available on this account yet. Contact your administrator to enable it.');
    }
    throw new Error(data.error || 'Thread register request failed');
  }
  return data;
}

interface RegisterProps {
  orgId: string;
  projects: Project[];
  people: CommunicationsPersonRef[];
}

export const ThreadRegister: React.FC<RegisterProps> = ({ orgId, projects, people }) => {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<ThreadStatus | 'all'>('open');
  const [projectId, setProjectId] = useState('');
  const [personId, setPersonId] = useState('');
  const [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data: ThreadRegisterEntry[]; hasMore?: boolean; error?: string }>({ loading: false, data: [] });
  const [historyLoading, setHistoryLoading] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [message, setMessage] = useState('');
  const [correction, setCorrection] = useState<{ thread: ThreadRegisterEntry; communication: ThreadRegisterCommunication } | null>(null);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const query = new URLSearchParams({ status, limit: '100', offset: String(offset) });
    if (projectId) query.set('projectId', projectId);
    if (personId) query.set('personId', personId);
    setState(current => ({ ...current, loading: true, error: undefined }));
    void registerRequest(`/api/thread-register?${query}`).then(data => {
      if (active) setState({ loading: false, data: Array.isArray(data.data) ? data.data : [], hasMore: data.has_more === true });
    }).catch(error => {
      if (active) setState({ loading: false, data: [], error: error.message });
    });
    return () => { active = false; };
  }, [expanded, orgId, status, projectId, personId, reload, offset]);

  const visible = state.data.filter(thread => !search.trim() || [title(thread), thread.thread_id,
    ...thread.participants.map(participant => participant.identity_value),
    ...thread.communications.map(communication => communication.subject || communication.summary || '')
  ].join(' ').toLowerCase().includes(search.toLowerCase().trim()));
  const projectName = (id?: string | null) => projects.find(project => String(project.id) === id)?.name || id || 'No project';

  const loadOlderCommunications = async (thread: ThreadRegisterEntry) => {
    setHistoryLoading(thread.thread_id); setHistoryError('');
    try {
      const query = new URLSearchParams({ status: 'all', threadId: thread.thread_id, communicationOffset: String(thread.communications.length) });
      const result = await registerRequest(`/api/thread-register?${query}`);
      const next = result.data?.[0] as ThreadRegisterEntry | undefined;
      if (next) setState(current => ({ ...current, data: current.data.map(item => item.thread_id !== thread.thread_id ? item : {
        ...item, communications_count: next.communications_count,
        communications: [...new Map([...item.communications, ...next.communications].map(communication => [communication.communication_id, communication])).values()]
      }) }));
    } catch (error: any) { setHistoryError(error.message); }
    finally { setHistoryLoading(''); }
  };

  const saveThread = async (thread: ThreadRegisterEntry, patch: ThreadRegisterPatch) => {
    await registerRequest('/api/thread-register/thread', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: thread.thread_id, ...patch })
    });
    setMessage('Thread updated. The change is recorded in its audit history.');
    setReload(value => value + 1);
  };

  return <section className="rounded-2xl border border-slate-200 bg-white">
    <button type="button" className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={expanded} aria-controls="communications-thread-register" onClick={() => setExpanded(value => !value)}>
      <GitBranch size={19} className="text-indigo-600" />
      <span className="flex-1"><span className="block text-sm font-bold text-slate-800">Conversation thread register</span><span className="mt-1 block text-xs font-normal text-slate-500">Review cross-channel groupings and quietly correct a mismatch.</span></span>
      {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
    </button>
    {expanded && <div id="communications-thread-register" className="space-y-4 border-t border-slate-100 p-4">
      <p className="text-xs leading-5 text-slate-500">Threads group people, projects, topics and recent channel activity. Scores are explainable ranking signals, not a guarantee. A correction teaches future matching; it does not send a message or resolve a workflow Ask.</p>
      <div className="grid gap-2 md:grid-cols-4">
        <input aria-label="Search loaded threads" className={field} placeholder="Search loaded threads" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Thread status" className={field} value={status} onChange={event => { setStatus(event.target.value as ThreadStatus | 'all'); setOffset(0); setCorrection(null); }}><option value="open">Open threads</option><option value="all">All statuses</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>
        <select aria-label="Thread project filter" className={field} value={projectId} onChange={event => { setProjectId(event.target.value); setOffset(0); setCorrection(null); }}><option value="">All projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select>
        <select aria-label="Thread person filter" className={field} value={personId} onChange={event => { setPersonId(event.target.value); setOffset(0); setCorrection(null); }}><option value="">All people</option>{people.map(person => <option key={person.id} value={person.id}>{person.name || person.email || person.phone || person.id}</option>)}</select>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>{state.loading ? 'Loading threads…' : `${visible.length} of ${state.data.length} threads on page ${Math.floor(offset / 100) + 1}`}</span><button type="button" className={button} disabled={state.loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={13} className={`mr-1 inline ${state.loading ? 'animate-spin' : ''}`} />Refresh</button></div>
      {state.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{state.error}</p>}
      {historyError && <p role="alert" className="text-sm text-red-700">{historyError}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {correction && <ThreadCorrection key={correction.communication.communication_id} source={correction.thread} communication={correction.communication} threads={state.data} projects={projects} people={people} onCancel={() => setCorrection(null)} onSaved={() => { setCorrection(null); setMessage('Communication moved. The reason and correction are saved for future matching.'); setReload(value => value + 1); }} />}
      <div className="space-y-2">
        {visible.map(thread => <details key={thread.thread_id} className="rounded-xl border border-slate-200">
          <summary className="cursor-pointer p-3 text-sm text-slate-800"><span className="font-bold">{title(thread)}</span><span className="ml-2 text-xs text-slate-500">{projectName(thread.external_project_id)} · {label(thread.last_channel || thread.primary_channel)} · {label(thread.status)}{typeof thread.resolution_confidence === 'number' ? ` · ${Math.round(thread.resolution_confidence * 100)}% decision confidence` : ''}</span><span className="mt-1 block pl-4 text-xs text-slate-500">{date(thread.last_activity_at)} · {thread.participants.map(participant => participant.identity_value).join(', ') || thread.participant_identity || 'Participants not yet recorded'}</span></summary>
          <div className="space-y-4 border-t border-slate-100 p-3">
            <ThreadEditor key={JSON.stringify([thread.thread_id, thread.title, thread.summary, thread.status, thread.external_project_id])} thread={thread} projects={projects} onSave={patch => saveThread(thread, patch)} />
            <div><h5 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Recent communications</h5>{thread.communications.length ? <ul className="space-y-2">{thread.communications.map(communication => <li key={communication.communication_id} className="rounded-lg bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{communication.subject || communication.summary || label(communication.channel)}</p><p className="mt-1 text-xs text-slate-500">{label(communication.channel)} · {label(communication.direction)} · {date(communication.occurred_at)}</p></div><button type="button" className={button} onClick={() => { setCorrection({ thread, communication }); setMessage(''); }}>Review / move</button></div>{(communication.summary || communication.body) && <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{(communication.summary || communication.body || '').slice(0, 300)}</p>}</li>)}</ul> : <p className="text-xs text-slate-500">No recent communication rows were returned.</p>}</div>
            {thread.communications.length < (thread.communications_count || 0) && <button type="button" className={button} disabled={Boolean(historyLoading)} onClick={() => void loadOlderCommunications(thread)}>{historyLoading === thread.thread_id ? 'Loading history…' : `Load older communications (${thread.communications.length} of ${thread.communications_count})`}</button>}
            <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Decision and correction history</summary><div className="mt-2 space-y-1"><p className="break-all font-mono">{thread.thread_id}</p><p>Latest method: {label(thread.resolution_method)}</p>{thread.decisions.map(decision => <p key={decision.resolution_id}>{date(decision.created_at)} · {label(decision.action)} · {label(decision.method)}</p>)}{thread.corrections.map(item => <p key={item.feedback_id}>{date(item.created_at)} · {label(item.reason_code)}{item.reason_detail ? `: ${item.reason_detail}` : ''}{!item.active ? ' (superseded)' : ''}</p>)}</div></details>
          </div>
        </details>)}
        {!state.loading && !state.error && !visible.length && <p className="py-5 text-center text-sm text-slate-500">No threads match these filters.</p>}
      </div>
      <nav aria-label="Thread register pages" className="flex justify-between gap-2"><button type="button" className={button} disabled={state.loading || offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 100)); setCorrection(null); }}>Previous threads</button><button type="button" className={button} disabled={state.loading || !state.hasMore} onClick={() => { setOffset(value => value + 100); setCorrection(null); }}>Older threads</button></nav>
    </div>}
  </section>;
}

const ThreadEditor: React.FC<{ thread: ThreadRegisterEntry; projects: Project[]; onSave: (patch: ThreadRegisterPatch) => Promise<void> }> = ({ thread, projects, onSave }) => {
  const [draft, setDraft] = useState({ title: thread.title || '', summary: thread.summary || '', status: thread.status, externalProjectId: thread.external_project_id || '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    const patch: ThreadRegisterPatch = {};
    if (draft.title !== (thread.title || '')) patch.title = draft.title || null;
    if (draft.summary !== (thread.summary || '')) patch.summary = draft.summary || null;
    if (draft.status !== thread.status) patch.status = draft.status;
    if (draft.externalProjectId !== (thread.external_project_id || '')) patch.external_project_id = draft.externalProjectId || null;
    try { if (Object.keys(patch).length) await onSave(patch); }
    catch (failure: any) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <form onSubmit={event => void submit(event)} className="space-y-2">
    <div className="grid gap-2 md:grid-cols-3"><label className="text-xs text-slate-600">Thread title<input className={`${field} mt-1`} value={draft.title} maxLength={500} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label className="text-xs text-slate-600">Project<select className={`${field} mt-1`} value={draft.externalProjectId} onChange={event => setDraft({ ...draft, externalProjectId: event.target.value })}><option value="">No project</option>{thread.external_project_id && !projects.some(project => String(project.id) === thread.external_project_id) && <option value={thread.external_project_id}>{thread.external_project_id}</option>}{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label><label className="text-xs text-slate-600">Status<select className={`${field} mt-1`} value={draft.status} disabled={thread.purpose?.type === 'human_ask'} onChange={event => setDraft({ ...draft, status: event.target.value as ThreadStatus })}><option value="open">Open</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label></div>
    <label className="block text-xs text-slate-600">Topic / summary<textarea className={`${field} mt-1`} rows={2} value={draft.summary} maxLength={5000} onChange={event => setDraft({ ...draft, summary: event.target.value })} /></label>
    {thread.purpose?.type === 'human_ask' && <p className="text-xs text-slate-500">Ask status is managed by the workflow, not by this register.</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <button type="submit" className={button} disabled={saving}>{saving ? 'Saving…' : 'Save thread details'}</button>
  </form>;
}

const ThreadCorrection: React.FC<{
  source: ThreadRegisterEntry; communication: ThreadRegisterCommunication; threads: ThreadRegisterEntry[];
  projects: Project[]; people: CommunicationsPersonRef[]; onCancel: () => void; onSaved: () => void;
}> = ({ source, communication, threads, projects, people, onCancel, onSaved }) => {
  const [candidates, setCandidates] = useState<ThreadCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState<ThreadCorrectionReason>('wrong_topic');
  const [detail, setDetail] = useState('');
  const [personId, setPersonId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [updateIdentity, setUpdateIdentity] = useState(false);
  useEffect(() => {
    let active = true;
    void registerRequest(`/api/thread-register/candidates?communicationId=${encodeURIComponent(communication.communication_id)}`).then(data => {
      if (active) { setCandidates(data.candidates || []); setLoading(false); }
    }).catch(failure => { if (active) { setError(failure.message); setLoading(false); } });
    return () => { active = false; };
  }, [communication.communication_id]);
  const targets = [...new Map([
    ...candidates.map(candidate => ({ thread_id: candidate.thread_id, title: candidate.thread.title || candidate.thread.last_subject || candidate.thread_id, status: candidate.thread.status || 'open' })),
    ...threads.map(thread => ({ thread_id: thread.thread_id, title: title(thread), status: thread.status }))
  ].map(thread => [thread.thread_id, thread])).values()].filter(thread => thread.status === 'open' && thread.thread_id !== source.thread_id);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await registerRequest('/api/thread-register/correction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          communicationId: communication.communication_id,
          ...(target === 'new' ? { create_new: true } : { thread_id: target }),
          reason_code: reason, reason_detail: detail.trim() || undefined,
          person_id: personId || undefined, update_identity: updateIdentity && Boolean(personId),
          ...(projectId ? { external_project_id: projectId } : {})
        })
      });
      onSaved();
    } catch (failure: any) { setError(failure.message); setSaving(false); }
  };
  return <form onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
    <div className="flex items-start justify-between gap-3"><div><h5 className="text-sm font-bold text-slate-900">Review: {communication.subject || label(communication.channel)}</h5><p className="mt-1 text-xs text-slate-500">Currently in {title(source)}. This moves only this communication.</p></div><button type="button" aria-label="Cancel thread correction" onClick={onCancel} disabled={saving} className="p-1"><X size={18} /></button></div>
    {loading ? <p className="text-xs text-slate-500">Ranking alternatives…</p> : <details><summary className="cursor-pointer text-xs font-bold text-indigo-700">Why these threads? ({candidates.length} ranked candidates)</summary><ul className="mt-2 space-y-2">{candidates.map(candidate => <li key={candidate.thread_id} className="rounded-lg bg-white p-2 text-xs"><p className="font-semibold">{candidate.thread.title || candidate.thread.last_subject || candidate.thread_id} · {candidate.excluded ? 'Excluded from automatic matching' : `score ${candidate.score}`}{candidate.thread_id === source.thread_id ? ' · current' : ''}</p><p className="mt-1 text-slate-500">{candidate.signals.map(signal => `${label(signal.name)} ${signal.value > 0 ? '+' : ''}${signal.value}${signal.detail ? ` (${signal.detail})` : ''}`).join(' · ')}</p></li>)}</ul>{!candidates.length && <p className="mt-2 text-xs text-slate-500">No open candidates matched the available identity or project evidence.</p>}</details>}
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-slate-600">Correct destination<select className={`${field} mt-1`} autoFocus required value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose a destination</option><option value="new">Create a separate new thread</option>{targets.map(thread => <option key={thread.thread_id} value={thread.thread_id}>{thread.title}</option>)}</select></label>
      <label className="text-xs text-slate-600">Why was the grouping wrong?<select className={`${field} mt-1`} value={reason} onChange={event => setReason(event.target.value as ThreadCorrectionReason)}>{reasons.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
      <label className="text-xs text-slate-600">Correct person (optional)<select className={`${field} mt-1`} value={personId} onChange={event => { setPersonId(event.target.value); setUpdateIdentity(false); }}><option value="">Keep the communication’s person</option>{people.map(person => <option key={person.id} value={person.id}>{person.name || person.email || person.phone || person.id}</option>)}</select></label>
      <label className="text-xs text-slate-600">Correct project (optional)<select className={`${field} mt-1`} value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Keep the project / use destination</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>
    </div>
    <label className="block text-xs text-slate-600">A little context (optional)<textarea className={`${field} mt-1`} rows={2} maxLength={1000} placeholder="For example: this email address belongs to Alex, not Sam." value={detail} onChange={event => setDetail(event.target.value)} /></label>
    {personId && <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"><input type="checkbox" className="mt-1" checked={updateIdentity} onChange={event => setUpdateIdentity(event.target.checked)} /><span>Also associate this communication’s email/phone identity with the selected person for future matching. Only select this when the identity itself is wrong.</span></label>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex gap-2"><button type="submit" disabled={saving || !target || loading} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? 'Saving correction…' : 'Save correction'}</button><button type="button" className={button} disabled={saving} onClick={onCancel}>Cancel</button></div>
  </form>;
}
