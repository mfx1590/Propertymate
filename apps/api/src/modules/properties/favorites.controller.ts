import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PropertiesService } from './properties.service';

@Controller('users/me/favorites')
export class FavoritesController {
  constructor(private readonly properties: PropertiesService) {}

  @RequirePermissions('favorite.manage')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.properties.listFavorites(user.sub);
  }
}
