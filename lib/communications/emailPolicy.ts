import { CommunicationsApiError } from './errors.js';

/** Backend authority ceiling. Project data and browser settings cannot grant it. */
export function assertEmailSendAllowed(tenantId: string | undefined, accountMode?: string): void {
  if (!tenantId?.trim()) throw new CommunicationsApiError('Authenticated tenant is required', 403);
  let policy: Record<string, unknown>;
  try {
    policy = JSON.parse(process.env.EMAIL_SEND_POLICY_BY_TENANT || '{}');
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
        Object.values(policy).some(value => value !== 'draft_only' && value !== 'allow_send')) throw new Error();
  } catch {
    throw new CommunicationsApiError('Email authority configuration is invalid', 503);
  }
  const ceiling = Object.hasOwn(policy, tenantId) ? policy[tenantId] : undefined;
  const mode = ceiling === 'draft_only' || accountMode === 'draft_only' ? 'draft_only' : accountMode || ceiling || 'draft_only';
  if (mode !== 'allow_send') {
    throw new CommunicationsApiError(
      'Email is draft-only for this organization. Prepare a mailbox draft or use an authorized SMS/phone channel.',
      403, { code: 'email_draft_only' }
    );
  }
}
