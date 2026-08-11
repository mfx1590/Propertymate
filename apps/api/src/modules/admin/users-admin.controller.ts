import { Body, Controller, Delete, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UsersAdminService } from './users-admin.service';

/** Admin user console (Plan §6.7): search, suspend/ban with reason, role grants. */
@RequirePermissions('user.manage')
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.list({ q, status, role, limit: Number(limit) || undefined });
  }

  @Post(':id/status')
  setStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
    @Ip() ip: string,
  ) {
    return this.users.setStatus(admin.sub, id, body?.status, body?.reason ?? '', ip);
  }

  @Post(':id/roles')
  grantRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { roleKey: string },
    @Ip() ip: string,
  ) {
    return this.users.grantRole(admin.sub, id, body?.roleKey, ip);
  }

  @Delete(':id/roles/:roleKey')
  revokeRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Param('roleKey') roleKey: string,
    @Ip() ip: string,
  ) {
    return this.users.revokeRole(admin.sub, id, roleKey, ip);
  }
}
