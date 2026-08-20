import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { NextStepsService } from './next-steps.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly nextSteps: NextStepsService,
  ) {}

  /**
   * "What do I do next?" for the signed-in account (see NextStepsService).
   * Drives the dashboard checklist; no permission beyond being signed in,
   * since it only ever describes the caller's own account.
   */
  @Get('me/next-steps')
  myNextSteps(@CurrentUser() user: AuthUser) {
    return this.nextSteps.forUser(user.sub);
  }

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user.sub);
  }
}
