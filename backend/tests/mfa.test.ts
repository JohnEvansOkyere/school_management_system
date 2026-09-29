import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
const {createApp}=require('../dist/main');
const {totp,stepFor,verifyTotp,base32Encode,base32Decode,encryptSecret,decryptSecret}=require('../dist/core/totp');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
let app:any,base:string;
async function login(email:string,password='Synthetic-only-2026!'){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,actor:any,method='GET',body?:unknown){const r=await fetch(`${base}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
const schoolA='10000000-0000-4000-8000-000000000001';
before(async()=>{process.env.DEV_AUTH='synthetic-local';process.env.MFA_REQUIRED='true';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;});
after(async()=>{delete process.env.MFA_REQUIRED;await app?.close();await owner.end();});

test('TOTP matches RFC 6238 vectors, enforces the step window and replay, and secrets are encrypted',()=>{
  const secret=base32Encode(Buffer.from('12345678901234567890'));assert.equal(base32Decode(secret).toString(),'12345678901234567890');
  assert.equal(totp(secret,Math.floor(59/30)),'287082');assert.equal(totp(secret,Math.floor(1111111109/30)),'081804');assert.equal(totp(secret,Math.floor(20000000000/30)),'353130');
  const now=59_000;assert.equal(verifyTotp(secret,'287082',0,now),1);assert.equal(verifyTotp(secret,'287082',1,now),null);assert.equal(verifyTotp(secret,'12345',0,now),null);assert.equal(verifyTotp(secret,'000000',0,now),null);
  const stored=encryptSecret(secret);assert.ok(!stored.includes(secret));assert.equal(decryptSecret(stored),secret);
});

test('privileged roles must set up and verify a second step; other roles are unaffected',async()=>{
  const teacher=await login('teacher@example.test');assert.equal((await call(`/schools/${schoolA}`,teacher)).status,200);assert.equal((await call('/auth/session',teacher)).body.mfaRequired,false);
  assert.equal((await call('/auth/mfa/setup',teacher,'POST',{})).status,400);
  const head=await login('head@example.test');const session=(await call('/auth/session',head)).body;assert.equal(session.mfaRequired,true);assert.equal(session.mfaEnrolled,false);assert.deepEqual(session.schools,[]);
  const blocked=await call(`/schools/${schoolA}`,head);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'MFA_REQUIRED');
  assert.equal((await call('/auth/mfa/verify',head,'POST',{code:'123456'})).status,409);
  const setup=await call('/auth/mfa/setup',head,'POST',{});assert.equal(setup.status,201);assert.match(setup.body.otpauthUrl,/^otpauth:\/\/totp\//);
  const stored=(await owner.query("SELECT secret_ciphertext FROM user_mfa WHERE user_id='20000000-0000-4000-8000-000000000001'")).rows[0].secret_ciphertext;assert.ok(!stored.includes(setup.body.secret));
  assert.equal((await call('/auth/mfa/confirm',head,'POST',{code:'000000'})).status,401);
  const step=stepFor();const confirmed=await call('/auth/mfa/confirm',head,'POST',{code:totp(setup.body.secret,step)});assert.equal(confirmed.status,201,JSON.stringify(confirmed.body));assert.equal(confirmed.body.recoveryCodes.length,8);
  assert.equal((await call(`/schools/${schoolA}`,head)).status,200);assert.equal((await call('/auth/mfa/setup',head,'POST',{})).status,409);

  const again=await login('head@example.test');assert.equal((await call(`/schools/${schoolA}`,again)).body.code,'MFA_REQUIRED');assert.equal((await call('/auth/session',again)).body.mfaEnrolled,true);
  assert.equal((await call('/auth/mfa/verify',again,'POST',{code:totp(setup.body.secret,step)})).status,401,'the code used at setup cannot be replayed');
  assert.equal((await call('/auth/mfa/verify',again,'POST',{code:totp(setup.body.secret,step+1)})).status,201);assert.equal((await call(`/schools/${schoolA}`,again)).status,200);
  const third=await login('head@example.test');assert.equal((await call('/auth/mfa/verify',third,'POST',{code:totp(setup.body.secret,step+1)})).status,401,'a used code is rejected');
  const recovery=confirmed.body.recoveryCodes[0];assert.equal((await call('/auth/mfa/verify',third,'POST',{code:recovery})).status,201);
  const fourth=await login('head@example.test');assert.equal((await call('/auth/mfa/verify',fourth,'POST',{code:recovery})).status,401,'recovery codes work once');
  for(let i=0;i<5;i++)await call('/auth/mfa/verify',fourth,'POST',{code:'111111'});
  assert.equal((await call('/auth/mfa/verify',fourth,'POST',{code:confirmed.body.recoveryCodes[1]})).status,429,'locked after repeated failures');
  await owner.query("UPDATE user_mfa SET locked_until=NULL,failed_attempts=0 WHERE user_id='20000000-0000-4000-8000-000000000001'");
});

test('platform administrators also need the second step',async()=>{
  const id=randomUUID(),email=`mfa-admin-${id.slice(0,8)}@example.test`,salt=randomBytes(16).toString('hex');
  await owner.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4)',[id,'MFA Admin',email,`${salt}:${scryptSync('Platform-admin-2026!',salt,64).toString('hex')}`]);await owner.query('INSERT INTO platform_admins(user_id) VALUES($1)',[id]);
  const admin=await login(email,'Platform-admin-2026!');const blocked=await call('/platform/schools',admin);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'MFA_REQUIRED');
});
