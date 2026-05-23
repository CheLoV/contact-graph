-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "nickname" TEXT;

-- CreateTable
CREATE TABLE "ContactAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "street" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "formatted" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "label" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactAddress_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactAttribute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactAttribute_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContactAddress_contactId_idx" ON "ContactAddress"("contactId");

-- CreateIndex
CREATE INDEX "ContactAddress_city_idx" ON "ContactAddress"("city");

-- CreateIndex
CREATE INDEX "ContactAddress_country_idx" ON "ContactAddress"("country");

-- CreateIndex
CREATE INDEX "ContactAttribute_contactId_idx" ON "ContactAttribute"("contactId");

-- CreateIndex
CREATE INDEX "ContactAttribute_key_idx" ON "ContactAttribute"("key");
