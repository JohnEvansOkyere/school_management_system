import { Module } from '@nestjs/common';
import { Database } from './core/database';
import { Access } from './core/access';
import { IdentityController } from './modules/identity/identity.controller';
import { TenancyController } from './modules/tenancy/tenancy.controller';
import { ExportsController } from './modules/tenancy/exports.controller';
import { LearnersController } from './modules/learners/learners.controller';
import { LearnersService } from './modules/learners/learners.service';
import { GuardiansController } from './modules/learners/guardians.controller';
import { GuardiansService } from './modules/learners/guardians.service';
import { TeachingController } from './modules/staff/teaching.controller';
import { TeachingService } from './modules/staff/teaching.service';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AttendanceService } from './modules/attendance/attendance.service';
@Module({controllers:[IdentityController,TenancyController,ExportsController,LearnersController,GuardiansController,TeachingController,AttendanceController],providers:[Database,Access,LearnersService,GuardiansService,TeachingService,AttendanceService]})
export class AppModule {}
