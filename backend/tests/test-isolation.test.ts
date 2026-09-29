import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
const {localConfig}=require('../dist/core/database');

test('local database name can be overridden for per-run databases',()=>{
  const prior=process.env.LOCAL_DB_NAME;
  try{
    process.env.LOCAL_DB_NAME='school_saas_run_example';assert.equal(localConfig().database,'school_saas_run_example');
    delete process.env.LOCAL_DB_NAME;assert.equal(localConfig().database,'school_saas_local');
  }finally{if(prior===undefined)delete process.env.LOCAL_DB_NAME;else process.env.LOCAL_DB_NAME=prior;}
});

test('the suite runs against a fresh per-run database cloned from the migrated template',async()=>{
  assert.match(process.env.LOCAL_DB_NAME??'',/^school_saas_run_\d+$/);
  const pool=new Pool({...localConfig(true)});
  try{assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,process.env.LOCAL_DB_NAME);}
  finally{await pool.end();}
});
