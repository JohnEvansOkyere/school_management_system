import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {createApp}=require('../dist/main');
const {serverConfig}=require('../dist/core/config');
const {Database}=require('../dist/core/database');
const schoolA='10000000-0000-4000-8000-000000000001';
process.env.DEV_AUTH='synthetic-local';
const apps:any[]=[];
const lines:string[]=[];
async function start(env:Record<string,string>={}) {
  const app=await createApp({env:{...process.env,DEV_AUTH:'synthetic-local',...env},log:(line:string)=>lines.push(line)});
  await app.listen(0,'127.0.0.1');apps.push(app);return {app,port:(app.getHttpServer().address() as any).port as number};
}
function raw(port:number,method:string,url:string,headers:Record<string,string>,body?:unknown):Promise<{status:number;json:any;headers:http.IncomingHttpHeaders}> {
  return new Promise((resolve,reject)=>{
    const payload=body===undefined?undefined:JSON.stringify(body);
    const req=http.request({host:'127.0.0.1',port,method,path:url,headers:{...(payload?{'content-type':'application/json','content-length':String(Buffer.byteLength(payload))}:{}),...headers}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{let json:any=null;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode!,json,headers:res.headers});});
    });
    req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}
const login={email:'head@example.test',password:'Synthetic-only-2026!'};
after(async()=>{for(const app of apps)await app.close();});

test('server config keeps localhost defaults and reads host, port, hosts, origins and proxy count from env',()=>{
  const defaults=serverConfig({});
  assert.equal(defaults.port,3018);assert.equal(defaults.host,'127.0.0.1');assert.equal(defaults.trustProxy,0);
  assert.equal(defaults.hostAllowed('localhost:3018'),true);assert.equal(defaults.hostAllowed('app.example.test'),false);
  const configured=serverConfig({PORT:'8080',HOST:'0.0.0.0',ALLOWED_HOSTS:'app.example.test, api.example.test',ALLOWED_ORIGINS:'https://app.example.test',TRUST_PROXY:'1'});
  assert.equal(configured.port,8080);assert.equal(configured.host,'0.0.0.0');assert.equal(configured.trustProxy,1);
  assert.equal(configured.hostAllowed('api.example.test:443'),true);assert.equal(configured.hostAllowed('evil.example.test'),false);
  assert.equal(configured.originAllowed('https://app.example.test'),true);assert.equal(configured.originAllowed('https://evil.example.test'),false);
  assert.throws(()=>serverConfig({ALLOWED_ORIGINS:'http://app.example.test'}),/https/);
  assert.throws(()=>serverConfig({PORT:'not-a-port'}),/PORT/);
  assert.throws(()=>serverConfig({TRUST_PROXY:'-1'}),/TRUST_PROXY/);
});

test('default host and origin guard is unchanged: localhost only',async()=>{
  const {port}=await start();
  assert.equal((await raw(port,'GET','/api/v1/auth/session',{host:`localhost:${port}`})).status,401);
  assert.equal((await raw(port,'GET','/api/v1/auth/session',{host:'app.example.test'})).status,403);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`},login)).status,201);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`,origin:'https://evil.example.test'},login)).status,403);
});

test('configured hosts and https origins are accepted; unknown ones stay denied',async()=>{
  const {port}=await start({ALLOWED_HOSTS:'app.example.test',ALLOWED_ORIGINS:'https://app.example.test'});
  assert.equal((await raw(port,'GET','/api/v1/auth/session',{host:'app.example.test'})).status,401);
  assert.equal((await raw(port,'GET','/api/v1/auth/session',{host:'evil.example.test'})).status,403);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:'app.example.test',origin:'https://app.example.test'},login)).status,201);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:'app.example.test',origin:'https://evil.example.test'},login)).status,403);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:'app.example.test',origin:'http://app.example.test'},login)).status,403);
});

test('trust proxy comes from config and the login limiter keys on the client address',async()=>{
  const {app,port}=await start({TRUST_PROXY:'1'});
  assert.equal(app.getHttpAdapter().getInstance().get('trust proxy'),1);
  const bad={email:'nobody@example.test',password:'wrong-password-value'};
  for(let i=0;i<31;i++)await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`,'x-forwarded-for':'203.0.113.10'},bad);
  assert.equal((await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`,'x-forwarded-for':'203.0.113.10'},bad)).status,429);
  assert.notEqual((await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`,'x-forwarded-for':'203.0.113.11'},bad)).status,429);
});

test('healthz needs no database and is reachable from any host',async()=>{
  const {port}=await start();
  const response=await raw(port,'GET','/healthz',{host:'10.0.0.5:3018'});
  assert.equal(response.status,200);assert.deepEqual(response.json,{status:'ok'});
});

test('readyz is ready when the database answers and the ledger matches the bundled migrations',async()=>{
  const {port}=await start();
  const response=await raw(port,'GET','/readyz',{host:'10.0.0.5:3018'});
  assert.equal(response.status,200);assert.deepEqual(response.json,{status:'ready',checks:{database:'ok',migrations:'ok'}});
});

test('readyz reports not ready when the ledger is behind the bundled migrations',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'migrations-'));
  for(const name of readdirSync(path.resolve(__dirname,'../migrations')))writeFileSync(path.join(dir,name),'-- bundled');
  writeFileSync(path.join(dir,'999_not_yet_applied.sql'),'-- newer than the ledger');
  const {port}=await start({MIGRATIONS_DIR:dir});
  const response=await raw(port,'GET','/readyz',{host:'10.0.0.5:3018'});
  assert.equal(response.status,503);assert.deepEqual(response.json,{status:'not_ready',checks:{database:'ok',migrations:'behind'}});
});

test('readyz reports not ready when the database is unreachable and leaks no error detail',async()=>{
  const {app,port}=await start();
  const pool=app.get(Database).pool,original=pool.query.bind(pool);
  pool.query=async()=>{throw new Error('password authentication failed for secret-user');};
  try{
    const response=await raw(port,'GET','/readyz',{host:'10.0.0.5:3018'});
    assert.equal(response.status,503);assert.equal(response.json.status,'not_ready');assert.equal(response.json.checks.database,'failed');
    assert.doesNotMatch(JSON.stringify(response.json),/secret-user/);
  }finally{pool.query=original;}
});

test('each request is logged once as structured JSON without query strings or child data',async()=>{
  const {port}=await start();
  const session=await raw(port,'POST','/api/v1/auth/login',{host:`127.0.0.1:${port}`},login);
  const cookie=String(session.headers['set-cookie']).split(';')[0];
  lines.length=0;
  const response=await raw(port,'GET',`/api/v1/schools/${schoolA}/learners?search=Synthetic%20Child%20Name`,{host:`127.0.0.1:${port}`,cookie});
  assert.equal(response.status,200);
  const entries=lines.map(line=>JSON.parse(line)).filter(entry=>entry.route?.includes('learners'));
  assert.equal(entries.length,1);
  const entry=entries[0];
  assert.equal(entry.requestId,response.headers['x-request-id']);
  assert.equal(entry.method,'GET');assert.equal(entry.route,'/api/v1/schools/:schoolId/learners');assert.equal(entry.status,200);
  assert.equal(entry.schoolId,schoolA);assert.equal(typeof entry.durationMs,'number');
  assert.doesNotMatch(lines.join('\n'),/Synthetic|search=|school_session|=[a-f0-9]{64}/);
});

test('the API serves the built web app with a single-page fallback, never for /api paths',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'web-'));
  writeFileSync(path.join(dir,'index.html'),'<!doctype html><title>School workspace</title><div id="root"></div>');
  const {mkdirSync}=require('node:fs');mkdirSync(path.join(dir,'assets'));writeFileSync(path.join(dir,'assets','app.js'),'console.log(1)');
  const {port}=await start({WEB_DIST:dir,ALLOWED_HOSTS:'app.example.test'});
  const home=await new Promise<any>(resolve=>http.get({host:'127.0.0.1',port,path:'/',headers:{host:'app.example.test'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));}));
  assert.equal(home.status,200);assert.match(home.body,/School workspace/);assert.equal(home.headers['cache-control'],'no-cache');assert.ok(home.headers['content-security-policy']);assert.ok(home.headers['x-content-type-options']);
  const deep=await new Promise<any>(resolve=>http.get({host:'127.0.0.1',port,path:'/learners/anything',headers:{host:'app.example.test'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));}));assert.equal(deep.status,200);assert.match(deep.body,/School workspace/);
  const asset=await raw(port,'GET','/assets/app.js',{host:'app.example.test'});assert.equal(asset.status,200);assert.match(String(asset.headers['cache-control']),/immutable/);
  const api=await raw(port,'GET','/api/v1/does-not-exist',{host:'app.example.test'});assert.equal(api.status,404);assert.equal(typeof api.json?.message,'string');
  assert.equal((await raw(port,'GET','/',{host:'evil.example.test'})).status,403);
});

test('startup refuses a database that is behind the bundled migrations',async()=>{
  const {assertMigrated}=require('../dist/core/health');
  const {app}=await start();const pool=app.get(Database).pool;
  await assertMigrated(pool);
  const dir=mkdtempSync(path.join(os.tmpdir(),'migrations-'));for(const name of readdirSync(path.resolve(__dirname,'../migrations')))writeFileSync(path.join(dir,name),'-- bundled');writeFileSync(path.join(dir,'999_future.sql'),'-- newer');
  await assert.rejects(assertMigrated(pool,dir),/behind/);
});
