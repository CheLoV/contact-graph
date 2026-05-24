-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "currentPhase" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT,
    "type" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Chat" ("createdAt", "id", "isArchived", "memberCount", "source", "sourceId", "title", "type", "updatedAt") SELECT "createdAt", "id", "isArchived", "memberCount", "source", "sourceId", "title", "type", "updatedAt" FROM "Chat";
DROP TABLE "Chat";
ALTER TABLE "new_Chat" RENAME TO "Chat";
CREATE INDEX "Chat_type_idx" ON "Chat"("type");
CREATE INDEX "Chat_isArchived_idx" ON "Chat"("isArchived");
CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");
CREATE UNIQUE INDEX "Chat_source_sourceId_key" ON "Chat"("source", "sourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
