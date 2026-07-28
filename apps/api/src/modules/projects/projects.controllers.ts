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
import { DealsService } from '../deals/deals.service';
import { ChatService } from '../chat/chat.service';
import { ProjectsService } from './projects.service';
import { ProjectUpdatesService } from './project-updates.service';
import { UnitsService } from './units.service';
import {
  ProjectInquiryDto,
  PublishUpdateDto,
  UnitDto,
  UpdateProjectDto,
  UpdateUnitDto,
} from './dto/projects.dto';
import { ReorderMediaDto } from '../properties/dto/properties.dto';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly units: UnitsService,
    private readonly updates: ProjectUpdatesService,
    private readonly chat: ChatService,
  ) {}

  // ── developer: master info ───────────────────────────────────────

  @RequirePermissions('project.create')
  @Post()
  createDraft(@CurrentUser() user: AuthUser, @Ip() ip: string) {
    return this.projects.createDraft(user.sub, ip);
  }

  @RequirePermissions('project.create')
  @Get('requirements')
  getRequirements() {
    return this.projects.getProjectRequirements();
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.projects.listMine(user.sub);
  }

  @RequirePermissions('project.update.own')
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Ip() ip: string,
  ) {
    return this.projects.updateDraft(user.sub, id, dto, ip);
  }

  @RequirePermissions('project.update.own')
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file'))
  addPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    return this.projects.addPhoto(user.sub, id, file);
  }

  @RequirePermissions('project.update.own')
  @Put(':id/photos/order')
  reorderPhotos(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReorderMediaDto) {
    return this.projects.reorderPhotos(user.sub, id, dto.mediaIds);
  }

  @RequirePermissions('project.update.own')
  @Delete(':id/photos/:mediaId')
  deletePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.projects.deletePhoto(user.sub, id, mediaId);
  }

  @RequirePermissions('project.update.own')
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
    return this.projects.addDocument(user.sub, id, documentType, file, ip);
  }

  @RequirePermissions('project.update.own')
  @Get(':id/documents')
  listDocuments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.listDocuments(user.sub, id);
  }

  @RequirePermissions('project.create')
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.projects.submit(user.sub, id, ip);
  }

  // ── developer: unit inventory ────────────────────────────────────

  @RequirePermissions('project.unit.manage')
  @Get(':id/units')
  listUnits(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.units.list(user.sub, id);
  }

  @RequirePermissions('project.unit.manage')
  @Post(':id/units')
  createUnit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UnitDto,
    @Ip() ip: string,
  ) {
    return this.units.create(user.sub, id, dto, ip);
  }

  @RequirePermissions('project.unit.manage')
  @Put(':id/units/:unitId')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
    @Ip() ip: string,
  ) {
    return this.units.update(user.sub, id, unitId, dto, ip);
  }

  @RequirePermissions('project.unit.manage')
  @Delete(':id/units/:unitId')
  removeUnit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Ip() ip: string,
  ) {
    return this.units.remove(user.sub, id, unitId, ip);
  }

  /** Bulk import — either a multipart `file` or a JSON body `{ csv }`. */
  @RequirePermissions('project.unit.manage')
  @Post(':id/units/import')
  @UseInterceptors(FileInterceptor('file'))
  importUnits(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('csv') csvBody: string | undefined,
    @Ip() ip: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const csv = file ? file.buffer.toString('utf8') : csvBody;
    if (!csv) throw new BadRequestException('Provide a CSV file or a `csv` body field');
    return this.units.importCsv(user.sub, id, csv, ip);
  }

  // ── developer: progress feed & leads ─────────────────────────────

  @RequirePermissions('project.update.publish')
  @Post(':id/updates')
  publishUpdate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PublishUpdateDto,
    @Ip() ip: string,
  ) {
    return this.updates.publish(user.sub, id, dto, ip);
  }

  @RequirePermissions('project.update.own')
  @Get(':id/leads')
  leads(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.leads(user.sub, id);
  }

  // ── public ───────────────────────────────────────────────────────

  @SkipThrottle()
  @Public()
  @Get()
  browse(
    @Query('region') region?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minBeds') minBeds?: string,
  ) {
    return this.projects.browse({
      region,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      minBeds: minBeds ? Number(minBeds) : undefined,
    });
  }

  @SkipThrottle()
  @Public()
  @Get(':id/updates')
  publicUpdates(@Param('id') id: string) {
    return this.updates.list(id);
  }

  @RequirePermissions('chat.participate')
  @Post(':id/inquire')
  inquire(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ProjectInquiryDto,
    @Ip() ip: string,
  ) {
    return this.chat.inquireProject(user.sub, id, dto.message, ip);
  }

  // public detail (keep LAST: ':id' would otherwise shadow the routes above)
  @SkipThrottle()
  @Public()
  @Get(':id')
  getPublic(@Param('id') id: string) {
    return this.projects.getPublic(id);
  }
}

/** Unit-level buyer actions live off `/units` so they never shadow `/projects/:id`. */
@Controller('units')
export class UnitsPublicController {
  constructor(private readonly deals: DealsService) {}

  @RequirePermissions('offer.create')
  @Post(':unitId/reserve')
  async reserve(@CurrentUser() user: AuthUser, @Param('unitId') unitId: string, @Ip() ip: string) {
    const dealId = await this.deals.createFromUnitReservation(user.sub, unitId, ip);
    return { dealId };
  }
}
