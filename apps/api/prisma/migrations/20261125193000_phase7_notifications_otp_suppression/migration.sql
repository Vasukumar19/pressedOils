-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "pickup_last_collection_at" TIMESTAMPTZ(3),
  ADD COLUMN "pickup_code_reissue_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pickup_code_last_sent_at" TIMESTAMPTZ(3),
  ADD COLUMN "phone_verified_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "order_id" TEXT,
  "channel" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "template_version" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "masked_recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "payload_summary" JSONB,
  "sent_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
  "email_hash" TEXT NOT NULL,
  "masked_email" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "source_provider" TEXT NOT NULL,
  "source_event_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email_hash")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "phone_hash" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "code_hmac" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verification_tokens" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "phone_hash" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "phone_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");
CREATE INDEX "notifications_order_id_created_at_idx" ON "notifications"("order_id", "created_at");
CREATE INDEX "notifications_provider_message_id_idx" ON "notifications"("provider_message_id");
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

CREATE INDEX "otp_challenges_phone_hash_purpose_created_at_idx" ON "otp_challenges"("phone_hash", "purpose", "created_at");
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

CREATE UNIQUE INDEX "phone_verification_tokens_token_hash_key" ON "phone_verification_tokens"("token_hash");
CREATE INDEX "phone_verification_tokens_phone_hash_purpose_idx" ON "phone_verification_tokens"("phone_hash", "purpose");
CREATE INDEX "phone_verification_tokens_expires_at_idx" ON "phone_verification_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check constraints
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_pickup_reissue_nonneg" CHECK ("pickup_code_reissue_count" >= 0);
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_attempts_bounds" CHECK ("attempts" >= 0 AND "max_attempts" > 0);
