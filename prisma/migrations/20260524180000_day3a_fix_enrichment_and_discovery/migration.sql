-- Day 3-A fix: enrichment idempotency marker + discovery source + personal channels.

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN "linkedToContactId" TEXT;

-- AlterTable
ALTER TABLE "ContactIdentity" ADD COLUMN "discoverySource" TEXT;
ALTER TABLE "ContactIdentity" ADD COLUMN "enrichedAt" DATETIME;
ALTER TABLE "ContactIdentity" ADD COLUMN "personalChannelChatId" TEXT;

-- CreateIndex
CREATE INDEX "ContactIdentity_enrichedAt_idx" ON "ContactIdentity"("enrichedAt");

-- CreateIndex
CREATE INDEX "ContactIdentity_discoverySource_idx" ON "ContactIdentity"("discoverySource");

-- Backfill discoverySource for identities created before this column existed.
-- enrichedAt stays NULL → Phase 3 will re-process them all.
UPDATE "ContactIdentity"
   SET "discoverySource" = 'self'
 WHERE "source" = 'telegram_self';

UPDATE "ContactIdentity"
   SET "discoverySource" = 'contacts_api'
 WHERE "source" = 'telegram'
   AND "confidence" = 'imported'
   AND "discoverySource" IS NULL;

UPDATE "ContactIdentity"
   SET "discoverySource" = 'self_reported'
 WHERE "source" = 'telegram'
   AND "confidence" = 'self_reported'
   AND "discoverySource" IS NULL;

UPDATE "ContactIdentity"
   SET "discoverySource" = 'json_addressbook'
 WHERE "source" = 'telegram_addressbook';
