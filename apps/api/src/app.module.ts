import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { PinoLoggerModule } from './common/logging/logger.module';
import { AuditModule } from './common/audit/audit.module';
import { StorageModule } from './common/storage/storage.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { HealthModule } from './modules/health/health.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SearchModule } from './modules/search/search.module';
import { PoisModule } from './modules/pois/pois.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { VerificationModule } from './modules/verification/verification.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { ChatModule } from './modules/chat/chat.module';
import { DealsModule } from './modules/deals/deals.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { LegalModule } from './modules/legal/legal.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InsightsModule } from './modules/insights/insights.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PinoLoggerModule,
    EventEmitterModule.forRoot(),
    // global default rate limit; auth endpoints tighten further (Plan §2.4)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RolesModule,
    HealthModule,
    PropertiesModule,
    ProjectsModule,
    OrganizationsModule,
    DocumentsModule,
    SearchModule,
    PoisModule,
    AdminModule,
    NotificationsModule,
    VerificationModule,
    MarketplaceModule,
    DealsModule,
    ChatModule,
    AnalyticsModule,
    LeadsModule,
    ContractsModule,
    ReferralsModule,
    DisputesModule,
    ModerationModule,
    LegalModule,
    PaymentsModule,
    InsightsModule,
    JobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
