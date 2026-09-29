import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
const {workerDatabaseConfig}=require('../dist/core/database');

test('sslrootcert=bundled resolves to the shipped Supabase CA and pool size is configurable',()=>{
  const prior={...process.env};
  try{
    Object.assign(process.env,{DATABASE_TARGET:'supabase',NODE_ENV:'production',DB_POOL_MAX:'2',WORKER_DATABASE_URL:'postgresql://school_worker.ref:secret@pooler.example:5432/postgres?sslmode=verify-full&sslrootcert=bundled'});
    const config=workerDatabaseConfig();const cert=decodeURIComponent(new URL(config.connectionString).searchParams.get('sslrootcert')!);
    assert.equal(cert,path.resolve(__dirname,'../certs/supabase-prod-ca-2021.crt'));assert.ok(existsSync(cert));assert.equal(config.max,2);
    assert.match(require('node:fs').readFileSync(cert,'utf8'),/BEGIN CERTIFICATE/);
  }finally{for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);}
});
