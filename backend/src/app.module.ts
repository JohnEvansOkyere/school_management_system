import { Module } from '@nestjs/common';
import { Database } from './core/database';
import { Access } from './core/access';
import { IdentityController } from './modules/identity/identity.controller';
import { TenancyController } from './modules/tenancy/tenancy.controller';
import { ExportsController } from './modules/tenancy/exports.controller';
import { LearnersController } from './modules/learners/learners.controller';
import { LearnersService } from './modules/learners/learners.service';
@Module({controllers:[IdentityController,TenancyController,ExportsController,LearnersController],providers:[Database,Access,LearnersService]})
export class AppModule {}
