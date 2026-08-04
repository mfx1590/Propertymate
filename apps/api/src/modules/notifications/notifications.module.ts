import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationDispatcher } from './dispatcher.service';
import { EmailProvider } from './channels/email.provider';
import { PushProvider } from './channels/push.provider';
import { WhatsAppProvider } from './channels/whatsapp.provider';

// global: verification, freshness, chat, deals and projects all send notifications
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationDispatcher,
    EmailProvider,
    PushProvider,
    WhatsAppProvider,
  ],
  // the dispatcher is exported for the BullMQ worker in the jobs module
  exports: [NotificationsService, NotificationDispatcher],
})
export class NotificationsModule {}
