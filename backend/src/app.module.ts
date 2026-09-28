import { Module } from '@nestjs/common';
import { Database } from './core/database';
import { Access } from './core/access';
import { IdentityController } from './modules/identity/identity.controller';
import { TenancyController } from './modules/tenancy/tenancy.controller';
@Module({controllers:[IdentityController,TenancyController],providers:[Database,Access]})
export class AppModule {}
