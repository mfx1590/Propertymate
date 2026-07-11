import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProfilesService } from './profiles.service';

// NOTE: no self-service role endpoint — account type is chosen at registration
// (change log 2026-07-10); further role grants are an admin action (Phase 1 step 4+).
@Controller('users/me')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('roles')
  listMyRoles(@CurrentUser() user: AuthUser) {
    return this.profilesService.listMyRoles(user.sub);
  }

  @Get('profile/:roleKey')
  getProfile(@CurrentUser() user: AuthUser, @Param('roleKey') roleKey: string) {
    return this.profilesService.getProfile(user.sub, roleKey);
  }

  /** Profile verification documents (government ID, license…) — private bucket. */
  @Post('profile/:roleKey/documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadProfileDocument(
    @CurrentUser() user: AuthUser,
    @Param('roleKey') roleKey: string,
    @Body('documentType') documentType: string,
    @Ip() ip: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    if (!documentType) throw new BadRequestException('documentType is required');
    return this.profilesService.addProfileDocument(user.sub, roleKey, documentType, file, ip);
  }

  @Get('profile/:roleKey/documents')
  listProfileDocuments(@CurrentUser() user: AuthUser, @Param('roleKey') roleKey: string) {
    return this.profilesService.listProfileDocuments(user.sub, roleKey);
  }

  // Per-role DTO validation happens in the service switch; whitelist stripping
  // still applies via the global ValidationPipe on the union DTO fields.
  @Put('profile/:roleKey')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('roleKey') roleKey: string,
    @Body() body: Record<string, unknown>,
    @Ip() ip: string,
  ) {
    return this.profilesService.updateProfile(user.sub, roleKey, body, ip);
  }
}
