// Phase 6 — JSON historical contacts.
//
// For phones found in contacts.list[] of result.json that DO NOT already
// have a `telegram` ContactIdentity (created by Phase 2 from
// contacts.GetContacts API), we save them as `telegram_addressbook`
// with confidence='self_reported' and sourceId=sha256(normalizedPhone).
//
// These represent "historical" contacts:
//   * deactivated Telegram accounts that left a phonebook entry behind
//   * phone-only entries for people never on Telegram
//
// If a re-run finds that a phone NOW has a `telegram` identity (e.g.
// the account was re-activated), the corresponding addressbook identity
// is marked superseded=true (kept for audit, not deleted).

import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { parseTelegramJsonAddressbook } from "@/lib/parsers/telegram-json";
import type { ProgressCallback } from "./telegram-api";

const noopProgress: ProgressCallback = async () => {};

export type TelegramHistoricalResult = {
  jsonEntriesTotal: number;
  jsonEntriesNormalized: number;
  jsonEntriesSkippedUnparseable: number;
  addressbookCreated: number;
  addressbookMergedToExistingContact: number;
  addressbookCreatedNewContact: number;
  addressbookSkippedHasTelegram: number;
  addressbookSupersededOnReimport: number;
  errors: Array<{ phase: string; reason: string }>;
};

export function emptyHistoricalResult(): TelegramHistoricalResult {
  return {
    jsonEntriesTotal: 0,
    jsonEntriesNormalized: 0,
    jsonEntriesSkippedUnparseable: 0,
    addressbookCreated: 0,
    addressbookMergedToExistingContact: 0,
    addressbookCreatedNewContact: 0,
    addressbookSkippedHasTelegram: 0,
    addressbookSupersededOnReimport: 0,
    errors: [],
  };
}

function sourceIdFor(normalizedPhone: string): string {
  return (
    "sha256:" +
    createHash("sha256").update(normalizedPhone).digest("hex").slice(0, 32)
  );
}

export async function importTelegramHistorical(
  jsonPath: string,
  result: TelegramHistoricalResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<void> {
  const entries = await parseTelegramJsonAddressbook(jsonPath);
  result.jsonEntriesTotal = entries.length;

  // Dedup by normalized phone (last entry wins on collision).
  const byPhone = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    if (!e.normalizedPhone) {
      result.jsonEntriesSkippedUnparseable += 1;
      continue;
    }
    byPhone.set(e.normalizedPhone, e);
    result.jsonEntriesNormalized += 1;
  }
  const total = byPhone.size;
  await onProgress("phase_6_historical", 0, total);

  let processed = 0;
  for (const [normalizedPhone, entry] of byPhone.entries()) {
    processed += 1;
    try {
      await processOne(normalizedPhone, entry, result);
    } catch (err) {
      result.errors.push({
        phase: "phase_6_historical",
        reason: `phone=${normalizedPhone}: ${(err as Error).message}`,
      });
    }
    if (processed % 100 === 0)
      await onProgress("phase_6_historical", processed, total);
  }
  await onProgress("phase_6_historical", total, total);
}

async function processOne(
  normalizedPhone: string,
  entry: {
    firstName: string;
    lastName: string;
    dateAdded: Date | null;
    rawData: string;
  },
  result: TelegramHistoricalResult,
): Promise<void> {
  const sourceId = sourceIdFor(normalizedPhone);

  // Is there a Contact whose PhoneNumber matches this normalized phone?
  const phoneRow = await db.phoneNumber.findFirst({
    where: { number: normalizedPhone },
    select: { contactId: true },
  });

  if (phoneRow) {
    // Does that Contact already have a `telegram` identity?
    const telegramIdentity = await db.contactIdentity.findFirst({
      where: { contactId: phoneRow.contactId, source: "telegram" },
      select: { id: true },
    });
    if (telegramIdentity) {
      result.addressbookSkippedHasTelegram += 1;
      // Mark any pre-existing addressbook identity for this contact as superseded.
      const existingAddrbook = await db.contactIdentity.findFirst({
        where: {
          contactId: phoneRow.contactId,
          source: "telegram_addressbook",
          superseded: false,
        },
        select: { id: true },
      });
      if (existingAddrbook) {
        await db.contactIdentity.update({
          where: { id: existingAddrbook.id },
          data: { superseded: true },
        });
        result.addressbookSupersededOnReimport += 1;
      }
      return;
    }

    // Phone is on a Contact, but no telegram identity → attach addressbook here.
    await upsertAddressbookIdentity(
      phoneRow.contactId,
      sourceId,
      entry,
      result,
    );
    result.addressbookMergedToExistingContact += 1;
    return;
  }

  // Brand new Contact: no PhoneNumber row for this phone.
  const displayName =
    [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim() ||
    `Без имени (TG addressbook)`;
  const contact = await db.contact.create({
    data: { displayName },
  });
  await db.phoneNumber.create({
    data: { contactId: contact.id, number: normalizedPhone, isPrimary: true },
  });
  await upsertAddressbookIdentity(contact.id, sourceId, entry, result);
  result.addressbookCreatedNewContact += 1;
}

async function upsertAddressbookIdentity(
  contactId: string,
  sourceId: string,
  entry: {
    firstName: string;
    lastName: string;
    dateAdded: Date | null;
    rawData: string;
  },
  result: TelegramHistoricalResult,
): Promise<void> {
  const displayName =
    [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim() || null;

  const existing = await db.contactIdentity.findUnique({
    where: { source_sourceId: { source: "telegram_addressbook", sourceId } },
    select: { id: true, contactId: true, superseded: true },
  });

  if (existing) {
    // Re-import: refresh rawData, keep contactId.
    await db.contactIdentity.update({
      where: { id: existing.id },
      data: {
        displayName,
        rawData: entry.rawData,
        // Clear superseded if it was set but we no longer have telegram identity here.
        // (We only land here when the calling path verified no telegram identity exists.)
        superseded: false,
      },
    });
    return;
  }

  await db.contactIdentity.create({
    data: {
      contactId,
      source: "telegram_addressbook",
      sourceId,
      displayName,
      confidence: "self_reported",
      rawData: entry.rawData,
    },
  });
  result.addressbookCreated += 1;
}
