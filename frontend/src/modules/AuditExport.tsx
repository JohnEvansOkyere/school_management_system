import { useState } from 'react';
import { request } from '../lib/api';
type Job={id:string;state:string;last_error?:string;result?:unknown};
export function AuditExport({schoolId,csrfToken}:{schoolId:string;csrfToken:string}) {
  const [operation]=useState(()=>crypto.randomUUID());const [job,setJob]=useState<Job|null>(null);const [busy,setBusy]=useState(false);const [status,setStatus]=useState('');
  const [open,setOpen]=useState(false);
  async function prepare() {
    setBusy(true);setStatus('');
    try{setJob(await request<Job>(`/schools/${schoolId}/audit-exports`,{method:'POST',headers:{'x-csrf-token':csrfToken},body:JSON.stringify({operationId:operation})}));setStatus('Export queued. Check progress when the worker has processed it.');}
    catch(error){setStatus((error as Error).message);}finally{setBusy(false);}
  }
  async function check(download=false) {
    if(!job)return;setBusy(true);
    try {
      const current=await request<Job>(`/schools/${schoolId}/audit-exports/${job.id}`);setJob(current);setStatus(current.last_error??`Export ${current.state}.`);
      if(download&&current.state==='done'&&current.result){const url=URL.createObjectURL(new Blob([JSON.stringify(current.result,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`school-audit-${schoolId}.json`;link.click();URL.revokeObjectURL(url);setStatus('Audit export downloaded. Up to 500 recent events are included.');}
    }catch(error){setStatus((error as Error).message);setJob(null);}finally{setBusy(false);}
  }
  return <div><button type="button" className="secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Export audit history</button>{open&&<div><p className="muted">Prepare a private JSON export of up to 500 recent events. Your permission is checked again before generation and download.</p><div className="actions">{!job?<button type="button" disabled={busy} onClick={prepare}>Prepare export</button>:<><button type="button" className="secondary" disabled={busy} onClick={()=>check()}>Check export progress</button>{job.state==='done'&&<button type="button" disabled={busy} onClick={()=>check(true)}>Download audit JSON</button>}</>}</div><p role="status">{status}</p></div>}</div>;
}
