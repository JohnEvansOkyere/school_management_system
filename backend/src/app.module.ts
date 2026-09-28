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
@Module({controllers:[IdentityController,TenancyController,ExportsController,LearnersController,GuardiansController,TeachingController],providers:[Database,Access,LearnersService,GuardiansService,TeachingService]})
export class AppModule {}
