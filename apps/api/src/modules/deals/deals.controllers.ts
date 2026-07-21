import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DealsService } from './deals.service';
import { RatingsService } from './ratings.service';

@RequirePermissions('deal.participate')
@Controller('deals')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly ratings: RatingsService,
  ) {}

  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.deals.listMine(user.sub);
  }

  @Get(':id')
  getDeal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.deals.getDeal(user.sub, id);
  }

  @RequirePermissions('deal.stage.complete')
  @Post(':id/advance')
  advance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { note?: string }, @Ip() ip: string) {
    return this.deals.advanceStage(user.sub, id, body?.note, ip);
  }

  @RequirePermissions('deal.stage.complete')
  @Post(':id/skip')
  skip(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.deals.skipStage(user.sub, id, ip);
  }

  @RequirePermissions('deal.document.upload')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  attach(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body('documentType') documentType: string,
    @Ip() ip: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart/form-data)');
    if (!documentType) throw new BadRequestException('documentType is required');
    return this.deals.attachDocument(user.sub, id, documentType, file, ip);
  }

  // ── ratings ──────────────────────────────────────────────────────

  @Get(':id/rateable')
  rateable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ratings.rateableParties(user.sub, id);
  }

  @RequirePermissions('rating.create')
  @Post(':id/ratings')
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { rateeId: string; stars: number; tags?: string[]; comment?: string },
    @Ip() ip: string,
  ) {
    return this.ratings.submit(user.sub, id, body.rateeId, Number(body.stars), body.tags ?? [], body.comment, ip);
  }
}

@Controller()
export class ReviewsController {
  constructor(private readonly ratings: RatingsService) {}

  /** Public performance/reviews on a professional profile (§13.2). */
  @Public()
  @Get('users/:id/reviews')
  reviews(@Param('id') id: string) {
    return this.ratings.publicReviews(id);
  }
}
