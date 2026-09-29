import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
const {serverConfig}=require('../dist/core/config');const {workerDatabaseConfig}=require('../dist/core/database');
const entry=require('../../api/index.js'),cron=require('../../api/cron.js');
const serve=(handler:any)=>new Promise<http.Server>(resolve=>{const s=http.createServer(handler);s.listen(0,'127.0.0.1',()=>resolve(s));});
const servers:http.Server[]=[];
const url=(s:http.Server)=>`http://127.0.0.1:${(s.address() as any).port}`;
after(async()=>{for(const s of servers)await new Promise(r=>s.close(r));await new Promise(r=>setTimeout(r,50));});

test('the Vercel function serves the real API: health, readiness, sign-in and a guarded route',async()=>{
  process.env.DEV_AUTH='synthetic-local';const s=await serve(entry);servers.push(s);
  assert.equal((await fetch(`${url(s)}/healthz`)).status,200);
  const ready=await fetch(`${url(s)}/readyz`);assert.equal(ready.status,200,await ready.text());
  const login=await fetch(`${url(s)}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'head@example.test',password:'Synthetic-only-2026!'})});assert.equal(login.status,201);
  assert.equal((await fetch(`${url(s)}/api/v1/auth/session`,{headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]}})).status,200);
  assert.equal((await fetch(`${url(s)}/api/v1/schools/10000000-0000-4000-8000-000000000001`)).status,401);
});

test('the cron endpoint refuses callers without the shared secret and drains the queue with it',async()=>{
  const s=await serve(cron);servers.push(s);
  delete process.env.CRON_SECRET;assert.equal((await fetch(url(s),{headers:{authorization:'Bearer anything-at-all-123456'}})).status,401,'no secret configured means closed');
  process.env.CRON_SECRET='a-long-random-secret-for-tests';
  assert.equal((await fetch(url(s))).status,401);assert.equal((await fetch(url(s),{headers:{authorization:'Bearer wrong-secret-of-the-same-len!'}})).status,401);
  process.env.CRON_SECRET='short';assert.equal((await fetch(url(s),{headers:{authorization:'Bearer short'}})).status,401,'weak secrets are refused');
  process.env.CRON_SECRET='a-long-random-secret-for-tests';
  const ok=await fetch(url(s),{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});const body=await ok.json();assert.equal(ok.status,200,JSON.stringify(body));assert.equal(body.status,'ok');
});

test('Vercel deployment hosts are trusted automatically; other hosts are not',()=>{
  const config=serverConfig({VERCEL:'1',VERCEL_PROJECT_PRODUCTION_URL:'school.example.vercel.app',VERCEL_URL:'school-abc123.vercel.app'});
  assert.equal(config.hostAllowed('school.example.vercel.app'),true);assert.equal(config.hostAllowed('school-abc123.vercel.app'),true);assert.equal(config.hostAllowed('evil.example'),false);
  assert.equal(config.originAllowed('https://school.example.vercel.app','school.example.vercel.app'),true);assert.equal(config.originAllowed('https://evil.example','school.example.vercel.app'),false);
  assert.equal(serverConfig({VERCEL_URL:'school-abc123.vercel.app'}).hostAllowed('school-abc123.vercel.app'),false,'only on Vercel');
});

test('sslrootcert=bundled resolves to the shipped Supabase CA and pool size is configurable',()=>{
  const prior={...process.env};
  try{
    Object.assign(process.env,{DATABASE_TARGET:'supabase',NODE_ENV:'production',DB_POOL_MAX:'2',WORKER_DATABASE_URL:'postgresql://school_worker.ref:secret@pooler.example:5432/postgres?sslmode=verify-full&sslrootcert=bundled'});
    const config=workerDatabaseConfig();const cert=decodeURIComponent(new URL(config.connectionString).searchParams.get('sslrootcert')!);
    assert.equal(cert,path.resolve(__dirname,'../certs/supabase-prod-ca-2021.crt'));assert.ok(existsSync(cert));assert.equal(config.max,2);
    assert.match(require('node:fs').readFileSync(cert,'utf8'),/BEGIN CERTIFICATE/);
  }finally{for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);}
});
