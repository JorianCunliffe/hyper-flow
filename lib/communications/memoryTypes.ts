/** Evidence remains owned by Communications; these are transient REST DTOs. */
export type MemoryKind = 'search' | 'evidence' | 'person' | 'thread' | 'project' | 'meeting' | 'loose_ends';
export interface MemoryRequest {
  kind: MemoryKind; id?: string; query?: string; person_id?: string;
  external_project_id?: string; allowed_project_ids?: string[]; include_private?: boolean; limit?: number;
}
export interface MemoryEnvelope {
  contract_version: 'memory-context.v1';
  data: Record<string, unknown> | unknown[];
  memory_status: { state: 'current' | 'stale'; retrieved_at: string; evidence_only: boolean };
}
export interface MemoryEvidence { key: string; label: string; text: string; sources: string[]; dateNote?: string }
/** Render only evidence fields; never present stored derived due dates as confirmed obligations. */
export function memoryEvidence(data: unknown): MemoryEvidence[] {
  const entries: MemoryEvidence[] = []; const seen = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, any>;
    const sources: string[] = Array.isArray(row.source_communication_ids) ? row.source_communication_ids : row.communication_id ? [row.communication_id] : [];
    const text = row.original_wording || row.source_excerpt || row.text || row.body || row.body_them || row.description;
    if (typeof text === 'string' && sources.length) {
      const key = String(row.id || row.communication_id || sources.join(',')) + ':' + text;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ key, text, sources, label: row.fact_key ? 'Extracted fact' : row.original_wording ? 'Promise evidence' : row.type === 'human_ask' ? 'Ask' : row.channel || 'Evidence',
          dateNote: row.due_date_status === 'inferred' ? `Suggested date: ${row.due_at_candidate}. Needs confirmation.` : row.due_date_status === 'explicit' ? `Date stated in source: ${row.due_at}` : row.original_wording ? 'No confirmed deadline.' : undefined });
      }
    }
    for (const field of ['summary', 'current_state']) {
      if (typeof row[field] === 'string' && row[field + '_source_ids']?.length) {
        const key = field + ':' + row.thread_id;
        if (!seen.has(key)) { seen.add(key); entries.push({ key, label: field === 'summary' ? 'Thread summary' : 'Current thread context', text: row[field], sources: row[field + '_source_ids'] }); }
      }
    }
    Object.entries(row).filter(([key]) => !['provenance', 'source', 'metadata'].includes(key)).forEach(([, item]) => visit(item));
  }
  visit(data); return entries;
}
