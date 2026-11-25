-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "cod_fee_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pickup_code_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pickup_code_locked_until" TIMESTAMPTZ(3),
  ADD COLUMN "dpdp_consent_at" TIMESTAMPTZ(3),
  ADD COLUMN "dpdp_policy_version" TEXT,
  ADD COLUMN "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "needs_attention" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "order_items"
  ADD COLUMN "discount_paise" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "checkout_idempotency_keys" (
  "key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "order_id" TEXT,
  "status_code" INTEGER NOT NULL,
  "response_json" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "checkout_idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "orders_needs_attention_created_at_idx" ON "orders"("needs_attention", "created_at");

-- CreateIndex
CREATE INDEX "orders_payment_method_order_status_created_at_idx" ON "orders"("payment_method", "order_status", "created_at");

-- CreateIndex
CREATE INDEX "checkout_idempotency_keys_expires_at_idx" ON "checkout_idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "checkout_idempotency_keys"
  ADD CONSTRAINT "checkout_idempotency_keys_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money & security integrity constraints
ALTER TABLE "orders" ADD CONSTRAINT "orders_cod_fee_nonneg" CHECK ("cod_fee_paise" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_nonneg" CHECK ("discount_paise" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_nonneg" CHECK ("shipping_paise" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_tax_nonneg" CHECK ("tax_paise" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_nonneg" CHECK ("discount_paise" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_pos" CHECK ("amount_paise" > 0);
