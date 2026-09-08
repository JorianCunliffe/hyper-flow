import { HttpCommunicationsClient } from './client.js';
import { ThreadRegisterRequestError } from './threadRegister.js';
import { listTenantProjects } from '../serverStore.js';
import type { MemoryEnvelope, MemoryKind, MemoryRequest } from './memoryTypes.js';

/** Only authenticated organization members call this adapter. Caller-supplied grants are ignored. */
export async function handleMemoryContextRequest(
  request: { method?: string; body?: unknown }, member: { orgId: string; uid: string },
  dependencies: { client?: { getMemoryContext(tenant: string, input: MemoryRequest): Promise<MemoryEnvelope> };
    listProjects?: (tenant: string) => Promise<Array<{ id: string | number }>> } = {}
): Promise<MemoryEnvelope> {
  if (request.method !== 'POST') throw new ThreadRegisterRequestError(405, 'Method not allowed');
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const kind = body.kind as MemoryKind;
  if (!['search', 'person', 'thread', 'project', 'meeting', 'loose_ends'].includes(kind)) throw new ThreadRegisterRequestError(400, 'Choose a context view');
  const text = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 2000) : '';
  const id = text(body.id);
  if (!['search', 'loose_ends'].includes(kind) && !id) throw new ThreadRegisterRequestError(400, 'Choose a person, thread, project or meeting');
  const projects = await (dependencies.listProjects || listTenantProjects)(member.orgId);
  const allowed = projects.map(project => String(project.id));
  const projectId = kind === 'project' ? id : text(body.projectId);
  if (projectId && !allowed.includes(projectId)) throw new ThreadRegisterRequestError(403, 'Project is not accessible in this organization');
  // Current HyperFlow membership grants organization projects. Private evidence stays excluded
  // until a separate per-source access model exists; owner status alone is not a source grant.
  const input: MemoryRequest = { kind: kind === 'project' ? 'search' : kind, include_private: false,
    allowed_project_ids: projectId ? [projectId] : allowed, limit: 50 };
  if (kind !== 'project' && id) input.id = id;
  if (projectId) input.external_project_id = projectId;
  if (text(body.query)) input.query = text(body.query);
  if (text(body.personId)) input.person_id = text(body.personId);
  return (dependencies.client || new HttpCommunicationsClient()).getMemoryContext(member.orgId, input);
}
