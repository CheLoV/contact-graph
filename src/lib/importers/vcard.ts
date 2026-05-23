import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ParsedVCard } from "@/lib/parsers/vcard";

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
        // Если упал батч — фиксируем, но продолжаем
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
    result.errors.push({
      uid: item.uid,
      reason: "missing displayName",
    });
    return;
  }

  const existing = await tx.contactIdentity.findUnique({
    where: { source_sourceId: { source: "vcard", sourceId: item.uid } },
  });

  const rawDataJson = JSON.stringify({ raw: item.rawData });

  if (existing) {
    await tx.contactIdentity.update({
      where: { id: existing.id },
      data: { displayName: item.displayName, rawData: rawDataJson },
    });

    if (item.phones.length > 0) {
      const existingPhones = await tx.phoneNumber.findMany({
        where: { contactId: existing.contactId },
        select: { number: true },
      });
      const have = new Set(existingPhones.map((p) => p.number));
      const toAdd = item.phones.filter((p) => !have.has(p.number));
      if (toAdd.length > 0) {
        await tx.phoneNumber.createMany({
          data: toAdd.map((p) => ({
            contactId: existing.contactId,
            number: p.number,
            label: p.label,
          })),
        });
      }
    }

    if (item.emails.length > 0) {
      const existingEmails = await tx.email.findMany({
        where: { contactId: existing.contactId },
        select: { address: true },
      });
      const have = new Set(existingEmails.map((e) => e.address));
      const toAdd = item.emails.filter((e) => !have.has(e.address));
      if (toAdd.length > 0) {
        await tx.email.createMany({
          data: toAdd.map((e) => ({
            contactId: existing.contactId,
            address: e.address,
            label: e.label,
          })),
        });
      }
    }
    result.updated += 1;
    return;
  }

  const contact = await tx.contact.create({
    data: { displayName: item.displayName, notes: item.note },
  });
  await tx.contactIdentity.create({
    data: {
      contactId: contact.id,
      source: "vcard",
      sourceId: item.uid,
      displayName: item.displayName,
      rawData: rawDataJson,
    },
  });
  if (item.phones.length > 0) {
    await tx.phoneNumber.createMany({
      data: item.phones.map((p, i) => ({
        contactId: contact.id,
        number: p.number,
        label: p.label,
        isPrimary: i === 0,
      })),
    });
  }
  if (item.emails.length > 0) {
    await tx.email.createMany({
      data: item.emails.map((e, i) => ({
        contactId: contact.id,
        address: e.address,
        label: e.label,
        isPrimary: i === 0,
      })),
    });
  }
  result.created += 1;
}
