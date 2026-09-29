import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { Access, Actor } from '../../core/access';
import { audit } from '../../core/commands';
import { hashPassword } from '../identity/identity.controller';

class NewAccountDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(200) email!: string;
  @IsIn(['teacher','frontdesk','accountant','guardian']) role!: string;
}
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(16),byte => alphabet[byte % alphabet.length]).join('');
}
// Headteachers manage accounts inside their own school; the database functions re-check the caller.
@Controller('api/v1/schools/:schoolId/accounts')
export class AccountsController {
  constructor(private readonly access: Access) {}
  private run<T>(req: Request, schoolId: string, write: boolean, work: (client: PoolClient, actor: Actor) => Promise<T>) {
    return this.access.school(req,schoolId,['headteacher'],async (client,actor) => {
      try { return await work(client,actor); }
      catch (error) {
        const pg = error as {code?:string;message?:string};
        if (pg.code === '23505') throw new ConflictException('That email address already has an account');
        if (pg.code === '22023') throw new BadRequestException(pg.message);
        if (pg.code === 'P0002') throw new NotFoundException(pg.message);
        throw error;
      }
    },write);
  }
  @Get()
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.run(req,schoolId,false,async client => ({items:(await client.query('SELECT user_id,membership_id,display_name,login,role,revoked_at,must_change_password FROM staff_list()')).rows}));
  }
  @Post()
  create(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: NewAccountDto) {
    const password = temporaryPassword();
    return this.run(req,schoolId,true,async (client,actor) => {
      const id = (await client.query('SELECT staff_create($1,$2,$3,$4) AS id',[body.name.trim(),body.email,await hashPassword(password),body.role])).rows[0].id as string;
      await audit(client,actor,'account.created',id,{role:body.role});
      return {userId:id,email:body.email.toLowerCase(),role:body.role,temporaryPassword:password};
    });
  }
  @Post(':userId/reset-password')
  reset(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    const password = temporaryPassword();
    return this.run(req,schoolId,true,async (client,actor) => {
      await client.query('SELECT staff_reset_password($1,$2)',[userId,await hashPassword(password)]);
      await audit(client,actor,'account.password_reset',userId);
      return {temporaryPassword:password};
    });
  }
  @Post(':userId/revoke')
  revoke(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    return this.run(req,schoolId,true,async (client,actor) => {
      await client.query('SELECT staff_revoke($1)',[userId]);
      await audit(client,actor,'account.revoked',userId);
      return {revoked:true};
    });
  }
}
