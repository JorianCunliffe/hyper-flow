import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmailAuthoritySettings } from '../../components/EmailAuthoritySettings';
import { firebaseService } from '../../services/firebaseService';
// Local component fixture only: no authenticated service or provider access.
let policy = { mode: 'draft_only', configuredMode: null as string | null, version: 'unconfigured' };
firebaseService.authorizedFetch = async (_url, init) => {
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (new URLSearchParams(location.search).has('member')) return Response.json({ error: 'Organization administrator required' }, { status: 403 });
    if (body.version !== policy.version) return Response.json({ error: 'Policy changed; reload before saving' }, { status: 409 });
    policy = { mode: body.mode, configuredMode: body.mode, version: crypto.randomUUID() };
  }
  return Response.json(policy);
};
createRoot(document.getElementById('root')!).render(<EmailAuthoritySettings />);
