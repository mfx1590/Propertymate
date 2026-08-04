-- Multi-channel notifications (Plan §6.6): push / email / WhatsApp alongside
-- the in-app channel that has been live since Phase 1.

-- delivery outcome per channel row
ALTER TABLE "notifications" ADD COLUMN "failed_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "error" TEXT;

-- per-user channel opt-in, sparse: no row = platform defaults
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channels" "NotificationChannel"[],

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "category")
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expo push tokens: a device, not a session
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'unknown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
