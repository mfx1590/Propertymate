import { Global, Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

// global: PermissionsGuard (registered as APP_GUARD) needs RolesService everywhere
@Global()
@Module({
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
