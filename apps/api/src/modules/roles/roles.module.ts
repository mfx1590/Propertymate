import { Global, Module } from '@nestjs/common';
import { RolesService } from './roles.service';

// global: PermissionsGuard (registered as APP_GUARD) needs RolesService everywhere
@Global()
@Module({
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
