import { CommunicationsApiError } from './errors.js';

/** Backend authority ceiling. Project data and browser settings cannot grant it. */
export function assertEmailSendAllowed(tenantId: string | undefined): void {
  if (!tenantId?.trim()) throw new CommunicationsApiError('Authenticated tenant is required', 403);
  let policy: Record<string, unknown>;
  try {
    policy = JSON.parse(process.env.EMAIL_SEND_POLICY_BY_TENANT || '{}');
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
        Object.values(policy).some(value => value !== 'draft_only' && value !== 'allow_send')) throw new Error();
  } catch {
    throw new CommunicationsApiError('Email authority configuration is invalid', 503);
  }
  const mode = Object.hasOwn(policy, tenantId) ? policy[tenantId] : 'draft_only';
  if (mode !== 'allow_send') {
    throw new CommunicationsApiError(
      'Email is draft-only for this organization. Prepare a mailbox draft or use an authorized SMS/phone channel.',
      403, { code: 'email_draft_only' }
    );
  }
}
