// Phase 5d — discover the direct-chat counterparts that Phase 5c couldn't
// link to any ContactIdentity. These are people you have a personal chat with
// but who aren't in your contacts.GetContacts list (e.g. you wrote them but
// never added through "Add Contact", or they DM'd you).
//
// Strategy:
//   1. Batch the skipped user_ids into groups of 100 (users.GetUsers limit).
//   2. Resolve each batch via getInputEntity → Api.users.GetUsers.
//   3. For each User returned, create a ContactIdentity with
//      discoverySource='direct_chat' and merge-by-phone with existing
//      Contacts (e.g. vCard) where possible.
//   4. Run the same enrichment helper as Phase 3 to fill bio/photo/etc.
//   5. After all batches done, re-link orphan ChatMember rows
//      (chatMember.contactId IS NULL) to the new identities.

import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import bigInt from "big-integer";

import { db } from "@/lib/db";
import { withRateLimit } from "@/lib/telegram/rate-limit";
import { parseApiUser, safeJsonable } from "@/lib/parsers/telegram-api";
import { normalizePhone } from "@/lib/phone";
import {
  enrichOneIdentity,
  type ProgressCallback,
  type TelegramApiImportResult,
} from "./telegram-api";

const BATCH = 100;
const noopProgress: ProgressCallback = async () => {};

export type DiscoveryResult = {
  skippedInputCount: number;
  resolvedFromApi: number;
  failedToResolve: number;
  identitiesCreated: number;
  mergedWithVcard: number;
  createdNewContact: number;
  reLinkedChatMembers: number;
  errors: Array<{ phase: string; reason: string }>;
};

export function emptyDiscoveryResult(): DiscoveryResult {
  return {
    skippedInputCount: 0,
    resolvedFromApi: 0,
    failedToResolve: 0,
    identitiesCreated: 0,
    mergedWithVcard: 0,
    createdNewContact: 0,
    reLinkedChatMembers: 0,
    errors: [],
  };
}

export async function discoverSkippedDirectUsers(
  client: TelegramClient,
  skippedUserIds: string[],
  apiResult: TelegramApiImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<DiscoveryResult> {
  const result = emptyDiscoveryResult();
  // Dedup the input; Phase 5c can push duplicates if the same user shows up
  // both as direct-chat counterpart AND as a chat-source-id for self chat etc.
  const unique = Array.from(new Set(skippedUserIds));
  result.skippedInputCount = unique.length;

  // Skip those that have an identity by now — could have been created
  // mid-import by another flow (defensive).
  const existing = await db.contactIdentity.findMany({
    where: {
      source: "telegram",
      sourceId: { in: unique },
    },
    select: { sourceId: true },
  });
  const haveSet = new Set(existing.map((r) => r.sourceId));
  const toResolve = unique.filter((id) => !haveSet.has(id));
  const total = toResolve.length;
  await onProgress("phase_5d_discovery", 0, total);
  if (total === 0) return result;

  // ---- Resolve in batches ----
  const resolvedUsers: Api.User[] = [];
  let processed = 0;
  for (let i = 0; i < toResolve.length; i += BATCH) {
    const batch = toResolve.slice(i, i + BATCH);
    try {
      // getInputEntity for each id — gives InputPeerUser (with accessHash cache).
      // We can't pass an array directly to GetUsers, so build InputUser list.
      const inputUsers: Api.TypeInputUser[] = [];
      for (const sourceId of batch) {
        try {
          const inp = await withRateLimit(() =>
            client.getInputEntity(bigInt(sourceId)),
          );
          // getInputEntity returns InputPeerUser for users; GetUsers wants InputUser.
          if (inp instanceof Api.InputPeerUser) {
            inputUsers.push(
              new Api.InputUser({ userId: inp.userId, accessHash: inp.accessHash }),
            );
          } else if (inp instanceof Api.InputPeerSelf) {
            inputUsers.push(new Api.InputUserSelf());
          } else {
            result.failedToResolve += 1;
          }
        } catch {
          result.failedToResolve += 1;
        }
      }
      if (inputUsers.length === 0) continue;
      const resp = await withRateLimit(() =>
        client.invoke(new Api.users.GetUsers({ id: inputUsers })),
      );
      for (const u of resp) {
        if (u instanceof Api.User && !u.deleted) {
          resolvedUsers.push(u);
        } else {
          result.failedToResolve += 1;
        }
      }
    } catch (err) {
      result.errors.push({
        phase: "phase_5d_discovery",
        reason: `batch ${i}: ${(err as Error)?.constructor?.name ?? "Error"}`,
      });
    }
    processed += batch.length;
    await onProgress("phase_5d_discovery", processed, total);
    if (
      err_is_cumulative(result.errors) === true
    ) {
      throw new Error("cumulative_limit_exceeded during discovery");
    }
  }
  result.resolvedFromApi = resolvedUsers.length;

  // ---- Create identities + enrich each + attach ChatMember ----
  for (const u of resolvedUsers) {
    try {
      const idResult = await createIdentityForDiscoveredUser(u, result);
      if (idResult) {
        await enrichOneIdentity(
          client,
          { id: idResult.identityId, sourceId: idResult.sourceId, contactId: idResult.contactId },
          apiResult,
        );
        // Attach as direct chat counterpart member. We have a direct chat
        // with this user (that's why they were in the skipped set), so the
        // Chat row with (source='telegram', type='direct', sourceId=user_id)
        // should exist from Phase 4.
        await linkAsDirectChatMember(idResult, result);
      }
    } catch (err) {
      result.errors.push({
        phase: "phase_5d_discovery",
        reason: `user ${u.id}: ${(err as Error)?.constructor?.name ?? "Error"}`,
      });
    }
  }

  // ---- Re-link orphan ChatMembers ----
  // A ChatMember row exists for me + counterpart, but Phase 5c left
  // contactId=null when the counterpart was unknown. Now that identities
  // exist, hydrate the contactId so the graph is consistent.
  const orphanMembers = await db.chatMember.findMany({
    where: { contactId: null },
    select: { id: true, identityId: true },
  });
  for (const m of orphanMembers) {
    const idRow = await db.contactIdentity.findUnique({
      where: { id: m.identityId },
      select: { contactId: true },
    });
    if (idRow?.contactId) {
      await db.chatMember.update({
        where: { id: m.id },
        data: { contactId: idRow.contactId },
      });
      result.reLinkedChatMembers += 1;
    }
  }

  await onProgress("phase_5d_discovery", total, total);
  return result;
}

function err_is_cumulative(
  errs: Array<{ reason: string }>,
): boolean {
  return errs.some((e) =>
    e.reason.includes("cumulative_limit_exceeded"),
  );
}

async function linkAsDirectChatMember(
  ids: { identityId: string; sourceId: string; contactId: string },
  result: DiscoveryResult,
): Promise<void> {
  const chat = await db.chat.findUnique({
    where: { source_sourceId: { source: "telegram", sourceId: ids.sourceId } },
    select: { id: true, type: true },
  });
  if (!chat) return; // No direct chat exists — nothing to attach.
  if (chat.type !== "direct" && chat.type !== "self") return;

  const existing = await db.chatMember.findUnique({
    where: { chatId_identityId: { chatId: chat.id, identityId: ids.identityId } },
  });
  if (existing) {
    if (existing.contactId !== ids.contactId) {
      await db.chatMember.update({
        where: { id: existing.id },
        data: { contactId: ids.contactId },
      });
    }
    return;
  }
  await db.chatMember.create({
    data: {
      chatId: chat.id,
      identityId: ids.identityId,
      contactId: ids.contactId,
    },
  });
  result.reLinkedChatMembers += 1;
}

async function createIdentityForDiscoveredUser(
  u: Api.User,
  result: DiscoveryResult,
): Promise<{ identityId: string; sourceId: string; contactId: string } | null> {
  const parsed = parseApiUser(u);
  const fullDisplayName =
    [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim() ||
    parsed.username ||
    `Telegram user ${parsed.userId}`;
  const rawDataLite = JSON.stringify({ user: safeJsonable(u) });

  // Already exists? (defensive — earlier filter should have caught this)
  const existing = await db.contactIdentity.findUnique({
    where: { source_sourceId: { source: "telegram", sourceId: parsed.userId } },
    select: { id: true, contactId: true },
  });
  if (existing) {
    return {
      identityId: existing.id,
      sourceId: parsed.userId,
      contactId: existing.contactId,
    };
  }

  // Phone-bridge merge attempt.
  const normalizedPhone = normalizePhone(parsed.phone);
  let phoneContactId: string | null = null;
  if (normalizedPhone) {
    const phoneHit = await db.phoneNumber.findFirst({
      where: { number: normalizedPhone },
      select: { contactId: true },
    });
    if (phoneHit) phoneContactId = phoneHit.contactId;
  }

  let contactId: string;
  if (phoneContactId) {
    contactId = phoneContactId;
    result.mergedWithVcard += 1;
  } else {
    const newContact = await db.contact.create({
      data: { displayName: fullDisplayName },
    });
    contactId = newContact.id;
    if (normalizedPhone) {
      await db.phoneNumber.create({
        data: { contactId, number: normalizedPhone, isPrimary: true },
      });
    }
    result.createdNewContact += 1;
  }

  const created = await db.contactIdentity.create({
    data: {
      contactId,
      source: "telegram",
      sourceId: parsed.userId,
      handle: parsed.username,
      displayName: fullDisplayName,
      confidence: "imported",
      discoverySource: "direct_chat",
      rawData: rawDataLite,
      isVerified: parsed.isVerified,
      isPremium: parsed.isPremium,
      isBot: parsed.isBot,
      isScam: parsed.isScam,
      isFake: parsed.isFake,
      lastSeenStatus: parsed.lastSeenStatus,
    },
  });
  result.identitiesCreated += 1;
  return { identityId: created.id, sourceId: parsed.userId, contactId };
}
