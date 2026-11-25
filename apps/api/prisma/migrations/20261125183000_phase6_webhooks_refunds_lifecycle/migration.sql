-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "refunded_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failed_payment_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkout_token_hash" TEXT;

-- CreateTable
CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "order_id" TEXT,
  "status" TEXT NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "error_message" TEXT,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "gateway_refund_id" TEXT,
  "idempotency_key" TEXT,
  "amount_paise" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "initiated_by" TEXT NOT NULL,
  "raw_payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");
CREATE INDEX "webhook_events_order_id_created_at_idx" ON "webhook_events"("order_id", "created_at");
CREATE INDEX "webhook_events_event_type_created_at_idx" ON "webhook_events"("event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gateway_refund_id_key" ON "refunds"("gateway_refund_id");
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE INDEX "refunds_order_id_created_at_idx" ON "refunds"("order_id", "created_at");
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- AddForeignKey
ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check constraints
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_refunded_paise_bounds" CHECK ("refunded_paise" >= 0 AND "refunded_paise" <= "total_paise");
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_failed_attempts_nonneg" CHECK ("failed_payment_attempts" >= 0);
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_pos" CHECK ("amount_paise" > 0);
