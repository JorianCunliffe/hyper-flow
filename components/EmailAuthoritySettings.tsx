import React, { useState } from 'react';
import { firebaseService } from '../services/firebaseService';

export function EmailAuthoritySettings() {
  const [policy, setPolicy] = useState<{ mode: string; configuredMode?: string | null; version: string } | null>(null);
  const [choice, setChoice] = useState('draft_only');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = async (save: boolean) => {
    setBusy(true); setMessage('');
    try {
      const response = await firebaseService.authorizedFetch('/api/communications/email-policy', {
        method: save ? 'POST' : 'GET',
        ...(save ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: choice, version: policy?.version }) } : {})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Email policy is unavailable');
      setPolicy(result); setChoice(result.configuredMode || result.mode);
      setMessage(save ? 'Email policy saved for this organization.' : '');
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3" aria-label="Organization email authority">
    <h4 className="font-bold text-slate-800">Organization email authority</h4>
    <p className="text-sm text-slate-600">Draft only is the default. An administrator can enable email sending for this organization. SMS and phone permissions are separate; enabling email still requires the applicable action approval.</p>
    <button type="button" disabled={busy} onClick={() => void request(false)} className="rounded-lg border px-3 py-2">{busy ? 'Working…' : 'Load email policy'}</button>
    {policy && <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="account-email-mode">Email mode</label>
      <select id="account-email-mode" value={choice} disabled={busy} onChange={e => setChoice(e.target.value)} className="rounded-lg border p-2">
        <option value="draft_only">Draft only</option><option value="allow_send">Allow authorized sending</option>
      </select>
      <button type="button" disabled={busy} onClick={() => void request(true)} className="rounded-lg border px-3 py-2">Save email policy</button>
      <span className="text-sm">Effective mode: {policy.mode === 'draft_only' ? 'Draft only' : 'Authorized sending'}</span>
    </div>}
    {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
  </section>;
}
