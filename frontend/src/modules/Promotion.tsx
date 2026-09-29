import React, { useEffect, useState } from 'react';
import { request } from '../lib/api';

type SchoolClass = { id: string; name: string; year_name: string; start_date: string };
type Learner = { id: string; full_name: string; admission_number: string };

export function Promotion({ schoolId, csrfToken }: { schoolId: string; csrfToken: string }) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [source, setSource] = useState(''); const [effective, setEffective] = useState('');
  const [roster, setRoster] = useState<Learner[]>([]); const [choice, setChoice] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('End of year promotion');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => { request<{ items: SchoolClass[] }>(`/schools/${schoolId}/classes?limit=100`).then(r => setClasses(r.items)).catch(e => setError((e as Error).message)); }, [schoolId]);
  async function loadRoster() {
    setError(''); setMessage(''); setRoster([]); setChoice({});
    try { setRoster((await request<{ items: Learner[] }>(`/schools/${schoolId}/promotions/preview?sourceClassId=${source}&effectiveDate=${effective}`)).items); }
    catch (e) { setError((e as Error).message); }
  }
  const setAll = (value: string) => setChoice(Object.fromEntries(roster.map(l => [l.id, value])));
  async function run() {
    setBusy(true); setError(''); setMessage('');
    try {
      const decisions = roster.map(l => ({ learnerId: l.id, action: choice[l.id] === 'leave' ? 'leave' : 'move', ...(choice[l.id] && choice[l.id] !== 'leave' ? { classId: choice[l.id] } : {}) }));
      const r = await request<{ moved: number; left: number }>(`/schools/${schoolId}/promotions`, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: crypto.randomUUID(), sourceClassId: source, effectiveDate: effective, reason, decisions }) });
      setMessage(`Done: ${r.moved} moved, ${r.left} left the school.`); setRoster([]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const complete = roster.length > 0 && roster.every(l => choice[l.id]);
  const targets = classes.filter(c => c.id !== source);
  return <section aria-label="Year-end promotion">
    <h2>Year-end promotion</h2>
    <p className="muted">Move every learner in a class to a next-year class (promote or repeat) or record that they left. Past enrolments stay in each learner's history.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label>Class being closed<select value={source} onChange={e => setSource(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
    <label>New year starts on<input type="date" value={effective} onChange={e => setEffective(e.target.value)}/></label>
    <button className="secondary" disabled={!source || !effective} onClick={() => void loadRoster()}>Show learners</button>
    {roster.length > 0 && <><label>Set everyone to<select value="" onChange={e => setAll(e.target.value)}><option value="">Choose…</option>{targets.map(c => <option key={c.id} value={c.id}>Move to {c.name} · {c.year_name}</option>)}<option value="leave">Leave the school</option></select></label>
      <ul className="history">{roster.map(l => <li key={l.id}><strong>{l.full_name}</strong><span>{l.admission_number}</span>
        <select aria-label={`Decision for ${l.full_name}`} value={choice[l.id] ?? ''} onChange={e => setChoice({ ...choice, [l.id]: e.target.value })}><option value="">Choose…</option>{targets.map(c => <option key={c.id} value={c.id}>Move to {c.name} · {c.year_name}</option>)}<option value="leave">Leave the school</option></select></li>)}</ul>
      <label>Reason recorded in each history<input value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={400}/></label>
      <button disabled={busy || !complete} onClick={() => void run()}>{busy ? 'Working…' : 'Apply promotion'}</button>{!complete && <p className="muted">Choose a decision for every learner to continue.</p>}</>}
  </section>;
}
