import { ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash,randomUUID } from 'node:crypto';
import { Actor } from './access';

export async function audit(client:PoolClient,actor:Actor,action:string,targetId:string,metadata:Record<string,unknown>={}) {
  await client.query('INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,actor.membershipId,action,targetId,JSON.stringify(metadata)]);
}
export async function command<T>(client:PoolClient,actor:Actor,id:string,action:string,payload:unknown,work:()=>Promise<T>):Promise<T> {
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.schoolId}:${id}`]);
  const prior=await client.query('SELECT actor_membership_id,action,payload_digest,response FROM command_receipts WHERE school_id=$1 AND id=$2',[actor.schoolId,id]);
  if(prior.rowCount) {
    const receipt=prior.rows[0];
    if(receipt.actor_membership_id!==actor.membershipId||receipt.action!==action||receipt.payload_digest!==hash)throw new ConflictException('Operation ID is already bound to a different request');
    return receipt.response;
  }
  try {
    const result=await work();
    await client.query('INSERT INTO command_receipts(school_id,id,actor_membership_id,action,payload_digest,response) VALUES($1,$2,$3,$4,$5,$6)',[actor.schoolId,id,actor.membershipId,action,hash,JSON.stringify(result)]);
    return result;
  }catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('This identifier already exists in this school');throw error;}
}
