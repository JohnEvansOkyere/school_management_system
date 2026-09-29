import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { Database } from './database';

export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export function sessionToken(req: Request) {
  const match = (req.headers.cookie ?? '').match(/(?:^|;\s*)school_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] ?? '';
}
export interface Actor { userId: string; membershipId: string; role: string; schoolId: string; displayName?: string }
@Injectable()
export class Access {
  constructor(private readonly db: Database) {}
  async identity(client: PoolClient, req: Request, write = false, allowPasswordChange = false, allowMfaSetup = false) {
    const result = await client.query('SELECT s.user_id,s.csrf_token,s.mfa_verified_at,u.display_name,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() FOR SHARE OF s', [digest(sessionToken(req))]);
    if (!result.rowCount) throw new UnauthorizedException('Sign in to continue');
    const session = result.rows[0];
    if (write && req.headers['x-csrf-token'] !== session.csrf_token) throw new ForbiddenException('Invalid request verification');
    if (session.must_change_password && !allowPasswordChange) throw new ForbiddenException({message:'Change your temporary password to continue',code:'PASSWORD_CHANGE_REQUIRED'});
    await client.query("SELECT set_config('app.user_id',$1,true)",[session.user_id]);
    const mfaOn = process.env.MFA_REQUIRED ? process.env.MFA_REQUIRED === 'true' : process.env.NODE_ENV === 'production';
    session.mfa_required = mfaOn && (await client.query('SELECT user_requires_mfa() AS required')).rows[0].required === true;
    if (session.mfa_required && !session.mfa_verified_at && !allowMfaSetup) throw new ForbiddenException({message:'Verify your second sign-in step to continue',code:'MFA_REQUIRED'});
    return session;
  }
  async school<T>(req: Request, schoolId: string, roles: string[] | null, work: (client: PoolClient,actor: Actor) => Promise<T>, write=false) {
    return this.db.transaction(async client => {
      const session = await this.identity(client,req,write);
      // A narrow definer function locks live membership without granting runtime membership writes.
      const membership = await client.query('SELECT id,role FROM active_membership($1)',[schoolId]);
      if (!membership.rowCount) throw new NotFoundException('School unavailable');
      if (roles && !roles.includes(membership.rows[0].role)) throw new ForbiddenException('Your role cannot perform this action');
      await client.query("SELECT set_config('app.school_id',$1,true)",[schoolId]);
      return work(client,{userId:session.user_id,membershipId:membership.rows[0].id,role:membership.rows[0].role,schoolId,displayName:session.display_name});
    });
  }
}
