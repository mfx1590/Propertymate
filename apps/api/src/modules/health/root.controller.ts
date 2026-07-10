import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

@Controller()
export class RootController {
  @Public()
  @Get()
  index() {
    return {
      name: 'propverify-api',
      status: 'ok',
      docs: 'REST API — see /health, /auth/*, /users/me',
    };
  }
}
