// Telegram MTProto importer — Phases 1, 2, 3 (Me, contacts, enrichment).
// Phases 4 (Dialogs), 5a/5b/5c (chats + direct ChatMember) live in
// telegram-api-chats.ts; Phase 6 (JSON historical) in telegram-json.ts.
//
// Architectural invariants (see CLAUDE.md → Day 3-A):
//   * Contact = humans only. ChatMember.identityId only ever references
//     identities from this file. We never create a Contact from a group
//     participant list.
//   * One ContactIdentity per (source, sourceId). At most one telegram
//     identity per Telegram user_id.
//   * Idempotent: re-running this importer must produce 0 changes if nothing
//     in the Telegram side changed (modulo updatedAt fields).

import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import bigInt from "big-integer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { getTelegramClient } from "@/lib/telegram/client";
import { withRateLimit, RateLimitError } from "@/lib/telegram/rate-limit";
import { parseApiUser, parseApiUserFull, safeJsonable } from "@/lib/parsers/telegram-api";
import type { ApiUserData } from "@/lib/telegram/types";
import { normalizePhone } from "@/lib/phone";

// -------- Configuration --------

const PHOTO_DIR =
  process.env.TELEGRAM_PHOTO_DIR ?? path.resolve("storage/telegram-photos");
const ENRICHMENT_BATCH = 25;
// Photo downloads stay sequential within the enrichment loop; the global
// rate-limit throttle is the bottleneck anyway. If we ever want parallelism
// here, add a Promise.all with a semaphore bounded by ~3.

// -------- Result types --------

export type IdentityConflict = {
  kind: "identity_conflict";
  existingContactId: string;
  candidateContactId: string | null;
  source: string;
  sourceId: string;
};

export type TelegramApiImportResult = {
  // Phase 1
  meContactId: string | null;
  meIdentityId: string | null;
  // Phase 2 — merge counters
  contactsMergedByPhone: number;
  contactsCreatedFromTelegram: number;
  contactsCreatedNoPhone: number;
  identitiesPromoted: number;
  conflicts: IdentityConflict[];
  // Phase 3 — enrichment counters
  enrichmentSkippedBots: number;
  enrichmentSkippedAlreadyDone: number;
  enrichmentSucceeded: number;
  enrichmentFailed: number;
  photosDownloaded: number;
  photosSkippedExisting: number;
  // Misc
  errors: Array<{ phase: string; reason: string }>;
};

export function emptyApiResult(): TelegramApiImportResult {
  return {
    meContactId: null,
    meIdentityId: null,
    contactsMergedByPhone: 0,
    contactsCreatedFromTelegram: 0,
    contactsCreatedNoPhone: 0,
    identitiesPromoted: 0,
    conflicts: [],
    enrichmentSkippedBots: 0,
    enrichmentSkippedAlreadyDone: 0,
    enrichmentSucceeded: 0,
    enrichmentFailed: 0,
    photosDownloaded: 0,
    photosSkippedExisting: 0,
    errors: [],
  };
}

// -------- Progress callback --------

export type ProgressCallback = (
  phase: string,
  processed: number,
  total: number,
) => Promise<void>;

const noopProgress: ProgressCallback = async () => {};

// -------- Helpers --------

function photoFileIdFor(userId: string, photoId: string, dcId: number): string {
  return createHash("sha256")
    .update(`${userId}:${photoId}:${dcId}`)
    .digest("hex")
    .slice(0, 16);
}

async function ensurePhotoDir(): Promise<void> {
  await fs.mkdir(PHOTO_DIR, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// -------- Phase 1: Me --------

export async function importMe(
  client: TelegramClient,
  result: TelegramApiImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<{ myUserId: string }> {
  await onProgress("phase_1_me", 0, 1);

  const resp = await withRateLimit(() =>
    client.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() })),
  );
  const fullUser = resp.fullUser;
  const meUser = resp.users.find(
    (u): u is Api.User =>
      u instanceof Api.User && String(u.id) === String(fullUser.id),
  );
  if (!meUser) {
    throw new Error("Phase 1: could not locate self User in GetFullUser response");
  }

  const parsed = parseApiUser(meUser);
  const parsedFull = parseApiUserFull(fullUser);
  const myUserId = parsed.userId;

  // Phone bridge to existing vCard contact.
  const normalizedPhone = normalizePhone(parsed.phone);
  let contactId: string | null = null;
  if (normalizedPhone) {
    const existing = await db.phoneNumber.findFirst({
      where: { number: normalizedPhone },
      select: { contactId: true },
    });
    if (existing) contactId = existing.contactId;
  }

  const fullDisplayName =
    [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim() ||
    "Me";

  if (!contactId) {
    const newContact = await db.contact.create({
      data: { displayName: fullDisplayName },
    });
    contactId = newContact.id;
    if (normalizedPhone) {
      await db.phoneNumber.create({
        data: { contactId, number: normalizedPhone, isPrimary: true },
      });
    }
  }

  // Upsert telegram_self identity.
  const rawData = JSON.stringify({
    user: safeJsonable(meUser),
    fullUser: safeJsonable(fullUser),
  });
  const photoFileId = await maybeDownloadPhoto(
    client,
    new Api.InputPeerSelf(),
    parsed,
    result,
  );

  const identity = await db.contactIdentity.upsert({
    where: { source_sourceId: { source: "telegram_self", sourceId: myUserId } },
    create: {
      contactId,
      source: "telegram_self",
      sourceId: myUserId,
      handle: parsed.username,
      displayName: fullDisplayName,
      confidence: "imported",
      rawData,
      bio: parsedFull.about,
      photoFileId,
      isVerified: parsed.isVerified,
      isPremium: parsed.isPremium,
      isBot: parsed.isBot,
      isScam: parsed.isScam,
      isFake: parsed.isFake,
      lastSeenStatus: parsed.lastSeenStatus,
      commonChatsCount: parsedFull.commonChatsCount,
    },
    update: {
      contactId,
      handle: parsed.username,
      displayName: fullDisplayName,
      confidence: "imported",
      rawData,
      bio: parsedFull.about,
      photoFileId: photoFileId ?? undefined,
      isVerified: parsed.isVerified,
      isPremium: parsed.isPremium,
      isBot: parsed.isBot,
      isScam: parsed.isScam,
      isFake: parsed.isFake,
      lastSeenStatus: parsed.lastSeenStatus,
      commonChatsCount: parsedFull.commonChatsCount,
    },
  });

  result.meContactId = contactId;
  result.meIdentityId = identity.id;

  await onProgress("phase_1_me", 1, 1);
  return { myUserId };
}

// -------- Phase 2: contacts.GetContacts --------

export async function importApiContacts(
  client: TelegramClient,
  myUserId: string,
  result: TelegramApiImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<{ identityIdByUserId: Map<string, string> }> {
  const resp = await withRateLimit(() =>
    client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) })),
  );
  if (resp.className === "contacts.ContactsNotModified") {
    throw new Error("Phase 2: contacts not modified — cannot proceed");
  }

  const rawUsers = resp.users.filter(
    (u): u is Api.User => u instanceof Api.User,
  );
  const total = rawUsers.length;
  await onProgress("phase_2_contacts", 0, total);

  const identityIdByUserId = new Map<string, string>();
  let i = 0;

  for (const raw of rawUsers) {
    i += 1;
    if (String(raw.id) === myUserId) {
      if (i % 50 === 0) await onProgress("phase_2_contacts", i, total);
      continue;
    }
    const parsed = parseApiUser(raw);
    if (parsed.isDeleted) {
      if (i % 50 === 0) await onProgress("phase_2_contacts", i, total);
      continue;
    }
    try {
      const identityId = await upsertApiContactIdentity(parsed, raw, result);
      if (identityId) identityIdByUserId.set(parsed.userId, identityId);
    } catch (err) {
      result.errors.push({
        phase: "phase_2_contacts",
        reason: `userId=${parsed.userId}: ${(err as Error).message}`,
      });
    }
    if (i % 50 === 0) await onProgress("phase_2_contacts", i, total);
  }

  await onProgress("phase_2_contacts", total, total);
  return { identityIdByUserId };
}

async function upsertApiContactIdentity(
  parsed: ApiUserData,
  raw: Api.User,
  result: TelegramApiImportResult,
): Promise<string | null> {
  const normalizedPhone = normalizePhone(parsed.phone);
  const fullDisplayName =
    [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim() ||
    parsed.username ||
    `Telegram user ${parsed.userId}`;
  const rawDataLite = JSON.stringify({ user: safeJsonable(raw) });

  // Existing identity for this Telegram user_id?
  const existingByUserId = await db.contactIdentity.findUnique({
    where: { source_sourceId: { source: "telegram", sourceId: parsed.userId } },
  });

  // Phone-bridge: find Contact by normalized phone.
  let phoneContactId: string | null = null;
  if (normalizedPhone) {
    const phoneHit = await db.phoneNumber.findFirst({
      where: { number: normalizedPhone },
      select: { contactId: true },
    });
    if (phoneHit) phoneContactId = phoneHit.contactId;
  }

  // Promotion path: existing self_reported telegram identity with matching handle.
  if (!existingByUserId && parsed.username) {
    const selfReported = await db.contactIdentity.findFirst({
      where: {
        source: "telegram",
        confidence: "self_reported",
        handle: parsed.username,
      },
    });
    if (selfReported) {
      // Conflict if phone-bridge points to a different contact.
      if (phoneContactId && phoneContactId !== selfReported.contactId) {
        result.conflicts.push({
          kind: "identity_conflict",
          existingContactId: selfReported.contactId,
          candidateContactId: phoneContactId,
          source: "telegram",
          sourceId: parsed.userId,
        });
        // Don't merge — keep the self_reported identity as-is, skip the API one.
        return selfReported.id;
      }
      // Promote: update sourceId from handle to real user_id, mark imported.
      const updated = await db.contactIdentity.update({
        where: { id: selfReported.id },
        data: {
          sourceId: parsed.userId,
          confidence: "imported",
          displayName: fullDisplayName,
          handle: parsed.username,
          rawData: rawDataLite,
          isVerified: parsed.isVerified,
          isPremium: parsed.isPremium,
          isBot: parsed.isBot,
          isScam: parsed.isScam,
          isFake: parsed.isFake,
          lastSeenStatus: parsed.lastSeenStatus,
        },
      });
      result.identitiesPromoted += 1;
      // Add phone to this Contact if missing.
      if (normalizedPhone) {
        const phoneOnContact = await db.phoneNumber.findFirst({
          where: { contactId: selfReported.contactId, number: normalizedPhone },
        });
        if (!phoneOnContact) {
          await db.phoneNumber.create({
            data: { contactId: selfReported.contactId, number: normalizedPhone },
          });
        }
      }
      return updated.id;
    }
  }

  // Existing telegram identity for this user_id — just refresh fields.
  if (existingByUserId) {
    const updated = await db.contactIdentity.update({
      where: { id: existingByUserId.id },
      data: {
        confidence: "imported",
        displayName: fullDisplayName,
        handle: parsed.username,
        rawData: rawDataLite,
        isVerified: parsed.isVerified,
        isPremium: parsed.isPremium,
        isBot: parsed.isBot,
        isScam: parsed.isScam,
        isFake: parsed.isFake,
        lastSeenStatus: parsed.lastSeenStatus,
      },
    });
    // Note: not counted as merge — already known.
    return updated.id;
  }

  // No existing identity. Decide which Contact to attach to.
  let contactId: string;
  if (phoneContactId) {
    contactId = phoneContactId;
    result.contactsMergedByPhone += 1;
  } else if (normalizedPhone) {
    const newContact = await db.contact.create({
      data: { displayName: fullDisplayName },
    });
    contactId = newContact.id;
    await db.phoneNumber.create({
      data: { contactId, number: normalizedPhone, isPrimary: true },
    });
    result.contactsCreatedFromTelegram += 1;
  } else {
    // No phone at all (privacy-hidden). Create a fresh Contact.
    const newContact = await db.contact.create({
      data: { displayName: fullDisplayName },
    });
    contactId = newContact.id;
    result.contactsCreatedNoPhone += 1;
  }

  const created = await db.contactIdentity.create({
    data: {
      contactId,
      source: "telegram",
      sourceId: parsed.userId,
      handle: parsed.username,
      displayName: fullDisplayName,
      confidence: "imported",
      rawData: rawDataLite,
      isVerified: parsed.isVerified,
      isPremium: parsed.isPremium,
      isBot: parsed.isBot,
      isScam: parsed.isScam,
      isFake: parsed.isFake,
      lastSeenStatus: parsed.lastSeenStatus,
    },
  });
  return created.id;
}

// -------- Phase 3: enrichment --------

export async function enrichApiContacts(
  client: TelegramClient,
  identityIdByUserId: Map<string, string>,
  result: TelegramApiImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<void> {
  await ensurePhotoDir();
  const total = identityIdByUserId.size;
  if (total === 0) return;

  // Pull the snapshot once — we'll skip bots and already-enriched rows.
  const identities = await db.contactIdentity.findMany({
    where: { id: { in: Array.from(identityIdByUserId.values()) } },
    select: {
      id: true,
      sourceId: true,
      isBot: true,
      bio: true,
      photoFileId: true,
      isPremium: true,
      lastSeenStatus: true,
    },
  });

  let processed = 0;
  await onProgress("phase_3_enrichment", 0, total);

  for (const id of identities) {
    processed += 1;
    if (id.isBot) {
      result.enrichmentSkippedBots += 1;
      if (processed % ENRICHMENT_BATCH === 0) {
        await onProgress("phase_3_enrichment", processed, total);
      }
      continue;
    }
    // Resumable: skip if bio is already set OR isPremium=true OR photo present.
    if (
      (id.bio && id.bio.length > 0) ||
      id.photoFileId ||
      id.lastSeenStatus !== null
    ) {
      result.enrichmentSkippedAlreadyDone += 1;
      if (processed % ENRICHMENT_BATCH === 0) {
        await onProgress("phase_3_enrichment", processed, total);
      }
      continue;
    }

    try {
      const entity = await withRateLimit(() =>
        client.getEntity(bigInt(id.sourceId)),
      );
      if (!(entity instanceof Api.User)) {
        result.enrichmentFailed += 1;
        continue;
      }
      const resp = await withRateLimit(() =>
        client.invoke(new Api.users.GetFullUser({ id: entity })),
      );
      const fullUser = resp.fullUser;
      const parsedFull = parseApiUserFull(fullUser);

      const photoFileId = await maybeDownloadPhoto(
        client,
        entity,
        parseApiUser(entity),
        result,
      );

      await db.contactIdentity.update({
        where: { id: id.id },
        data: {
          bio: parsedFull.about,
          businessHours: parsedFull.businessHours
            ? JSON.stringify(parsedFull.businessHours)
            : null,
          businessLocation: parsedFull.businessLocation
            ? JSON.stringify(parsedFull.businessLocation)
            : null,
          commonChatsCount: parsedFull.commonChatsCount,
          photoFileId: photoFileId ?? undefined,
        },
      });
      result.enrichmentSucceeded += 1;
    } catch (err) {
      result.enrichmentFailed += 1;
      const reason =
        err instanceof RateLimitError
          ? `RateLimit: ${err.detail.kind}`
          : (err as Error).constructor?.name ?? "Error";
      result.errors.push({
        phase: "phase_3_enrichment",
        reason: `identity=${id.id}: ${reason}`,
      });
      // If cumulative limit hit — abort this phase.
      if (err instanceof RateLimitError && err.detail.kind === "cumulative_limit_exceeded") {
        throw err;
      }
    }

    if (processed % ENRICHMENT_BATCH === 0) {
      await onProgress("phase_3_enrichment", processed, total);
    }
  }

  await onProgress("phase_3_enrichment", total, total);
}

// -------- Photo download helper --------

async function maybeDownloadPhoto(
  client: TelegramClient,
  entity: Api.TypeInputPeer | Api.User,
  parsed: ApiUserData,
  result: TelegramApiImportResult,
): Promise<string | null> {
  if (!parsed.photo) return null;
  const fileId = photoFileIdFor(
    parsed.userId,
    parsed.photo.photoId,
    parsed.photo.dcId,
  );
  const filepath = path.join(PHOTO_DIR, `${fileId}.jpg`);
  if (await fileExists(filepath)) {
    result.photosSkippedExisting += 1;
    return fileId;
  }
  try {
    const buf = await withRateLimit(() =>
      client.downloadProfilePhoto(entity, { isBig: false }),
    );
    if (!buf || (Buffer.isBuffer(buf) && buf.length === 0)) {
      return null;
    }
    await fs.writeFile(filepath, buf as Buffer);
    result.photosDownloaded += 1;
    return fileId;
  } catch (err) {
    result.errors.push({
      phase: "photo_download",
      reason: `userId=${parsed.userId}: ${(err as Error).constructor?.name ?? "Error"}`,
    });
    return null;
  }
}

// -------- Orchestrator: Phases 1-3 --------

export async function runTelegramApiPhases123(
  onProgress: ProgressCallback = noopProgress,
): Promise<{ result: TelegramApiImportResult; identityIdByUserId: Map<string, string>; myUserId: string }> {
  const client = await getTelegramClient();
  const result = emptyApiResult();
  const { myUserId } = await importMe(client, result, onProgress);
  const { identityIdByUserId } = await importApiContacts(
    client,
    myUserId,
    result,
    onProgress,
  );
  await enrichApiContacts(client, identityIdByUserId, result, onProgress);
  return { result, identityIdByUserId, myUserId };
}

// Re-export Prisma namespace for callers that want batch transactions later.
export { Prisma };
