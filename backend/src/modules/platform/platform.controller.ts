import { Body, Controller, ForbiddenException, Get, NotFoundException, ConflictException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { PoolClient } from 'pg';
import { Access } from '../../core/access';
import { Database } from '../../core/database';
import { PageDto } from '../learners/learners.dto';
import { hashPassword } from '../identity/identity.controller';

class NewSchoolDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/\S.{1,}\S/) name!: string;
  @IsString() @MinLength(2) @MaxLength(120) headteacherName!: string;
  @IsEmail() @MaxLength(200) headteacherEmail!: string;
}
class NewUserDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(200) email!: string;
  @IsIn(['headteacher','teacher','accountant','frontdesk','guardian']) role!: string;
}
// Shown once to the platform administrator; 16 characters from an unambiguous alphabet.
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(randomBytes(16),byte => alphabet[byte % alphabet.length]).join('');
}
@Controller('api/v1/platform')
export class PlatformController {
  constructor(private readonly db: Database, private readonly access: Access) {}
  private async admin<T>(req: Request, write: boolean, work: (client: PoolClient) => Promise<T>) {
    try {
      return await this.db.transaction(async client => {
        await this.access.identity(client,req,write);
        if (!(await client.query('SELECT is_platform_admin() AS admin')).rows[0].admin) throw new ForbiddenException('Platform administrator required');
        return work(client);
      });
    } catch (error) {
      const pg = error as {code?:string;message?:string};
      if (pg.code === '23505') throw new ConflictException('That email address already has an account');
      if (pg.code === 'P0002') throw new NotFoundException(pg.message);
      throw error;
    }
  }
  @Get('schools')
  schools(@Req() req: Request,@Query() page: PageDto) {
    return this.admin(req,false,async client => {
      const all = (await client.query('SELECT id,name,members::int,headteachers::int FROM platform_schools()')).rows;
      return {items:all.slice(page.offset,page.offset+page.limit),total:all.length,limit:page.limit,offset:page.offset};
    });
  }
  @Post('schools')
  createSchool(@Req() req: Request,@Body() body: NewSchoolDto) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      const row = (await client.query('SELECT school_id,user_id FROM platform_create_school($1,$2,$3,$4)',[body.name.trim(),body.headteacherName.trim(),body.headteacherEmail,await hashPassword(password)])).rows[0];
      return {schoolId:row.school_id,headteacher:{userId:row.user_id,email:body.headteacherEmail.toLowerCase(),temporaryPassword:password}};
    });
  }
  @Post('schools/:schoolId/users')
  createUser(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: NewUserDto) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      const id = (await client.query('SELECT platform_create_user($1,$2,$3,$4,$5) AS id',[schoolId,body.name.trim(),body.email,await hashPassword(password),body.role])).rows[0].id;
      return {userId:id,email:body.email.toLowerCase(),role:body.role,temporaryPassword:password};
    });
  }
  @Post('schools/:schoolId/users/:userId/reset-password')
  reset(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('userId',new ParseUUIDPipe()) userId: string) {
    const password = temporaryPassword();
    return this.admin(req,true,async client => {
      await client.query('SELECT platform_reset_password($1,$2,$3)',[schoolId,userId,await hashPassword(password)]);
      return {temporaryPassword:password};
    });
  }
  @Post('schools/:schoolId/enter')
  enter(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.admin(req,true,async client => ({membershipId:(await client.query('SELECT platform_enter_school($1) AS id',[schoolId])).rows[0].id}));
  }
}
