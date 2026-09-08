import { createHash } from 'node:crypto';
import type { MemoryEnvelope } from '../communications/memoryTypes.js';
import type { CommitmentSource } from './model.js';

/** Source status is deliberately not mapped into a business lifecycle. */
export function promiseCandidates(envelope: MemoryEnvelope): CommitmentSource[] {
  if (envelope.contract_version !== 'memory-context.v1' || envelope.memory_status.state !== 'current') return [];
  const candidates = new Map<string, CommitmentSource>();
  const root = envelope.data as Record<string, any>;
  const provenance = root?.provenance?.sources || {};
  function visit(value: unknown) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, any>;
    if (row.id && row.evidence_only === true && typeof row.original_wording === 'string' && row.original_wording.trim()) {
      const ids = (Array.isArray(row.source_communication_ids) ? row.source_communication_ids : row.communication_id ? [row.communication_id] : []).filter((id: unknown) => typeof id === 'string').sort();
      if (ids.length) {
        const version = createHash('sha256').update(JSON.stringify([row.id,row.original_wording,row.updated_at || null,
          ids.map((id: string) => [id,provenance[id]?.updated_at || null]),row.due_at,row.due_at_candidate,row.thread_id])).digest('hex');
        candidates.set(String(row.id), { id: String(row.id), version, wording: row.original_wording.slice(0,4000), communicationIds: ids,
          ...(typeof row.thread_id === 'string' ? { threadId: row.thread_id } : {}) });
      }
    }
    Object.entries(row).filter(([key]) => key !== 'provenance').forEach(([,child]) => visit(child));
  }
  visit(envelope.data); return [...candidates.values()];
}
export function sourceCommitmentId(projectId: string, sourceId: string): string {
  return `ob_${createHash('sha256').update(JSON.stringify([projectId,sourceId])).digest('hex')}`;
}
