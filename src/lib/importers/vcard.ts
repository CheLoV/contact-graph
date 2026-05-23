import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ParsedSocialProfile, ParsedVCard } from "@/lib/parsers/vcard";

export type ImportError = {
  uid?: string;
  displayName?: string;
  reason: string;
};

export type ImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
};

const BATCH_SIZE = 100;
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000;
const TX_TIMEOUT_MS = 30_000;

/**
 * Помечает зависшие импорт-джобы (running > 5 минут) как failed.
 * Вызывается перед стартом нового импорта — защита от крашей процесса.
 */
export async function reapOrphanedJobs(source = "vcard"): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  const { count } = await db.importJob.updateMany({
    where: { source, status: "running", startedAt: { lt: cutoff } },
    data: {
      status: "failed",
      finishedAt: new Date(),
      errors: JSON.stringify([
        { reason: "timed out or process restarted" },
      ]),
    },
  });
  return count;
}

export async function createImportJob(
  source: string,
  total: number,
): Promise<string> {
  const job = await db.importJob.create({
    data: { source, status: "running", total, processed: 0 },
  });
  return job.id;
}

export async function importVCards(
  parsed: ParsedVCard[],
  jobId: string,
): Promise<ImportResult> {
  const result: ImportResult = {
    total: parsed.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    for (let start = 0; start < parsed.length; start += BATCH_SIZE) {
      const batch = parsed.slice(start, start + BATCH_SIZE);
      try {
        await db.$transaction(
          async (tx) => {
            for (const item of batch) {
              await upsertOne(tx, item, result);
            }
          },
          { timeout: TX_TIMEOUT_MS },
        );
      } catch (err) {
        result.errors.push({
          reason: `batch ${start}-${start + batch.length} failed: ${
            (err as Error).message
          }`,
        });
      }
      await db.importJob.update({
        where: { id: jobId },
        data: { processed: Math.min(start + batch.length, parsed.length) },
      });
    }

    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        processed: parsed.length,
        finishedAt: new Date(),
        errors: result.errors.length
          ? JSON.stringify(result.errors)
          : null,
      },
    });
  } catch (err) {
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errors: JSON.stringify([
          ...result.errors,
          { reason: `import crashed: ${(err as Error).message}` },
        ]),
      },
    });
    throw err;
  }

  return result;
}

async function upsertOne(
  tx: Prisma.TransactionClient,
  item: ParsedVCard,
  result: ImportResult,
): Promise<void> {
  if (!item.displayName) {
    result.skipped += 1;
    result.errors.push({ uid: item.uid, reason: "missing displayName" });
    return;
  }

  const existing = await tx.contactIdentity.findUnique({
    where: { source_sourceId: { source: "vcard", sourceId: item.uid } },
  });

  const rawDataJson = JSON.stringify({ raw: item.rawData });
  const contactFields: Prisma.ContactUpdateInput = {
    displayName: item.displayName,
    notes: item.note ?? null,
    organization: item.org ?? null,
    title: item.title ?? null,
    birthday: item.birthday ? new Date(`${item.birthday}T00:00:00Z`) : null,
  };

  let contactId: string;

  if (existing) {
    contactId = existing.contactId;
    await tx.contact.update({
      where: { id: contactId },
      data: contactFields,
    });
    await tx.contactIdentity.update({
      where: { id: existing.id },
      data: {
        displayName: item.displayName,
        rawData: rawDataJson,
        confidence: "imported",
      },
    });
    await syncPhones(tx, contactId, item.phones);
    await syncEmails(tx, contactId, item.emails);
    await syncUrls(tx, contactId, item.urls);
    await syncSocialIdentities(tx, contactId, item, result);
    result.updated += 1;
    return;
  }

  const contact = await tx.contact.create({
    data: {
      displayName: item.displayName,
      notes: item.note ?? null,
      organization: item.org ?? null,
      title: item.title ?? null,
      birthday: item.birthday ? new Date(`${item.birthday}T00:00:00Z`) : null,
    },
  });
  contactId = contact.id;
  await tx.contactIdentity.create({
    data: {
      contactId,
      source: "vcard",
      sourceId: item.uid,
      displayName: item.displayName,
      confidence: "imported",
      rawData: rawDataJson,
    },
  });
  if (item.phones.length > 0) {
    await tx.phoneNumber.createMany({
      data: item.phones.map((p, i) => ({
        contactId,
        number: p.number,
        label: p.label,
        isPrimary: i === 0,
      })),
    });
  }
  if (item.emails.length > 0) {
    await tx.email.createMany({
      data: item.emails.map((e, i) => ({
        contactId,
        address: e.address,
        label: e.label,
        isPrimary: i === 0,
      })),
    });
  }
  if (item.urls.length > 0) {
    await tx.contactUrl.createMany({
      data: item.urls.map((u) => ({
        contactId,
        url: u.url,
        label: u.label,
        kind: "website",
      })),
    });
  }
  await syncSocialIdentities(tx, contactId, item, result);
  result.created += 1;
}

async function syncPhones(
  tx: Prisma.TransactionClient,
  contactId: string,
  phones: ParsedVCard["phones"],
): Promise<void> {
  if (phones.length === 0) return;
  const existing = await tx.phoneNumber.findMany({
    where: { contactId },
    select: { number: true },
  });
  const have = new Set(existing.map((p) => p.number));
  const toAdd = phones.filter((p) => !have.has(p.number));
  if (toAdd.length > 0) {
    await tx.phoneNumber.createMany({
      data: toAdd.map((p) => ({
        contactId,
        number: p.number,
        label: p.label,
      })),
    });
  }
}

async function syncEmails(
  tx: Prisma.TransactionClient,
  contactId: string,
  emails: ParsedVCard["emails"],
): Promise<void> {
  if (emails.length === 0) return;
  const existing = await tx.email.findMany({
    where: { contactId },
    select: { address: true },
  });
  const have = new Set(existing.map((e) => e.address.toLowerCase()));
  const toAdd = emails.filter((e) => !have.has(e.address.toLowerCase()));
  if (toAdd.length > 0) {
    await tx.email.createMany({
      data: toAdd.map((e) => ({
        contactId,
        address: e.address,
        label: e.label,
      })),
    });
  }
}

async function syncUrls(
  tx: Prisma.TransactionClient,
  contactId: string,
  urls: ParsedVCard["urls"],
): Promise<void> {
  if (urls.length === 0) return;
  const existing = await tx.contactUrl.findMany({
    where: { contactId },
    select: { url: true },
  });
  const have = new Set(existing.map((u) => u.url));
  const toAdd = urls.filter((u) => !have.has(u.url));
  if (toAdd.length > 0) {
    await tx.contactUrl.createMany({
      data: toAdd.map((u) => ({
        contactId,
        url: u.url,
        label: u.label,
        kind: "website",
      })),
    });
  }
}

async function syncSocialIdentities(
  tx: Prisma.TransactionClient,
  contactId: string,
  item: ParsedVCard,
  result: ImportResult,
): Promise<void> {
  for (const sp of item.socialProfiles) {
    await upsertSocialIdentity(tx, contactId, sp, item, result);
  }
}

async function upsertSocialIdentity(
  tx: Prisma.TransactionClient,
  contactId: string,
  sp: ParsedSocialProfile,
  item: ParsedVCard,
  result: ImportResult,
): Promise<void> {
  const rawData = JSON.stringify({
    url: sp.url ?? null,
    originalLabel: sp.handle ?? null,
  });
  const existing = await tx.contactIdentity.findUnique({
    where: { source_sourceId: { source: sp.service, sourceId: sp.sourceId } },
  });
  if (existing) {
    if (existing.contactId !== contactId) {
      // Этот социал-профиль уже привязан к ДРУГОМУ Contact —
      // потенциальный сигнал, что два Contact'а на самом деле один человек.
      // Сейчас не сливаем (это День 9), просто фиксируем как warning.
      result.errors.push({
        uid: item.uid,
        displayName: item.displayName,
        reason: `social identity ${sp.service}:${sp.sourceId} already linked to another contact (${existing.contactId})`,
      });
      return;
    }
    // Это re-import — обновляем, но не понижаем confidence imported → self_reported.
    await tx.contactIdentity.update({
      where: { id: existing.id },
      data: {
        handle: sp.handle ?? existing.handle,
        rawData:
          existing.confidence === "imported" ? existing.rawData : rawData,
      },
    });
    return;
  }
  await tx.contactIdentity.create({
    data: {
      contactId,
      source: sp.service,
      sourceId: sp.sourceId,
      handle: sp.handle,
      confidence: "self_reported",
      rawData,
    },
  });
}
