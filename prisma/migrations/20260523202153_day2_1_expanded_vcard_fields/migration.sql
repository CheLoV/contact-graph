-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "birthday" DATETIME;
ALTER TABLE "Contact" ADD COLUMN "organization" TEXT;
ALTER TABLE "Contact" ADD COLUMN "title" TEXT;

-- CreateTable
CREATE TABLE "ContactUrl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'website',
    CONSTRAINT "ContactUrl_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContactIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'imported',
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContactIdentity" ("contactId", "createdAt", "displayName", "handle", "id", "rawData", "source", "sourceId", "updatedAt") SELECT "contactId", "createdAt", "displayName", "handle", "id", "rawData", "source", "sourceId", "updatedAt" FROM "ContactIdentity";
DROP TABLE "ContactIdentity";
ALTER TABLE "new_ContactIdentity" RENAME TO "ContactIdentity";
CREATE INDEX "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");
CREATE INDEX "ContactIdentity_handle_idx" ON "ContactIdentity"("handle");
CREATE INDEX "ContactIdentity_confidence_idx" ON "ContactIdentity"("confidence");
CREATE UNIQUE INDEX "ContactIdentity_source_sourceId_key" ON "ContactIdentity"("source", "sourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ContactUrl_contactId_idx" ON "ContactUrl"("contactId");
