import type { NotificationChannel } from '@propverify/shared';

/** Everything a provider needs to deliver one notification to one user. */
export interface DeliveryContext {
  userId: string;
  templateKey: string;
  payload: Record<string, unknown>;
  /** rendered in the recipient's locale */
  title: string;
  body: string;
  locale: string;
  recipient: { email: string | null; phone: string | null };
  /** approved Meta template name + ordered body params, when the key declares them */
  whatsapp?: { template: string; params: string[] };
}

export type DeliveryResult =
  /** delivered by a real provider */
  | { status: 'sent'; reference?: string }
  /** nothing to do — no address, no device token, or no credentials in this env */
  | { status: 'skipped'; reason: string }
  /** provider rejected it; the queue decides whether to retry */
  | { status: 'failed'; error: string; retryable: boolean };

export interface ChannelProvider {
  readonly channel: NotificationChannel;
  send(ctx: DeliveryContext): Promise<DeliveryResult>;
}

export const CHANNEL_PROVIDERS = Symbol('CHANNEL_PROVIDERS');
