-- Phase 4: Forward-compatible additions for store pickup, coupon caps, and product HSN codes.
-- CreateEnum
CREATE TYPE "FulfilmentMethod" AS ENUM ('DELIVERY', 'STORE_PICKUP');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'PICKED_UP';

-- AlterTable
ALTER TABLE "products" ADD COLUMN "hsn_code" TEXT;

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN "max_discount_paise" INTEGER;

-- CreateTable
CREATE TABLE "pickup_locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hours" TEXT NOT NULL,
    "prep_time_minutes" INTEGER NOT NULL DEFAULT 120,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pickup_locations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders"
ADD COLUMN "fulfilment_method" "FulfilmentMethod" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN "pickup_location_id" TEXT,
ADD COLUMN "pickup_code_hash" TEXT,
ADD COLUMN "pickup_ready_at" TIMESTAMPTZ(3),
ADD COLUMN "picked_up_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "pickup_locations_is_active_is_sample_idx" ON "pickup_locations"("is_active", "is_sample");

-- CreateIndex
CREATE INDEX "orders_pickup_location_id_idx" ON "orders"("pickup_location_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_location_id_fkey" FOREIGN KEY ("pickup_location_id") REFERENCES "pickup_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints
ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_prep_time_positive" CHECK ("prep_time_minutes" > 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_max_discount_positive" CHECK ("max_discount_paise" IS NULL OR "max_discount_paise" > 0);
