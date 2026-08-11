import { Module } from '@nestjs/common';
import { AdminListingsController } from './admin-listings.controller';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';

@Module({
  controllers: [AdminListingsController, UsersAdminController],
  providers: [UsersAdminService],
})
export class AdminModule {}
