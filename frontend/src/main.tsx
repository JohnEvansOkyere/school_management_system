import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { request } from './lib/api';
import { AuditExport } from './modules/AuditExport';
import { Admissions } from './modules/Admissions';
import { Collection } from './modules/Collection';
import { Guardians } from './modules/Guardians';
import { Teaching } from './modules/Teaching';
import { Attendance } from './modules/Attendance';
import { EarlyYears } from './modules/EarlyYears';
import { EarlyYearsReports } from './modules/EarlyYearsReports';
import { AttendanceFollowUp } from './modules/AttendanceFollowUp';
import { Assessment, GuardianTerminalReports } from './modules/Assessment';
import { Finance, GuardianStatement } from './modules/Finance';
import { Accounts } from './modules/Accounts';
import { PlatformAdmin } from './modules/PlatformAdmin';
type School = {id:string;name:string;role:string;version:number};
type Session = {displayName:string;csrfToken:string;schools:School[];platformAdmin:boolean;mustChangePassword:boolean};
type AuditPage = {items:Audit[];total:number};
type Audit = {id:string;action:string;created_at:string;metadata:{version?:number}};
function App() {
  const [session,setSession] = useState<Session|null>(null);
  const [school,setSchool] = useState<School|null>(null);
  const [audit,setAudit] = useState<Audit[]>([]);
  const [auditTotal,setAuditTotal] = useState(0);
  const [email,setEmail] = useState('head@example.test');
  const [password,setPassword] = useState('');
  const [newPassword,setNewPassword] = useState('');
  const [name,setName] = useState('');
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const [teacherAccessRefresh,setTeacherAccessRefresh] = useState(0);
  const [loading,setLoading] = useState(true);
  const selectionEpoch=useRef(0);
  async function selectSchool(id:string) {
    const epoch=++selectionEpoch.current;
    setSchool(null);setAudit([]);setAuditTotal(0);setName('');setStatus('');
    try {
      const current = await request<School>(`/schools/${id}`);
      if(epoch!==selectionEpoch.current)return;
      setSchool(current);setName(current.name);
      if(current.role==='headteacher') {const events=await request<AuditPage>(`/schools/${id}/audit`);if(epoch===selectionEpoch.current){setAudit(events.items);setAuditTotal(events.total);}}
    } catch(error) {
      if(epoch!==selectionEpoch.current)return;
      if((error as {status?:number}).status===401){setSession(null);setStatus('Your session ended. Sign in again.');}
      else setStatus((error as Error).message);
    }
  }
  async function restore() {
    const current = await request<Session>('/auth/session');
    setSession(current);
    if(current.schools.length) await selectSchool(current.schools[0].id);
  }
  useEffect(() => {restore().catch(() => setSession(null)).finally(() => setLoading(false));},[]);
  async function signIn(event:FormEvent) {
    event.preventDefault();setBusy(true);setStatus('');
    try { await request('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setPassword('');await restore(); }
    catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function changePassword(event:FormEvent) {
    event.preventDefault();if(!session)return;setBusy(true);setStatus('');
    try {
      await request('/auth/change-password',{method:'POST',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({currentPassword:password,newPassword})});
      setPassword('');setNewPassword('');await restore();
    } catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function enterSchool(id:string) {
    const current = await request<Session>('/auth/session');
    setSession(current);await selectSchool(id);
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(!school||!session)return;setBusy(true);setStatus('Saving…');
    try {
      const saved = await request<School>(`/schools/${school.id}`,{method:'PATCH',headers:{'x-csrf-token':session.csrfToken},body:JSON.stringify({name,version:school.version})});
      setSchool({...saved,role:school.role});setName(saved.name);setSession({...session,schools:session.schools.map(s=>s.id===saved.id?{...s,name:saved.name}:s)});
      {const events=await request<AuditPage>(`/schools/${school.id}/audit`);setAudit(events.items);setAuditTotal(events.total);}setStatus('Saved. School details are up to date.');
    } catch(error) {setStatus((error as Error).message);} finally {setBusy(false);}
  }
  async function moreAudit() {
    if(!school)return;
    try {const events=await request<AuditPage>(`/schools/${school.id}/audit?offset=${audit.length}&limit=25`);setAudit(prior=>[...prior,...events.items]);setAuditTotal(events.total);} catch(error) {setStatus((error as Error).message);}
  }
  async function signOut() {
    if(!session)return;setBusy(true);
    try {await request('/auth/logout',{method:'POST',headers:{'x-csrf-token':session.csrfToken}});selectionEpoch.current++;setSession(null);setSchool(null);setAudit([]);setStatus('Signed out');}
    catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  }
  if(loading)return <main><p role="status">Loading workspace…</p></main>;
  if(!session)return <main className="login"><p className="eyebrow">School workspace · Local development</p><h1>Welcome back</h1><p>Use a synthetic staff account to open your school.</p><form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p role="status">{status}</p><p className="muted">Synthetic data only. Managed identity is pending provider selection.</p></main>;
  if(session.mustChangePassword)return <main className="login"><p className="eyebrow">School workspace</p><h1>Choose a new password</h1><p>Your account was created with a temporary password. Choose your own to continue (at least 12 characters).</p><form onSubmit={changePassword}><label>Temporary password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><button disabled={busy}>{busy?'Saving…':'Save new password'}</button></form><p role="status">{status}</p></main>;
  return <><header><a href="/" className="brand">School workspace</a><span>{session.displayName}</span><button className="secondary" disabled={busy} onClick={signOut}>Sign out</button></header><main>{session.platformAdmin&&<PlatformAdmin csrfToken={session.csrfToken} onEnter={enterSchool}/>}<p className="eyebrow">Your school</p><label className="school-picker">School<select value={school?.id??''} disabled={busy} onChange={e=>{setBusy(true);selectSchool(e.target.value).catch(error=>setStatus(error.message)).finally(()=>setBusy(false));}}>{!school&&<option value="">Loading…</option>}{session.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{school&&<><h1>{school.name}</h1><p className="muted">Signed in as {school.role}. All records are scoped to this school.</p>{['headteacher','accountant'].includes(school.role)&&<Finance key={`finance:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>}{school.role==='guardian'&&<GuardianStatement key={`statement:${school.id}`} schoolId={school.id}/>}{school.role==='guardian'&&<GuardianTerminalReports key={`terminal:${school.id}`} schoolId={school.id}/>}{school.role==='headteacher'&&<Accounts key={`accounts:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken}/>}{['headteacher','frontdesk'].includes(school.role)&&<Admissions key={school.id} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>} {["headteacher","frontdesk"].includes(school.role)&&<Collection key={'collection:'+school.id} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>} {['headteacher','guardian'].includes(school.role)&&<Guardians key={`guardians:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>}{['headteacher','teacher'].includes(school.role)&&<Teaching key={`teaching:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role} onAccessRefresh={()=>setTeacherAccessRefresh(value=>value+1)}/>} {school.role==='headteacher'&&<AttendanceFollowUp key={`followup:${school.id}`} schoolId={school.id}/>}{['headteacher','teacher'].includes(school.role)&&<Assessment key={`assessment:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>}{['headteacher','teacher'].includes(school.role)&&<Attendance key={`attendance:${school.id}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role} accessRefresh={teacherAccessRefresh}/>} {['headteacher','teacher'].includes(school.role)&&<EarlyYears key={`early-years:${school.id}:${school.role}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>}{['headteacher','teacher','guardian'].includes(school.role)&&<EarlyYearsReports key={`early-years-reports:${school.id}:${school.role}`} schoolId={school.id} csrfToken={session.csrfToken} role={school.role}/>}<section><h2>School details</h2>{school.role==='headteacher'?<form onSubmit={save}><label>School name<input value={name} minLength={3} maxLength={120} onChange={e=>setName(e.target.value)} required/></label><div className="actions"><button disabled={busy||name===school.name}>{busy?'Saving…':'Save details'}</button><button className="secondary" type="button" disabled={busy} onClick={()=>selectSchool(school.id).catch(error=>setStatus(error.message))}>Reload details</button></div><p className="muted">{name!==school.name?'Unsaved changes':`Saved version ${school.version}`}</p></form>:<p>School details are maintained by the headteacher.</p>}<p role="status" aria-live="polite">{status}</p></section>{school.role==='headteacher'&&<section><h2>Recent changes</h2><AuditExport key={school.id} schoolId={school.id} csrfToken={session.csrfToken}/>{audit.length?<><ul className="history">{audit.map(item=><li key={item.id}><strong>{({"school.details.updated":"School details saved","audit.export.requested":"Audit export requested"} as Record<string,string>)[item.action]??item.action.replaceAll("."," ")}</strong><span>{item.metadata.version?`Version ${item.metadata.version} · `:""}{new Date(item.created_at).toLocaleString('en-GH',{timeZone:'Africa/Accra'})}</span></li>)}</ul>{audit.length<auditTotal&&<p>Showing {audit.length} of {auditTotal} changes. <button type="button" className="secondary" onClick={()=>void moreAudit()}>Show older changes</button></p>}</>:<p>No changes recorded yet.</p>}</section>}</>}{!school&&<p role="status">{status||'Select an available school to continue.'}</p>}<p className="muted">Local foundation build · Synthetic schools</p></main></>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
