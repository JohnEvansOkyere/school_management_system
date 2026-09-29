import { FormEvent, useEffect, useState } from 'react';
import { request } from '../lib/api';

type Props = { schoolId: string; csrfToken: string; role: string };
type Page<T> = { items: T[]; total: number; offset: number; limit: number };
type ClassRow = { id: string; name: string; level: 'Nursery' | 'KG'; year_name: string };
type Learner = { id: string; full_name: string; admission_number: string; enrolment_id: string };
type Report = { report_id: string; id: string; revision: number; version: number; status: string; learner_id: string; level: string; period_start: string; period_end: string; strengths: string; next_steps: string; teacher_note: string | null; snapshot: any; can_edit: boolean; approved_at: string | null; published_at: string | null };
type Child = { id: string; full_name: string; admission_number: string; academic: boolean };
type PublishedReport = { report_id: string; revision_id: string; revision: number; level: string; period_start: string; period_end: string; strengths: string; next_steps: string; teacher_note: string | null; snapshot: any; published_at: string };

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });
const json = (value: unknown) => JSON.stringify(value);
const post = <T,>(path: string, csrfToken: string, body: object) => request<T>(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: json({ operationId: crypto.randomUUID(), ...body }) });

export function EarlyYearsReports({ schoolId, csrfToken, role }: Props) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [level, setLevel] = useState<'Nursery' | 'KG'>('Nursery');
  const [classId, setClassId] = useState('');
  const [periodStart, setPeriodStart] = useState(today());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [learners, setLearners] = useState<Learner[]>([]);
  const [learnerId, setLearnerId] = useState('');
  const [strengths, setStrengths] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [teacherNote, setTeacherNote] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { strengths: string; nextSteps: string; teacherNote: string }>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [correctionReasons, setCorrectionReasons] = useState<Record<string, string>>({});
  const [children, setChildren] = useState<Child[]>([]);
  const [childId, setChildId] = useState('');
  const [guardianReports, setGuardianReports] = useState<PublishedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const head = role === 'headteacher';
  const guardian = role === 'guardian';

  async function loadReports() {
    const result = await request<Page<Report>>(`/schools/${schoolId}/early-years/reports?limit=100`);
    setReports(result.items);
    setDrafts(current => {
      const next = { ...current };
      for (const row of result.items) if (!next[row.id]) next[row.id] = { strengths: row.strengths, nextSteps: row.next_steps, teacherNote: row.teacher_note ?? '' };
      return next;
    });
  }

  async function loadClasses() {
    const result = await request<Page<ClassRow>>(`/schools/${schoolId}/early-years/classes?level=${level}&limit=100`);
    setClasses(result.items);
    setClassId(current => result.items.some(row => row.id === current) ? current : result.items[0]?.id ?? '');
  }

  useEffect(() => {
    if (guardian) {
      setGuardianReports([]);
      request<Child[]>(`/schools/${schoolId}/guardian/children`).then(rows => {
        const academicChildren = rows.filter(child => child.academic);
        setChildren(academicChildren);
        setChildId(current => academicChildren.some(child => child.id === current) ? current : academicChildren[0]?.id ?? '');
      }).catch(reason => setError((reason as Error).message));
      return;
    }
    loadClasses().catch(reason => setError((reason as Error).message));
    loadReports().catch(reason => setError((reason as Error).message));
  }, [schoolId, role, level]);

  useEffect(() => {
    if (!guardian) return;
    const refresh = () => {
      setGuardianReports([]);
      request<Child[]>(`/schools/${schoolId}/guardian/children`).then(rows => {
        const academicChildren = rows.filter(child => child.academic);
        setChildren(academicChildren);
        setChildId(current => academicChildren.some(child => child.id === current) ? current : academicChildren[0]?.id ?? '');
      }).catch(reason => setError((reason as Error).message));
    };
    window.addEventListener('guardian-records-refreshed', refresh);
    return () => window.removeEventListener('guardian-records-refreshed', refresh);
  }, [schoolId, guardian]);

  useEffect(() => {
    if (!guardian || !childId) { setGuardianReports([]); return; }
    request<{ items: PublishedReport[] }>(`/schools/${schoolId}/guardian/children/${childId}/reports`).then(result => setGuardianReports(result.items)).catch(reason => setError((reason as Error).message));
  }, [schoolId, guardian, childId]);

  useEffect(() => {
    setLearners([]); setLearnerId('');
    if (!classId || !periodStart) return;
    const query = new URLSearchParams({ date: periodStart, limit: '100' });
    request<Page<Learner>>(`/schools/${schoolId}/teaching/classes/${classId}/roster?${query}`).then(result => setLearners(result.items)).catch(reason => setError((reason as Error).message));
  }, [schoolId, classId, periodStart]);

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); await loadReports(); setNotice(success); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function createReport(event: FormEvent) {
    event.preventDefault();
    const learner = learners.find(row => row.id === learnerId);
    if (!learner) { setError('Choose an enrolled learner.'); return; }
    await perform(() => post(`/schools/${schoolId}/early-years/reports`, csrfToken, { learnerId, enrolmentId: learner.enrolment_id, periodStart, periodEnd, strengths, nextSteps, ...(teacherNote.trim() ? { teacherNote } : {}) }), 'Narrative report draft saved.');
    setStrengths(''); setNextSteps(''); setTeacherNote('');
  }

  function updateDraft(id: string, key: keyof (typeof drafts)[string], value: string) {
    setDrafts(current => ({ ...current, [id]: { ...current[id], [key]: value } }));
  }

  async function refreshGuardianReports() {
    if (!childId) return;
    const result = await request<{ items: PublishedReport[] }>(`/schools/${schoolId}/guardian/children/${childId}/reports`);
    setGuardianReports(result.items);
  }

  if (guardian) return <section aria-labelledby="early-years-reports-title">
    <p className="eyebrow">Family learning</p><h2 id="early-years-reports-title">Nursery and KG progress reports</h2>
    {children.length ? <><label>Child<select value={childId} onChange={event => setChildId(event.target.value)}><option value="">Choose a child</option>{children.map(child => <option key={child.id} value={child.id}>{child.full_name} · {child.admission_number}</option>)}</select></label>{guardianReports.length ? <ul className="history">{guardianReports.map(row => <li key={row.revision_id}><strong>{row.snapshot.learner.fullName} · {row.level} · {row.period_start} to {row.period_end}</strong><p><b>Strengths:</b> {row.strengths}</p><p><b>Next steps:</b> {row.next_steps}</p>{row.teacher_note && <p><b>Teacher note:</b> {row.teacher_note}</p>}<span>Published {new Date(row.published_at).toLocaleDateString('en-GH', { timeZone: 'Africa/Accra' })}</span></li>)}</ul> : <p>No published reports are available for this child.</p>}</> : <p>No children with academic access are linked to this account.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;

  return <section aria-labelledby="early-years-reports-title">
    <p className="eyebrow">Reviewed learning</p><h2 id="early-years-reports-title">Nursery and KG progress reports</h2>
    <p className="muted">Reports combine recorded observations with finalized attendance. Teachers prepare narrative reports; a headteacher reviews and publishes them for guardians.</p>
    <form onSubmit={createReport}>
      <div className="grid"><label>Level<select value={level} onChange={event => setLevel(event.target.value as 'Nursery' | 'KG')}><option>Nursery</option><option>KG</option></select></label>
        <label>Class<select value={classId} onChange={event => setClassId(event.target.value)} required><option value="">Choose a class</option>{classes.map(row => <option key={row.id} value={row.id}>{row.name} · {row.year_name}</option>)}</select><button type="button" className="secondary" onClick={() => loadClasses().catch(reason => setError((reason as Error).message))}>Refresh classes</button></label>
        <label>Report starts<input type="date" value={periodStart} max={today()} onChange={event => setPeriodStart(event.target.value)} required/></label>
        <label>Report ends<input type="date" value={periodEnd} min={periodStart} max={today()} onChange={event => setPeriodEnd(event.target.value)} required/></label>
        <label>Learner<select value={learnerId} onChange={event => setLearnerId(event.target.value)} required><option value="">Choose an enrolled learner</option>{learners.map(row => <option key={row.id} value={row.id}>{row.full_name} · {row.admission_number}</option>)}</select></label></div>
      <label>Strengths and progress<textarea minLength={3} maxLength={2000} value={strengths} onChange={event => setStrengths(event.target.value)} required/></label>
      <label>Next steps<textarea minLength={3} maxLength={2000} value={nextSteps} onChange={event => setNextSteps(event.target.value)} required/></label>
      <label>Teacher note (optional)<textarea maxLength={2000} value={teacherNote} onChange={event => setTeacherNote(event.target.value)}/></label>
      <button disabled={busy || !learnerId}>Save report draft</button>
    </form>
    <p role="status" aria-live="polite">{notice}</p>{error && <p role="alert">{error}</p>}
    <h3>Report review</h3>
    {reports.length ? <ul className="history">{reports.map(row => {
      const draft = drafts[row.id] ?? { strengths: row.strengths, nextSteps: row.next_steps, teacherNote: row.teacher_note ?? '' };
      const base = `/schools/${schoolId}/early-years/report-revisions/${row.id}`;
      return <li key={row.id}><strong>{row.snapshot.learner.fullName} · {row.level} · {row.period_start} to {row.period_end}</strong><span>Revision {row.revision} · {row.status}</span>
        <p><b>Strengths:</b> {row.strengths}</p><p><b>Next steps:</b> {row.next_steps}</p>
        {row.snapshot.attendance && <p>Finalized registers: {row.snapshot.attendance.counts.present} present, {row.snapshot.attendance.counts.late} late, {row.snapshot.attendance.counts.absent} absent, {row.snapshot.attendance.counts.excused} excused, {row.snapshot.attendance.counts.unmarked} unmarked. {row.snapshot.attendance.coverageNote}</p>}
        {row.snapshot.observations?.length > 0 && <details><summary>{row.snapshot.observations.length} recorded observations</summary>{row.snapshot.observations.map((observation: any) => <article key={observation.id}><h4>{observation.observed_on} · {observation.educator_display_name}</h4>{observation.entries.map((entry: any, index: number) => <p key={`${entry.indicatorId}-${index}`}><b>{entry.title}:</b> {entry.status === 'observed' ? `${entry.descriptor?.text ?? ''} ${entry.evidence ?? ''}` : 'Not observed'}</p>)}</article>)}</details>}
        {row.status === 'draft' && (head || row.can_edit) && <><label>Strengths<textarea value={draft.strengths} onChange={event => updateDraft(row.id, 'strengths', event.target.value)}/></label><label>Next steps<textarea value={draft.nextSteps} onChange={event => updateDraft(row.id, 'nextSteps', event.target.value)}/></label><label>Teacher note<textarea value={draft.teacherNote} onChange={event => updateDraft(row.id, 'teacherNote', event.target.value)}/></label><div className="actions"><button className="secondary" disabled={busy} onClick={() => perform(() => request(base, { method: 'PATCH', headers: { 'x-csrf-token': csrfToken }, body: json({ operationId: crypto.randomUUID(), version: row.version, strengths: draft.strengths, nextSteps: draft.nextSteps, ...(draft.teacherNote ? { teacherNote: draft.teacherNote } : {}) }) }), 'Draft updated.')}>Save changes</button><button disabled={busy} onClick={() => perform(() => post(`${base}/submit`, csrfToken, { version: row.version }), 'Report submitted for headteacher review.')}>Submit for review</button></div></>}
        {['submitted', 'approved'].includes(row.status) && head && <><label>Return reason<input value={returnReasons[row.id] ?? ''} onChange={event => setReturnReasons(current => ({ ...current, [row.id]: event.target.value }))}/></label><div className="actions"><button className="secondary" disabled={busy || (returnReasons[row.id] ?? '').trim().length < 3} onClick={() => perform(() => post(`${base}/return`, csrfToken, { version: row.version, reason: returnReasons[row.id] }), 'Report returned for changes.')}>Return for changes</button>{row.status === 'submitted' && <button disabled={busy} onClick={() => perform(() => post(`${base}/approve`, csrfToken, { version: row.version }), 'Report approved.')}>Approve</button>}</div></>}
        {row.status === 'approved' && head && <button disabled={busy} onClick={() => perform(() => post(`${base}/publish`, csrfToken, { version: row.version }), 'Report published to guardians.')}>Publish to guardians</button>}
        {['returned', 'published'].includes(row.status) && (head || row.can_edit) && <><label>Reason for new revision<input value={correctionReasons[row.report_id] ?? ''} onChange={event => setCorrectionReasons(current => ({ ...current, [row.report_id]: event.target.value }))}/></label><button className="secondary" disabled={busy || (correctionReasons[row.report_id] ?? '').trim().length < 3} onClick={() => perform(() => post(`/schools/${schoolId}/early-years/reports/${row.report_id}/revisions`, csrfToken, { version: row.version, correctionReason: correctionReasons[row.report_id], strengths: row.strengths, nextSteps: row.next_steps, ...(row.teacher_note ? { teacherNote: row.teacher_note } : {}) }), 'New report revision drafted.')}>Create new revision</button></>}
        {row.status === 'returned' && row.approved_at && <p className="muted">This report was approved earlier, then returned because its evidence changed. Its approval remains in the review history.</p>}
      </li>;
    })}</ul> : <p>No report drafts yet.</p>}
  </section>;
}
