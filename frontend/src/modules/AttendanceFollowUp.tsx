import React, { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type FollowClass = { class_id: string; name: string; level: string; learners: number; register_status: string };
type FollowUp = { day: string; open: boolean; classes: FollowClass[]; outstanding?: number };
type Absent = { learner_id: string; full_name: string; admission_number: string; class_name: string; absences: number; last_absent_day: string };
type ClassOption = { id: string; name: string; level: string; year_name: string };
type RosterLearner = { id: string; full_name: string; admission_number: string };

const label: Record<string, string> = { missing: 'Not started', draft: 'Draft, not submitted', submitted: 'Submitted', locked: 'Locked' };

export function AttendanceFollowUp({ schoolId }: { schoolId: string }) {
  const [follow, setFollow] = useState<FollowUp | null>(null);
  const [absent, setAbsent] = useState<Absent[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [printClass, setPrintClass] = useState('');
  const [sheet, setSheet] = useState<{ title: string; learners: RosterLearner[]; date: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [f, a, c] = await Promise.all([
        request<FollowUp>(`/schools/${schoolId}/attendance/follow-up`),
        request<Page<Absent>>(`/schools/${schoolId}/attendance/repeated-absence?limit=50`),
        request<Page<ClassOption>>(`/schools/${schoolId}/teaching/class-options?limit=100`),
      ]);
      setFollow(f); setAbsent(a.items); setClasses(c.items);
    } catch (e) { setError((e as Error).message); }
  }, [schoolId]);
  useEffect(() => { void load(); }, [load]);

  async function printBlank() {
    const chosen = classes.find(c => c.id === printClass); if (!chosen) return;
    setError('');
    try {
      const date = follow?.day ?? new Date().toISOString().slice(0, 10);
      const learners: RosterLearner[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await request<Page<RosterLearner>>(`/schools/${schoolId}/teaching/classes/${chosen.id}/roster?date=${date}&limit=100&offset=${offset}`);
        learners.push(...page.items); if (learners.length >= page.total || !page.items.length) break;
      }
      setSheet({ title: `${chosen.name} · ${chosen.year_name}`, learners, date });
      setTimeout(() => window.print(), 100);
    } catch (e) { setError((e as Error).message); }
  }

  return <section aria-label="Attendance follow-up">
    <h2>Attendance follow-up</h2>
    {error && <p role="alert">{error}</p>}
    {follow && (follow.open
      ? <><p>Registers for {follow.day}: <strong>{follow.outstanding}</strong> outstanding.</p>
        <ul className="history">{follow.classes.map(c => <li key={c.class_id}><strong>{c.name}</strong><span>{c.learners} learners · {label[c.register_status] ?? c.register_status}</span></li>)}</ul></>
      : <p className="muted">{follow.day} is not an open school day, so no registers are due.</p>)}
    <h3>Learners often absent (3 or more absences in the last 14 days)</h3>
    {absent.length ? <ul className="history">{absent.map(a => <li key={a.learner_id}><strong>{a.full_name}</strong><span>{a.class_name} · {a.absences} absences · last {a.last_absent_day}</span></li>)}</ul> : <p>No learners have reached the threshold.</p>}
    <h3>Printable register (power or network outage)</h3>
    <label>Class<select value={printClass} onChange={e => setPrintClass(e.target.value)}><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.year_name}</option>)}</select></label>
    <button type="button" className="secondary" disabled={!printClass} onClick={() => void printBlank()}>Print blank register</button>
    {sheet && <div className="print-sheet"><h2>{sheet.title}</h2><p>Register for the week starting ____________ (roster as at {sheet.date})</p>
      <table><thead><tr><th>Name</th><th>No.</th>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>{sheet.learners.map(l => <tr key={l.id}><td>{l.full_name}</td><td>{l.admission_number}</td>{[0, 1, 2, 3, 4].map(i => <td key={i}/>)}</tr>)}</tbody></table>
      <p>Mark P present, L late, A absent, E excused. Enter into the system when it is available again.</p></div>}
  </section>;
}
