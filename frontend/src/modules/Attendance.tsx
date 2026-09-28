import { useEffect, useRef, useState } from 'react';
import { request } from '../lib/api';

type Props = { schoolId: string; csrfToken: string; role: string; accessRefresh: number };
type ClassRow = { id: string; name: string; level?: string; year_name?: string };
type Mark = 'unmarked' | 'present' | 'late' | 'absent' | 'excused';
type Learner = { id: string; full_name: string; admission_number: string; mark: Mark };
type Register = { id: string | null; status: 'draft' | 'submitted' | 'locked'; version: number; rosterSource: 'submission' | 'legacy_marks' | null; className: string; date: string; items: Learner[] };
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Accra' });

export function Attendance({ schoolId, csrfToken, role, accessRefresh }: Props) {
  const head = role === 'headteacher';
  const [day, setDay] = useState(today());
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [classSearchInput, setClassSearchInput] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [register, setRegister] = useState<Register | null>(null);
  const [open, setOpen] = useState(true);
  const [reason, setReason] = useState('');
  const [schoolDayVersion, setSchoolDayVersion] = useState<number | undefined>();
  const [dayLoading, setDayLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [correctionReason,setCorrectionReason]=useState('');
  const operations = useRef(new Map<string, string>());
  const classRequestEpoch = useRef(0);
  const lastAccessRefresh = useRef(accessRefresh);

  useEffect(() => {
    const epoch = ++classRequestEpoch.current;
    const accessWasRefreshed = accessRefresh !== lastAccessRefresh.current;
    lastAccessRefresh.current = accessRefresh;
    if (!head && accessWasRefreshed) {
      setClasses([]); setClassId(''); setRegister(null);
    }
    const query = new URLSearchParams({ offset: '0', limit: '50' });
    if (!head) query.set('date', day);
    if (classSearch.trim()) query.set('search', classSearch.trim());
    request<{ items: ClassRow[] }>(`/schools/${schoolId}/teaching/${head ? 'class-options' : 'classes'}?${query.toString()}`)
      .then(page => {
        if (classRequestEpoch.current !== epoch) return;
        setClasses(page.items);
        if (!head && classId && !page.items.some(row => row.id === classId)) {
          setClassId(''); setRegister(null);
        }
      }).catch(e => {
        if (classRequestEpoch.current !== epoch) return;
        setClasses([]); setError((e as Error).message);
        if (!head) { setClassId(''); setRegister(null); }
      });
    return () => { classRequestEpoch.current++; };
  }, [accessRefresh, classSearch, day, head, schoolId]);

  useEffect(() => {
    setDayLoading(true);
    request<Array<{ version: number; is_open: boolean; reason: string }>>(`/schools/${schoolId}/attendance/school-days?day=${day}`)
      .then(rows => {
        const current = rows[0]; setSchoolDayVersion(current?.version);
        if (current) { setOpen(current.is_open); setReason(current.reason); }
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setDayLoading(false));
  }, [day, schoolId]);

  useEffect(() => {
    setRegister(null); setError(''); setCorrectionReason('');
    if (!classId) return;
    request<Register>(`/schools/${schoolId}/attendance/classes/${classId}/register?day=${day}`)
      .then(setRegister).catch(e => setError((e as Error).message));
  }, [classId, day, schoolId]);

  const operationId = (key: string) => {
    const existing = operations.current.get(key); if (existing) return existing;
    const id = crypto.randomUUID(); operations.current.set(key, id); return id;
  };
  async function post(path: string, payload: Record<string, unknown>, key: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<Partial<Register>>(path, { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...payload, operationId: operationId(key) }) });
      operations.current.delete(key); setRegister(current => current ? { ...current, ...result } : null);
      const labels: Record<string, string> = { save: 'saved as draft', submit: 'submitted', lock: 'locked', correct: 'corrected' };
      setNotice(`Attendance ${labels[String(payload.action)] ?? 'saved'}.`);
      if(payload.action==='correct')setCorrectionReason('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function setSchoolDay() {
    setBusy(true); setError('');
    const operationKey = `day:${day}:${open}:${schoolDayVersion ?? 0}:${reason.trim()}`;
    try { const result = await request<{ version: number; is_open: boolean; reason: string }>('/schools/' + schoolId + '/attendance/school-days', { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ operationId: operationId(operationKey), day, isOpen: open, reason: reason.trim() || 'School day attendance review', ...(schoolDayVersion ? { version: schoolDayVersion } : {}) }) }); operations.current.delete(operationKey); setSchoolDayVersion(result.version); setOpen(result.is_open); setReason(result.reason); setNotice(`School day ${result.version > 1 ? 'updated' : 'saved'}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const marks = register?.items.map(row => ({ learnerId: row.id, mark: row.mark })) ?? [];
  const action = register?.status === 'draft' ? 'submit' : 'correct';
  return <section aria-labelledby="attendance-title">
    <p className="eyebrow">Daily records</p><h2 id="attendance-title">Attendance</h2>
    <p className="muted">Record one dated register per class. Changes after submission require a reviewed reason.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" aria-live="polite">{notice}</p>}
    <div className="actions"><label>Date<input type="date" value={day} onChange={e => { setDay(e.target.value); setClassId(''); setSchoolDayVersion(undefined); setDayLoading(true); }} /></label><label>Find a class<input value={classSearchInput} onChange={e => setClassSearchInput(e.target.value)} /></label><button className="secondary" type="button" disabled={busy} onClick={() => { setClassSearch(classSearchInput.trim()); setClassId(''); }}>Find class</button><label>Class<select value={classId} onChange={e => setClassId(e.target.value)}><option value="">Choose a class</option>{classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
    {head && <div className="actions"><label><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> School day open</label><input aria-label="School day reason" placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /><button className="secondary" type="button" disabled={busy || dayLoading} onClick={() => void setSchoolDay()}>Save school day</button></div>}
    {register && <><h3>{register.className} · {register.date}</h3><p className="muted">Status: {register.status}. {register.status==='draft'?'Every currently enrolled learner appears once.':'The roster captured for this register is retained.'}</p>
      {register.rosterSource==='legacy_marks'&&<p role="status">This older roster was recovered from saved marks. Review it against school records; original submission-time names and membership may be incomplete.</p>}
      {!register.items.length&&<p>No learners in this register.</p>}
      <ul className="history">{register.items.map(row => <li key={row.id}><strong>{row.full_name}</strong><span>{row.admission_number}</span><select aria-label={`Attendance for ${row.full_name}`} value={row.mark} disabled={busy || register.status === 'locked' && !head} onChange={e => setRegister({ ...register, items: register.items.map(item => item.id === row.id ? { ...item, mark: e.target.value as Mark } : item) })}><option value="unmarked">Unmarked</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="excused">Excused</option></select></li>)}</ul>
      <div className="actions">
        {register.status==='draft'&&<button type="button" disabled={busy} onClick={() => void post(`/schools/${schoolId}/attendance/classes/${classId}/register`, { day, version: register.version, action: 'save', marks }, `register:${classId}:${day}:save`)}>Save draft</button>}
        {(register.status !== 'locked' || head)&&<>
          {action === 'correct' && <input aria-label="Correction reason" placeholder="Correction reason" minLength={3} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} />}
          <button className="secondary" type="button" disabled={busy || (action === 'correct' && correctionReason.trim().length < 3)} onClick={() => void post(`/schools/${schoolId}/attendance/classes/${classId}/register`, { day, version: register.version, action, marks, ...(action === 'correct' ? { correctionReason: correctionReason.trim() } : {}) }, `register:${classId}:${day}:${action}:${register.version}`)}>{action === 'submit' ? 'Submit register' : 'Save correction'}</button>
          {head&&register.status==='submitted'&&<button className="secondary" type="button" disabled={busy} onClick={()=>void post(`/schools/${schoolId}/attendance/classes/${classId}/register`,{day,version:register.version,action:'lock',marks},`register:${classId}:${day}:lock:${register.version}`)}>Lock register</button>}
        </>}
      </div></>}
  </section>;
}
