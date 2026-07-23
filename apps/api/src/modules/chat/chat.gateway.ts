import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Realtime chat over Socket.io. Auth: the client passes its access token in
 * the handshake; we verify it and drop unauthenticated sockets. Each user
 * joins a private `user:<id>` room; they may join `conversation:<id>` rooms
 * only after a participant check. Broadcasts are driven by decoupled domain
 * events (chat.message / chat.notify) so ChatService never imports the gateway.
 */
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'], credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token ?? client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('no token');
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  /** Client asks to receive live messages for a conversation it belongs to. */
  @SubscribeMessage('conversation.join')
  async joinConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: string) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !conversationId) return { ok: false };
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId },
      select: { conversationId: true },
    });
    if (!participant) return { ok: false };
    client.join(`conversation:${conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation.leave')
  leaveConversation(@ConnectedSocket() client: Socket, @MessageBody() conversationId: string) {
    if (conversationId) client.leave(`conversation:${conversationId}`);
    return { ok: true };
  }

  // ── domain-event fan-out (emitted by ChatService) ────────────────

  @OnEvent('chat.message')
  broadcastMessage(payload: { conversationId: string; message: unknown }) {
    this.server.to(`conversation:${payload.conversationId}`).emit('message', payload.message);
  }

  @OnEvent('chat.notify')
  broadcastNotify(payload: { userId: string; event: string; data?: unknown }) {
    this.server.to(`user:${payload.userId}`).emit('notify', { event: payload.event, data: payload.data });
  }
}
