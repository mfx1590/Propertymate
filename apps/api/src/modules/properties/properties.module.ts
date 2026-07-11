import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { FavoritesController } from './favorites.controller';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { SavedSearchesController } from './saved-searches.controller';

@Module({
  imports: [MediaModule],
  controllers: [PropertiesController, SavedSearchesController, FavoritesController],
  providers: [PropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
