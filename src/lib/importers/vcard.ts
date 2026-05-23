import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  ParsedSocialProfile,
  ParsedVCard,
} from "@/lib/parsers/vcard";

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
  // Сводка по vCard-свойствам, которые парсер не знает — на сигнал «расширить поддержку».
  unknownProperties: {
    blocksAffected: number;
    counts: Record<string, number>;
  };
};

const BATCH_SIZE = 100;
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000;
const TX_TIMEOUT_MS = 30_000;

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
    unknownProperties: { blocksAffected: 0, counts: {} },
  };

  // Агрегируем unknownProperties на уровне всего импорта.
  for (const item of parsed) {
    if (item.unknownProperties.length > 0) {
      result.unknownProperties.blocksAffected += 1;
      for (const u of item.unknownProperties) {
        result.unknownProperties.counts[u.property] =
          (result.unknownProperties.counts[u.property] ?? 0) + 1;
      }
    }
  }

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
  // Полный набор полей — используется при CREATE. Пустые поля → null (ok, контакт новый).
  const contactCreateData = {
    displayName: item.displayName,
    nickname: item.nickname ?? null,
    notes: item.note ?? null,
    organization: item.org ?? null,
    title: item.title ?? null,
    birthday: item.birthday ? new Date(`${item.birthday}T00:00:00Z`) : null,
  };
  // На UPDATE-пути защищаемся от перетирания ненулевых полей пустыми.
  // У нас файл с хэш-фолбэк UID'ами — повторное «обнаружение» того же контакта через
  // коллизию хэша не должно стирать данные, заполненные первым прохождением.
  const contactUpdateData: Record<string, unknown> = {
    displayName: item.displayName,
  };
  if (item.nickname) contactUpdateData.nickname = item.nickname;
  if (item.note) contactUpdateData.notes = item.note;
  if (item.org) contactUpdateData.organization = item.org;
  if (item.title) contactUpdateData.title = item.title;
  if (item.birthday) {
    contactUpdateData.birthday = new Date(`${item.birthday}T00:00:00Z`);
  }

  let contactId: string;

  if (existing) {
    contactId = existing.contactId;
    await tx.contact.update({
      where: { id: contactId },
      data: contactUpdateData,
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
    await syncAddresses(tx, contactId, item.addresses);
    await syncAttributes(tx, contactId, item.attributes);
    await syncCategories(tx, contactId, item.categories);
    await syncSocialIdentities(tx, contactId, item, result);
    result.updated += 1;
    return;
  }

  const contact = await tx.contact.create({ data: contactCreateData });
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
  if (item.addresses.length > 0) {
    await tx.contactAddress.createMany({
      data: item.addresses.map((a) => ({
        contactId,
        street: a.street,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        formatted: a.formatted,
        kind: a.kind,
        label: a.label,
        latitude: a.latitude,
        longitude: a.longitude,
      })),
    });
  }
  if (item.attributes.length > 0) {
    await tx.contactAttribute.createMany({
      data: item.attributes.map((a) => ({
        contactId,
        key: a.key,
        value: a.value,
        label: a.label,
      })),
    });
  }
  if (item.categories.length > 0) {
    await syncCategories(tx, contactId, item.categories);
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

async function syncAddresses(
  tx: Prisma.TransactionClient,
  contactId: string,
  addresses: ParsedVCard["addresses"],
): Promise<void> {
  if (addresses.length === 0) return;
  const existing = await tx.contactAddress.findMany({
    where: { contactId },
    select: { formatted: true },
  });
  const have = new Set(existing.map((a) => a.formatted));
  const toAdd = addresses.filter((a) => !have.has(a.formatted));
  if (toAdd.length > 0) {
    await tx.contactAddress.createMany({
      data: toAdd.map((a) => ({
        contactId,
        street: a.street,
        city: a.city,
        region: a.region,
        postalCode: a.postalCode,
        country: a.country,
        formatted: a.formatted,
        kind: a.kind,
        label: a.label,
        latitude: a.latitude,
        longitude: a.longitude,
      })),
    });
  }
}

async function syncAttributes(
  tx: Prisma.TransactionClient,
  contactId: string,
  attributes: ParsedVCard["attributes"],
): Promise<void> {
  if (attributes.length === 0) return;
  // Дедуп по (key, value, label) — иначе при re-import будут множиться дубли.
  const existing = await tx.contactAttribute.findMany({
    where: { contactId },
    select: { key: true, value: true, label: true },
  });
  const key = (k: string, v: string, l: string | null | undefined) =>
    `${k} ${v} ${l ?? ""}`;
  const have = new Set(existing.map((a) => key(a.key, a.value, a.label)));
  const toAdd = attributes.filter((a) => !have.has(key(a.key, a.value, a.label)));
  if (toAdd.length > 0) {
    await tx.contactAttribute.createMany({
      data: toAdd.map((a) => ({
        contactId,
        key: a.key,
        value: a.value,
        label: a.label,
      })),
    });
  }
}

async function syncCategories(
  tx: Prisma.TransactionClient,
  contactId: string,
  categories: string[],
): Promise<void> {
  for (const name of categories) {
    const tag = await tx.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    await tx.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId: tag.id } },
      create: { contactId, tagId: tag.id },
      update: {},
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
      result.errors.push({
        uid: item.uid,
        displayName: item.displayName,
        reason: `social identity ${sp.service}:${sp.sourceId} already linked to another contact (${existing.contactId})`,
      });
      return;
    }
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
