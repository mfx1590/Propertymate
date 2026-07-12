import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ScrubService } from './scrub.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly scrubber: ScrubService,
  ) {}

  /** Customer opens (or reuses) the inquiry thread on a listing. */
  async inquire(customerId: string, propertyId: string, firstMessage: string, ip?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, status: true, createdByUserId: true, publishedByAgentId: true, titleI18n: true },
    });
    if (!property || !['live', 'under_offer'].includes(property.status)) {
      throw new NotFoundException('Listing not available');
    }
    // mediated listings route inquiries to the publishing agent, never the owner (§13.4)
    const listerId = property.publishedByAgentId ?? property.createdByUserId;
    if (listerId === customerId) throw new BadRequestException('You manage this listing');

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        propertyId,
        participants: { some: { userId: customerId } },
        AND: { participants: { some: { userId: listerId } } },
      },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          propertyId,
          participants: {
            create: [
              { userId: customerId, roleInConvo: 'customer' },
              { userId: listerId, roleInConvo: 'lister' },
            ],
          },
        },
      });
      await this.notifications.notify(listerId, 'chat.new_inquiry', {
        conversationId: conversation.id,
        title: (property.titleI18n as { en?: string })?.en ?? 'your listing',
      });
    }
    await this.sendMessage(customerId, conversation.id, firstMessage, ip);
    return conversation;
  }

  /** Owner ↔ assigned agent channel — ALWAYS scrubbed (anonymity contract, §13.4). */
  async assignmentConversation(userId: string, assignmentId: string) {
    const a = await this.prisma.agentAssignment.findUnique({ where: { id: assignmentId } });
    if (!a || (a.ownerUserId !== userId && a.agentUserId !== userId)) {
      throw new NotFoundException('Assignment not found');
    }
    if (a.status !== 'accepted') throw new BadRequestException('Assignment is not active');

    let conversation = await this.prisma.conversation.findFirst({
      where: {
        propertyId: a.propertyId,
        participants: { some: { userId: a.ownerUserId, roleInConvo: 'owner_anonymous' } },
      },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          propertyId: a.propertyId,
          participants: {
            create: [
              { userId: a.ownerUserId, roleInConvo: 'owner_anonymous' },
              { userId: a.agentUserId, roleInConvo: 'agent' },
            ],
          },
        },
      });
    }
    return conversation;
  }

  async myConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        property: { select: { id: true, titleI18n: true, status: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
        participants: { select: { userId: true, roleInConvo: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return conversations.map((c) => ({
      id: c.id,
      property: c.property,
      myRole: c.participants.find((p) => p.userId === userId)?.roleInConvo,
      anonymous: c.participants.some((p) => p.roleInConvo === 'owner_anonymous'),
      lastMessage: c.messages[0] ?? null,
    }));
  }

  async messages(userId: string, conversationId: string) {
    await this.assertParticipant(userId, conversationId);
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    // mark incoming as read
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return msgs;
  }

  async sendMessage(userId: string, conversationId: string, body: string, ip?: string) {
    if (!body?.trim()) throw new BadRequestException('Message is empty');
    const convo = await this.assertParticipant(userId, conversationId);

    const shouldScrub = await this.mustScrub(convo);
    let text = body.trim().slice(0, 4000);
    let scrubbed = false;
    if (shouldScrub) {
      const result = this.scrubber.scrub(text);
      text = result.body;
      scrubbed = result.scrubbed;
      if (result.scrubbed) {
        await this.audit.log({
          actorId: userId,
          action: 'chat.contact_bypass_attempt',
          entityType: 'conversation',
          entityId: conversationId,
          after: { hits: result.hits },
          ip,
        });
      }
    }

    const message = await this.prisma.message.create({
      data: { conversationId, senderId: userId, body: text, bodyScrubbed: scrubbed },
    });
    const other = convo.participants.find((p) => p.userId !== userId);
    if (other) {
      await this.notifications.notify(other.userId, 'chat.new_message', { conversationId });
    }
    return message;
  }

  /**
   * Scrub until a confirmed viewing OR accepted offer exists between the pair
   * on this property (§2.4). owner_anonymous channels are ALWAYS scrubbed (§13.4).
   */
  private async mustScrub(convo: {
    propertyId: string | null;
    participants: { userId: string; roleInConvo: string }[];
  }): Promise<boolean> {
    if (convo.participants.some((p) => p.roleInConvo === 'owner_anonymous')) return true;
    if (!convo.propertyId) return true;
    const userIds = convo.participants.map((p) => p.userId);

    const [viewing, offer] = await Promise.all([
      this.prisma.viewing.count({
        where: {
          propertyId: convo.propertyId,
          status: { in: ['confirmed', 'completed'] },
          customerId: { in: userIds },
          hostUserId: { in: userIds },
        },
      }),
      this.prisma.offer.count({
        where: { propertyId: convo.propertyId, status: 'accepted', customerId: { in: userIds } },
      }),
    ]);
    return viewing === 0 && offer === 0;
  }

  private async assertParticipant(userId: string, conversationId: string) {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { select: { userId: true, roleInConvo: true } } },
    });
    if (!convo || !convo.participants.some((p) => p.userId === userId)) {
      throw new ForbiddenException('Not a participant of this conversation');
    }
    return convo;
  }
}
