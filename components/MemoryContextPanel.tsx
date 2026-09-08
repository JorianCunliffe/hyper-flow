import React, { useEffect, useState } from 'react';
import type { Project, CommunicationsPersonRef } from '../types';
import { firebaseService } from '../services/firebaseService';
import { memoryEvidence, type MemoryEnvelope, type MemoryKind } from '../lib/communications/memoryTypes';

const field = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
export const MemoryContextPanel: React.FC<{ orgId: string; projects: Project[]; people: CommunicationsPersonRef[] }> = ({ orgId, projects, people }) => {
  const [kind, setKind] = useState<MemoryKind>('search');
  const [id, setId] = useState(''); const [projectId, setProject] = useState(''); const [query, setQuery] = useState('');
  const [request, setRequest] = useState<object | null>(null);
  const [result, setResult] = useState<MemoryEnvelope | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    setResult(null); setError('');
    if (!request) { setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true);
    void firebaseService.authorizedFetch('/api/communications/memory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? 'This context is missing, outside your accessible projects, or not yet available on this account.' : 'Context is unavailable. Please try again.');
      if (data.contract_version !== 'memory-context.v1' || !['current', 'stale'].includes(data.memory_status?.state)) throw new Error('Context is unavailable. The service needs an update.');
      if (active) setResult(data);
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [orgId, request]);
  const clear = () => { setRequest(null); setResult(null); setError(''); };
  const evidence = result ? memoryEvidence(result.data) : [];
  const citations = result && !Array.isArray(result.data) ? (result.data.provenance as { sources?: Record<string, { excerpt?: string }> } | undefined)?.sources || {} : {};
  return <details className="rounded-xl border border-slate-200 p-4">
    <summary className="cursor-pointer font-bold text-slate-800">Communication context</summary>
    <p className="my-3 text-sm text-slate-600">Review source-linked context and promise evidence across your accessible projects. Private sources are excluded. Suggested dates need confirmation; these are not tracked obligations.</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setRequest({ kind, id: kind === 'project' ? projectId : id, projectId, query }); }}>
      <select aria-label="Context view" className={field} value={kind} onChange={event => { setKind(event.target.value as MemoryKind); setId(''); clear(); }}>
        <option value="search">Search communications</option><option value="person">Person</option><option value="thread">Conversation thread</option>
        <option value="project">Project</option><option value="meeting">Meeting</option><option value="loose_ends">Loose ends</option>
      </select>
      <select aria-label="Context project" required={kind === 'project'} className={field} value={projectId} onChange={event => { setProject(event.target.value); clear(); }}>
        <option value="">All accessible projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
      </select>
      {kind === 'person' ? <select aria-label="Context person" required className={field} value={id} onChange={event => { setId(event.target.value); clear(); }}>
        <option value="">Choose a person</option>{people.map(person => <option key={person.id} value={person.id}>{person.name || person.id}</option>)}
      </select> : ['thread', 'meeting'].includes(kind) ? <input aria-label="Context reference" required className={field} placeholder={kind === 'thread' ? 'Thread reference' : 'Meeting reference'} value={id} onChange={event => { setId(event.target.value); clear(); }} /> : null}
      {kind === 'search' && <input aria-label="Context search" className={field} placeholder="Search words (optional)" value={query} onChange={event => { setQuery(event.target.value); clear(); }} />}
      <button className={field + ' font-bold disabled:opacity-50'} disabled={loading} type="submit">{loading ? 'Loading contextâ€¦' : 'Load context'}</button>
    </form>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error} This does not mean there is no history.</p>}
    {result && <div aria-live="polite" className="mt-4 space-y-3">
      <p className="text-xs text-slate-500">Retrieved {new Date(result.memory_status.retrieved_at).toLocaleString()}. Bounded context view; results may not include all history.</p>
      {result.memory_status.state === 'stale' && <p className="text-sm text-amber-800">Some evidence was withheld because its source changed or is outside this view. Context may be incomplete.</p>}
      {!evidence.length && <p className="text-sm text-slate-600">No eligible evidence was returned for this view. Try another scope or search.</p>}
      {evidence.map(item => <article key={item.key} className="rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-bold uppercase text-slate-500">{item.label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{item.text}</p>
        {item.dateNote && <p className="mt-2 text-sm text-amber-800">{item.dateNote}</p>}
        <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Source references ({item.sources.length})</summary><ul>{item.sources.map(source => <li className="my-2 break-words" key={source}><span className="break-all">{source}</span>{citations[source]?.excerpt && <blockquote className="mt-1 border-l-2 pl-2 whitespace-pre-wrap">{citations[source].excerpt}</blockquote>}</li>)}</ul></details>
      </article>)}
    </div>}
  </details>;
}
