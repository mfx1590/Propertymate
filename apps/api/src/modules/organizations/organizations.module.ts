import { Module } from '@nestjs/common';
import { AgenciesPublicController, AgencyMembersController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [AgencyMembersController, AgenciesPublicController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
