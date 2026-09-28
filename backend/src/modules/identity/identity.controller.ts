import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Request, Response } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Database } from '../../core/database';
import { Access, digest, sessionToken } from '../../core/access';
class LoginDto {
  @IsEmail() @MaxLength(200) email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}
@Controller('api/v1/auth')
export class IdentityController {
  constructor(private readonly db: Database, private readonly access: Access) {}
  @Post('login')
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({passthrough:true}) res: Response) {
    if (process.env.DEV_AUTH !== 'synthetic-local' || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) throw new ForbiddenException('Synthetic identity is disabled');
    const identity = await this.db.pool.query('SELECT id,password_hash FROM users WHERE synthetic_login=$1',[body.email]);
    const [salt,hash] = identity.rows[0]?.password_hash.split(':') ?? ['missing', '00'.repeat(64)];
    if (!timingSafeEqual(scryptSync(body.password,salt,64),Buffer.from(hash,'hex')) || !identity.rowCount) throw new UnauthorizedException('Sign-in details were not accepted');
    const token = randomBytes(32).toString('hex'); const csrf = randomBytes(32).toString('hex');
    await this.db.transaction(async client => {
      if (sessionToken(req)) await client.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]);
      await client.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(token),identity.rows[0].id,csrf]);
    });
    res.cookie('school_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api',maxAge:8*3600*1000});
    return {csrfToken:csrf};
  }
  @Get('session')
  async session(@Req() req: Request) {
    return this.db.transaction(async client => {
      const identity = await this.access.identity(client,req);
      const memberships = await client.query('SELECT school_id,role FROM memberships WHERE user_id=$1 AND revoked_at IS NULL ORDER BY school_id',[identity.user_id]);
      const schools = [];
      for (const membership of memberships.rows) {
        await client.query("SELECT set_config('app.school_id',$1,true)",[membership.school_id]);
        const school = await client.query('SELECT id,name FROM schools WHERE id=$1',[membership.school_id]);
        schools.push({...school.rows[0],role:membership.role});
      }
      return {displayName:identity.display_name,csrfToken:identity.csrf_token,schools};
    });
  }
  @Post('logout')
  async logout(@Req() req: Request,@Res({passthrough:true}) res: Response) {
    await this.db.transaction(async client => { await this.access.identity(client,req,true); await client.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[digest(sessionToken(req))]); });
    res.clearCookie('school_session',{path:'/api'}); return {signedOut:true};
  }
}
