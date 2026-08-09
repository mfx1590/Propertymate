import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { RolesService } from '../roles/roles.service';

/**
 * Documents are NEVER public. A short-lived signed URL is issued only to the
 * document owner or a user holding verification.review (Plan §2.4).
 */
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly roles: RolesService,
  ) {}

  @Get(':id/url')
  async getSignedUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found');

    if (doc.ownerUserId !== user.sub) {
      // A deal-room document belongs to the deal, not just to whoever uploaded
      // it: a generated contract is owned by the party who pressed generate, and
      // the counterparty plainly has to be able to read what they are signing.
      const isParty =
        doc.entityType === 'deal' &&
        (await this.prisma.dealParty.count({
          where: { dealId: doc.entityId, userId: user.sub },
        })) > 0;

      if (!isParty) {
        const perms = await this.roles.getPermissionsForUser(user.sub);
        if (!perms.has('verification.review')) {
          throw new ForbiddenException('Not allowed to access this document');
        }
      }
    }

    const url = await this.storage.signedDocumentUrl(doc.storageKey, 300);
    return { url, expiresInSeconds: 300 };
  }
}
