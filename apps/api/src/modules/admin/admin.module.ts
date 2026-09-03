import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { AdminListingsController } from './admin-listings.controller';
import { UsersAdminController } from './users-admin.controller';
import { UsersAdminService } from './users-admin.service';
import { AuditBrowserController, ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * ModerationModule supplies the identity-ban list: banning from here must
 * record the same papers as an automatic ban from the review queue, or the
 * durability of a ban would depend on which screen an admin used.
 */
@Module({
  imports: [ModerationModule],
  controllers: [AdminListingsController, UsersAdminController, AuditBrowserController, ExportsController],
  providers: [UsersAdminService, ExportsService],
})
export class AdminModule {}
