import { Module } from '@nestjs/common';
import { AdminListingsController } from './admin-listings.controller';

@Module({
  controllers: [AdminListingsController],
})
export class AdminModule {}
