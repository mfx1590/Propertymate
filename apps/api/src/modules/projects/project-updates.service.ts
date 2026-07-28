import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectsService } from './projects.service';
import { PublishUpdateDto } from './dto/projects.dto';

/**
 * Construction progress feed (Plan §6.3). Buyers of units auto-follow: the
 * followers of a project are exactly the non-developer parties to a deal on one
 * of its units, so there is no separate subscribe step to get wrong.
 */
@Injectable()
export class ProjectUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly projects: ProjectsService,
  ) {}

  async publish(userId: string, projectId: string, dto: PublishUpdateDto, ip?: string) {
    const project = await this.projects.assertOwned(userId, projectId);

    const update = await this.prisma.projectUpdate.create({
      data: {
        projectId,
        titleI18n: { en: dto.title },
        bodyI18n: { en: dto.body },
        media: (dto.mediaUrls ?? []) as unknown as Prisma.InputJsonValue,
      },
    });

    const followers = await this.followers(projectId);
    for (const followerId of followers) {
      await this.notifications.notify(followerId, 'project.update_published', {
        projectId,
        updateId: update.id,
        projectName: (project.nameI18n as { en?: string })?.en ?? 'your project',
        title: dto.title,
      });
    }

    await this.audit.log({
      actorId: userId,
      action: 'project.update_published',
      entityType: 'project',
      entityId: projectId,
      after: { updateId: update.id, title: dto.title, notified: followers.length },
      ip,
    });
    return { ...update, notified: followers.length };
  }

  async list(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return this.prisma.projectUpdate.findMany({
      where: { projectId },
      orderBy: { publishedAt: 'desc' },
    });
  }

  /** Unit buyers (and their side of the deal), excluding the developer. */
  private async followers(projectId: string): Promise<string[]> {
    const parties = await this.prisma.dealParty.findMany({
      where: { deal: { projectUnit: { projectId } } },
      select: { userId: true, partyRole: true },
    });
    return [...new Set(parties.filter((p) => p.partyRole !== 'seller').map((p) => p.userId))];
  }
}
