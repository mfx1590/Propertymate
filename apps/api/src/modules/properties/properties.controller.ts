import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, ReorderMediaDto, UpdatePropertyDto } from './dto/properties.dto';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  // ── lister endpoints ─────────────────────────────────────────────

  @RequirePermissions('listing.create')
  @Post()
  createDraft(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto, @Ip() ip: string) {
    return this.properties.createDraft(user.sub, dto.kind, ip);
  }

  @RequirePermissions('listing.create')
  @Get('requirements')
  getRequirements(@CurrentUser() user: AuthUser, @Query('kind') kind: string) {
    if (kind !== 'resale' && kind !== 'rental') throw new BadRequestException('kind must be resale|rental');
    return this.properties.getListingRequirements(user.sub, kind);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.properties.listMine(user.sub);
  }

  @RequirePermissions('listing.update.own')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
    @Ip() ip: string,
  ) {
    return this.properties.updateDraft(user.sub, id, dto, ip);
  }

  @RequirePermissions('listing.update.own')
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file'))
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    return this.properties.addPhoto(user.sub, id, file);
  }

  @RequirePermissions('listing.update.own')
  @Put(':id/photos/order')
  reorderPhotos(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReorderMediaDto) {
    return this.properties.reorderPhotos(user.sub, id, dto.mediaIds);
  }

  @RequirePermissions('listing.update.own')
  @Delete(':id/photos/:mediaId')
  deletePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.properties.deletePhoto(user.sub, id, mediaId);
  }

  @RequirePermissions('listing.update.own')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('documentType') documentType: string,
    @Ip() ip: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    if (!documentType) throw new BadRequestException('documentType is required');
    return this.properties.addDocument(user.sub, id, documentType, file, ip);
  }

  @RequirePermissions('listing.update.own')
  @Get(':id/documents')
  listDocuments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.properties.listDocuments(user.sub, id);
  }

  @RequirePermissions('listing.create')
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.properties.submit(user.sub, id, ip);
  }

  @RequirePermissions('listing.confirm_availability')
  @Post(':id/confirm-availability')
  confirmAvailability(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.properties.confirmAvailability(user.sub, id, ip);
  }

  // ── favorites ────────────────────────────────────────────────────

  @RequirePermissions('favorite.manage')
  @Post(':id/favorite')
  favorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.properties.setFavorite(user.sub, id, true);
  }

  @RequirePermissions('favorite.manage')
  @Delete(':id/favorite')
  unfavorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.properties.setFavorite(user.sub, id, false);
  }

  // ── public detail (keep LAST: ':id' would otherwise shadow routes above) ──

  // public browse/SEO path — not rate-limited (§11 targets auth/chat/inquiry)
  @SkipThrottle()
  @Public()
  @Get(':id')
  getPublic(@Param('id') id: string) {
    return this.properties.getPublic(id);
  }
}
