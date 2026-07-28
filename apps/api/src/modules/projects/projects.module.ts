import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { DealsModule } from '../deals/deals.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { MediaModule } from '../media/media.module';
import { ProjectsController, UnitsPublicController } from './projects.controllers';
import { ProjectUpdatesService } from './project-updates.service';
import { ProjectsService } from './projects.service';
import { UnitsService } from './units.service';

@Module({
  imports: [MediaModule, MarketplaceModule, DealsModule, ChatModule],
  controllers: [ProjectsController, UnitsPublicController],
  providers: [ProjectsService, UnitsService, ProjectUpdatesService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
