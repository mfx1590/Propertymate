import { Global, Module } from '@nestjs/common';
import { RegionsController } from './regions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

// global: PermissionsGuard (registered as APP_GUARD) needs RolesService everywhere
@Global()
@Module({
  controllers: [RolesController, RegionsController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
