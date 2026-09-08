import { assertEmailSendAllowed } from './emailPolicy.js';
import { CommunicationsApiError } from './errors.js';
import { ApiAuthError } from '../apiAuth.js';
import type { AuthenticatedMember } from '../serverStore.js';
import { HttpCommunicationsClient } from './client.js';

export async function accountEmailPolicy(
  member: AuthenticatedMember, method: string | undefined, body: any,
  client?: Pick<HttpCommunicationsClient, 'getEmailPolicy' | 'saveEmailPolicy'>
) {
  const effective = (policy: { mode: string; version: string }) => {
    try { assertEmailSendAllowed(member.orgId, policy.mode); return policy; }
    catch (error) {
      if (error instanceof CommunicationsApiError && error.status === 403) return { ...policy, mode: 'draft_only' };
      throw error;
    }
  };
  if (method === 'GET') return effective(await (client || new HttpCommunicationsClient()).getEmailPolicy(member.orgId));
  if (method !== 'POST') throw new ApiAuthError(405, 'Method not allowed');
  if (!['owner', 'admin'].includes(member.role)) throw new ApiAuthError(403, 'Organization administrator required');
  if (!['draft_only', 'allow_send'].includes(body?.mode) || typeof body?.version !== 'string') {
    throw new ApiAuthError(400, 'Email mode and current version are required');
  }
  return effective(await (client || new HttpCommunicationsClient()).saveEmailPolicy(member.orgId, body.mode, body.version));
}
