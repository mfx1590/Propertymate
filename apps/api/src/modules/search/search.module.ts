import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService, RecommendationsService],
  exports: [SearchService, RecommendationsService],
})
export class SearchModule {}
