import { Body, Controller, Delete, Get, Ip, Param, Post, Put } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OrganizationsService } from './organizations.service';
import { AddMemberDto, UpdateMemberDto } from './dto/organizations.dto';

@Controller('agency/members')
export class AgencyMembersController {
  constructor(private readonly organizations: OrganizationsService) {}

  @RequirePermissions('agency.agents.manage')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.organizations.listMembers(user.sub);
  }

  @RequirePermissions('agency.agents.manage')
  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: AddMemberDto, @Ip() ip: string) {
    return this.organizations.addMember(user.sub, dto, ip);
  }

  @RequirePermissions('agency.agents.manage')
  @Put(':userId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberDto,
    @Ip() ip: string,
  ) {
    return this.organizations.updateMember(user.sub, memberUserId, dto, ip);
  }

  @RequirePermissions('agency.agents.manage')
  @Delete(':userId')
  remove(@CurrentUser() user: AuthUser, @Param('userId') memberUserId: string, @Ip() ip: string) {
    return this.organizations.removeMember(user.sub, memberUserId, ip);
  }
}

@Controller('agencies')
export class AgenciesPublicController {
  constructor(private readonly organizations: OrganizationsService) {}

  // public browse/SEO path — not rate-limited (§11 targets auth/chat/inquiry)
  @SkipThrottle()
  @Public()
  @Get(':id')
  publicAgency(@Param('id') id: string) {
    return this.organizations.publicAgency(id);
  }
}
