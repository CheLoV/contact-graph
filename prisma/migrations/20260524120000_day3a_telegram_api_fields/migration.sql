-- CreateTable
CREATE TABLE "CommonChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    CONSTRAINT "CommonChat_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommonChat_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "description" TEXT,
    "inviteLink" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "photoFileId" TEXT,
    "megagroup" BOOLEAN NOT NULL DEFAULT false,
    "creationDate" DATETIME,
    "usernames" TEXT,
    "slowmodeSeconds" INTEGER,
    "migratedFromChatId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Chat" ("createdAt", "id", "isArchived", "lastMessageAt", "memberCount", "messageCount", "source", "sourceId", "title", "type", "updatedAt") SELECT "createdAt", "id", "isArchived", "lastMessageAt", "memberCount", "messageCount", "source", "sourceId", "title", "type", "updatedAt" FROM "Chat";
DROP TABLE "Chat";
ALTER TABLE "new_Chat" RENAME TO "Chat";
CREATE INDEX "Chat_type_idx" ON "Chat"("type");
CREATE INDEX "Chat_isArchived_idx" ON "Chat"("isArchived");
CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");
CREATE INDEX "Chat_source_idx" ON "Chat"("source");
CREATE INDEX "Chat_memberCount_idx" ON "Chat"("memberCount");
CREATE UNIQUE INDEX "Chat_source_sourceId_key" ON "Chat"("source", "sourceId");
CREATE TABLE "new_ContactIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'imported',
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "rawData" TEXT,
    "bio" TEXT,
    "photoFileId" TEXT,
    "businessHours" TEXT,
    "businessLocation" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "isScam" BOOLEAN NOT NULL DEFAULT false,
    "isFake" BOOLEAN NOT NULL DEFAULT false,
    "commonChatsCount" INTEGER,
    "lastSeenStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContactIdentity" ("confidence", "contactId", "createdAt", "displayName", "handle", "id", "rawData", "source", "sourceId", "updatedAt") SELECT "confidence", "contactId", "createdAt", "displayName", "handle", "id", "rawData", "source", "sourceId", "updatedAt" FROM "ContactIdentity";
DROP TABLE "ContactIdentity";
ALTER TABLE "new_ContactIdentity" RENAME TO "ContactIdentity";
CREATE INDEX "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");
CREATE INDEX "ContactIdentity_handle_idx" ON "ContactIdentity"("handle");
CREATE INDEX "ContactIdentity_confidence_idx" ON "ContactIdentity"("confidence");
CREATE INDEX "ContactIdentity_superseded_idx" ON "ContactIdentity"("superseded");
CREATE INDEX "ContactIdentity_isBot_idx" ON "ContactIdentity"("isBot");
CREATE INDEX "ContactIdentity_isPremium_idx" ON "ContactIdentity"("isPremium");
CREATE UNIQUE INDEX "ContactIdentity_source_sourceId_key" ON "ContactIdentity"("source", "sourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CommonChat_contactId_idx" ON "CommonChat"("contactId");

-- CreateIndex
CREATE INDEX "CommonChat_chatId_idx" ON "CommonChat"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "CommonChat_contactId_chatId_key" ON "CommonChat"("contactId", "chatId");

