import React, { FormEvent, useState } from 'react';
import { request } from '../lib/api';

export function Mfa({ csrfToken, enrolled, onDone, onSignOut }: { csrfToken: string; enrolled: boolean; onDone: () => Promise<void>; onSignOut: () => void }) {
  const headers = { 'x-csrf-token': csrfToken };
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function act(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const start = () => void act(async () => setSetup(await request(`/auth/mfa/setup`, { method: 'POST', headers, body: '{}' })));
  const confirm = (e: FormEvent) => { e.preventDefault(); void act(async () => { const r = await request<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { method: 'POST', headers, body: JSON.stringify({ code }) }); setRecovery(r.recoveryCodes); setCode(''); }); };
  const verify = (e: FormEvent) => { e.preventDefault(); void act(async () => { await request('/auth/mfa/verify', { method: 'POST', headers, body: JSON.stringify({ code }) }); await onDone(); }); };

  if (recovery) return <main className="login"><h1>Save your recovery codes</h1><p>Each code works once if you lose your phone. Store them somewhere safe. They are shown only now.</p>
    <div className="credentials"><code>{recovery.join('  ')}</code></div><button onClick={() => void act(onDone)}>I have saved them</button></main>;
  return <main className="login"><p className="eyebrow">Second sign-in step</p><h1>{enrolled ? 'Enter your code' : 'Set up your authenticator'}</h1>
    {error && <p role="alert">{error}</p>}
    {enrolled ? <form onSubmit={verify}><p>Open your authenticator app and enter the 6-digit code, or one of your recovery codes.</p>
      <label>Code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required/></label><button disabled={busy}>Verify</button></form>
      : !setup ? <><p>Headteachers, accountants and platform administrators protect their accounts with an authenticator app (for example Google Authenticator or Microsoft Authenticator).</p><button disabled={busy} onClick={start}>Start setup</button></>
      : <form onSubmit={confirm}><p>In your authenticator app choose "Enter a setup key" and type this key (account: School workspace):</p><p className="credentials"><code>{setup.secret}</code></p>
        <label>Then enter the 6-digit code it shows<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required/></label><button disabled={busy}>Confirm</button></form>}
    <p><button className="secondary" onClick={onSignOut}>Sign out</button></p></main>;
}
