import { test } from 'node:test';
import assert from 'node:assert/strict';
const {workerDatabaseConfig}=require('../dist/core/database');

function withEnv(values:Record<string,string|undefined>,work:()=>void){
  const prior=new Map(Object.keys(values).map(key=>[key,process.env[key]]));
  try{for(const [key,value] of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}work();}
  finally{for(const [key,value] of prior){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('worker uses its restricted local role in local/test environments',()=>withEnv({DATABASE_TARGET:'local',NODE_ENV:'test',WORKER_DATABASE_URL:undefined},()=>{
  const config=workerDatabaseConfig();assert.equal(config.user,'school_worker');assert.equal(config.database,process.env.LOCAL_DB_NAME??'school_saas_local');assert.equal(config.application_name,'school-management-worker');
}));

test('Supabase worker requires its own TLS-verified school_worker URL',()=>withEnv({DATABASE_TARGET:'supabase',NODE_ENV:'production',WORKER_DATABASE_URL:undefined},()=>{
  assert.throws(()=>workerDatabaseConfig(),/WORKER_DATABASE_URL is required/);
  process.env.WORKER_DATABASE_URL='postgresql://school_app.projectref:secret@pooler.example:5432/postgres?sslmode=verify-full&sslrootcert=%2Fca.crt';
  assert.throws(()=>workerDatabaseConfig(),/must use the restricted school_worker/);
  process.env.WORKER_DATABASE_URL='postgresql://school_worker.projectref:secret@pooler.example:5432/postgres';
  assert.throws(()=>workerDatabaseConfig(),/sslmode=verify-full/);
  process.env.WORKER_DATABASE_URL='postgresql://school_worker.projectref:secret@pooler.example:5432/postgres?sslmode=verify-full&sslrootcert=%2Fca.crt';
  const config=workerDatabaseConfig();assert.equal(config.connectionString,process.env.WORKER_DATABASE_URL);assert.equal(config.application_name,'school-management-worker');
}));
