-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN     "isPaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscriptionPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "amountPaid" DOUBLE PRECISION,
ADD COLUMN     "paymentId" TEXT;

-- CreateIndex
CREATE INDEX "Channel_isPaid_idx" ON "Channel"("isPaid");

-- CreateIndex
CREATE INDEX "Payment_channelId_idx" ON "Payment"("channelId");

-- CreateIndex
CREATE INDEX "Subscription_paymentId_idx" ON "Subscription"("paymentId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
