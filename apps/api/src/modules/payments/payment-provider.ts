/**
 * The seam a real payment provider plugs into (Plan §9, Phase 3).
 *
 * There is exactly one implementation today and it makes no network call. That
 * is the point: the shape is fixed against a provider that cannot fail, so the
 * first provider that *can* fail is a second implementation rather than a
 * rewrite of the ledger.
 *
 * What is deliberately NOT here yet: idempotency keys, retries and webhook
 * reconciliation. Every one of those exists to make a remote call safe, and a
 * column or a queue that guards nothing would be dead weight — they arrive
 * with the provider that needs them, and `PaymentsService` says so at the
 * point they would be used.
 */
export interface CollectionRequest {
  userId: string;
  planKey: string;
  /** The plan's price at this moment; 0 when the plan has no price set. */
  listAmount: number;
  currency: string;
  /** What the admin says was actually collected. */
  amount: number;
  reference?: string;
  note?: string;
  occurredAt: Date;
}

export interface CollectionResult {
  provider: string;
  /** The provider's reference for this movement, where it has one. */
  providerRef: string | null;
  /** Whether money actually moved, or the charge was deliberately waived. */
  collected: boolean;
}

export interface PaymentProvider {
  readonly key: string;
  collect(req: CollectionRequest): Promise<CollectionResult>;
}

/**
 * Records what happened offline. It does not take payment — an admin does that
 * by bank transfer or in person and then tells the platform, which is exactly
 * how subscriptions have worked since the 2026-07-12 decision. The difference
 * is that it is now written down as money rather than only as an admin action.
 */
export const manualProvider: PaymentProvider = {
  key: 'manual',
  async collect(req: CollectionRequest): Promise<CollectionResult> {
    return {
      provider: 'manual',
      providerRef: req.reference?.trim() || null,
      collected: req.amount > 0,
    };
  },
};

export const PROVIDERS: Record<string, PaymentProvider> = {
  [manualProvider.key]: manualProvider,
};
