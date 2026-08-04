/** Kept separate so the @Processor decorator can import it without a module cycle. */
export const MAINTENANCE_QUEUE = 'maintenance';

/** Outbound channel deliveries — email/push/WhatsApp (Plan §6.6). */
export const NOTIFICATIONS_QUEUE = 'notifications';
