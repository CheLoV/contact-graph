// Telegram MTProto importer — Phases 4, 5a, 5b, 5c.
//   Phase 4 / 5a: getDialogs → upsert Chat rows with metadata
//   Phase 5b:     getFullChannel / getFullChat → enrich description/invite/etc
//   Phase 5c:     ChatMember rows for type='direct' and type='self' chats only
//                 (no participant enumeration for groups — see CLAUDE.md
//                 "Group/Chat architecture")

import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import bigInt from "big-integer";

import { db } from "@/lib/db";
import { withRateLimit, RateLimitError } from "@/lib/telegram/rate-limit";
import {
  parseApiChat,
  parseApiFullChannel,
  parseApiFullChat,
  safeJsonable,
} from "@/lib/parsers/telegram-api";
import type { ApiChatData, ApiChatType } from "@/lib/telegram/types";

import type { ProgressCallback } from "./telegram-api";

export type ChatImportResult = {
  // Phase 4 / 5a
  chatsCreated: number;
  chatsUpdated: number;
  chatsByType: Record<ApiChatType, number>;
  // Phase 5b
  chatsEnriched: number;
  chatsEnrichmentFailed: number;
  // Phase 5c
  membersCreated: number;
  membersSkippedUnknownCounterpart: number;
  errors: Array<{ phase: string; reason: string }>;
};

export function emptyChatResult(): ChatImportResult {
  return {
    chatsCreated: 0,
    chatsUpdated: 0,
    chatsByType: { direct: 0, self: 0, group: 0, supergroup: 0, channel: 0 },
    chatsEnriched: 0,
    chatsEnrichmentFailed: 0,
    membersCreated: 0,
    membersSkippedUnknownCounterpart: 0,
    errors: [],
  };
}

const noopProgress: ProgressCallback = async () => {};

// -------- Phase 4 / 5a: import dialogs --------

type CollectedDialog = {
  parsed: ApiChatData;
  raw: Api.User | Api.Chat | Api.Channel;
};

export async function importDialogs(
  client: TelegramClient,
  myUserId: string,
  result: ChatImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<{ collected: CollectedDialog[] }> {
  await onProgress("phase_4_dialogs", 0, 0);

  const dialogs = await withRateLimit(() => client.getDialogs({}));
  const total = dialogs.length;
  await onProgress("phase_4_dialogs", 0, total);

  const collected: CollectedDialog[] = [];
  let processed = 0;

  for (const dialog of dialogs) {
    processed += 1;
    const entity = dialog.entity;
    if (
      !(entity instanceof Api.User) &&
      !(entity instanceof Api.Chat) &&
      !(entity instanceof Api.Channel)
    ) {
      if (processed % 100 === 0)
        await onProgress("phase_4_dialogs", processed, total);
      continue;
    }
    const parsed = parseApiChat(entity, myUserId);
    if (!parsed) {
      if (processed % 100 === 0)
        await onProgress("phase_4_dialogs", processed, total);
      continue;
    }
    try {
      const upserted = await upsertChat(parsed, entity, result);
      if (upserted) {
        collected.push({ parsed, raw: entity });
      }
    } catch (err) {
      result.errors.push({
        phase: "phase_4_dialogs",
        reason: `chat ${parsed.sourceId}: ${(err as Error).message}`,
      });
    }
    if (processed % 100 === 0)
      await onProgress("phase_4_dialogs", processed, total);
  }

  await onProgress("phase_4_dialogs", total, total);
  return { collected };
}

async function upsertChat(
  parsed: ApiChatData,
  raw: Api.User | Api.Chat | Api.Channel,
  result: ChatImportResult,
): Promise<boolean> {
  const existing = await db.chat.findUnique({
    where: { source_sourceId: { source: "telegram", sourceId: parsed.sourceId } },
    select: { id: true },
  });
  const data = {
    title: parsed.title,
    type: parsed.type,
    memberCount: parsed.memberCount,
    isPublic: parsed.isPublic,
    usernames:
      parsed.usernames.length > 0 ? JSON.stringify(parsed.usernames) : null,
    megagroup: raw instanceof Api.Channel && raw.megagroup === true,
  };
  if (existing) {
    await db.chat.update({ where: { id: existing.id }, data });
    result.chatsUpdated += 1;
  } else {
    await db.chat.create({
      data: {
        source: "telegram",
        sourceId: parsed.sourceId,
        ...data,
      },
    });
    result.chatsCreated += 1;
  }
  result.chatsByType[parsed.type] += 1;
  return true;
}

// -------- Phase 5b: enrich group/supergroup/channel via GetFullChannel/Chat --------

export async function enrichChats(
  client: TelegramClient,
  collected: CollectedDialog[],
  result: ChatImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<void> {
  // Only groups/supergroups/channels — direct/self need no enrichment.
  const toEnrich = collected.filter(
    (c) => c.parsed.type !== "direct" && c.parsed.type !== "self",
  );
  const total = toEnrich.length;
  await onProgress("phase_5b_chat_enrichment", 0, total);

  let processed = 0;
  for (const item of toEnrich) {
    processed += 1;
    try {
      if (item.raw instanceof Api.Channel) {
        const fullResp = await withRateLimit(() =>
          client.invoke(
            new Api.channels.GetFullChannel({
              channel: new Api.InputChannel({
                channelId: item.raw.id,
                accessHash: (item.raw as Api.Channel).accessHash ?? bigInt(0),
              }),
            }),
          ),
        );
        if (fullResp.fullChat instanceof Api.ChannelFull) {
          const parsed = parseApiFullChannel(fullResp.fullChat);
          await db.chat.update({
            where: {
              source_sourceId: {
                source: "telegram",
                sourceId: item.parsed.sourceId,
              },
            },
            data: {
              description: parsed.description,
              inviteLink: parsed.inviteLink,
              slowmodeSeconds: parsed.slowmodeSeconds,
              migratedFromChatId: parsed.migratedFromChatId,
            },
          });
          result.chatsEnriched += 1;
        }
      } else if (item.raw instanceof Api.Chat) {
        const fullResp = await withRateLimit(() =>
          client.invoke(
            new Api.messages.GetFullChat({ chatId: item.raw.id }),
          ),
        );
        if (fullResp.fullChat instanceof Api.ChatFull) {
          const parsed = parseApiFullChat(fullResp.fullChat);
          await db.chat.update({
            where: {
              source_sourceId: {
                source: "telegram",
                sourceId: item.parsed.sourceId,
              },
            },
            data: {
              description: parsed.description,
              inviteLink: parsed.inviteLink,
            },
          });
          result.chatsEnriched += 1;
        }
      }
    } catch (err) {
      result.chatsEnrichmentFailed += 1;
      const reason =
        err instanceof RateLimitError
          ? `RateLimit: ${err.detail.kind}`
          : (err as Error).constructor?.name ?? "Error";
      result.errors.push({
        phase: "phase_5b_chat_enrichment",
        reason: `chat ${item.parsed.sourceId}: ${reason}`,
      });
      if (
        err instanceof RateLimitError &&
        err.detail.kind === "cumulative_limit_exceeded"
      ) {
        throw err;
      }
    }
    if (processed % 5 === 0)
      await onProgress("phase_5b_chat_enrichment", processed, total);
  }
  await onProgress("phase_5b_chat_enrichment", total, total);
}

// -------- Phase 5c: ChatMember rows for direct/self chats only --------

export async function importDirectChatMembers(
  collected: CollectedDialog[],
  myIdentityId: string,
  meContactId: string,
  identityIdByUserId: Map<string, string>,
  result: ChatImportResult,
  onProgress: ProgressCallback = noopProgress,
): Promise<void> {
  const direct = collected.filter(
    (c) => c.parsed.type === "direct" || c.parsed.type === "self",
  );
  const total = direct.length;
  await onProgress("phase_5c_direct_members", 0, total);

  // Build chatId-by-sourceId lookup once.
  const sourceIds = direct.map((d) => d.parsed.sourceId);
  const chats = await db.chat.findMany({
    where: { source: "telegram", sourceId: { in: sourceIds } },
    select: { id: true, sourceId: true, type: true },
  });
  const chatIdBySourceId = new Map<string, string>();
  for (const c of chats) chatIdBySourceId.set(c.sourceId, c.id);

  let processed = 0;
  for (const item of direct) {
    processed += 1;
    const chatId = chatIdBySourceId.get(item.parsed.sourceId);
    if (!chatId) continue;

    // Me member (skip if already present)
    await db.chatMember.upsert({
      where: {
        chatId_identityId: { chatId, identityId: myIdentityId },
      },
      create: {
        chatId,
        identityId: myIdentityId,
        contactId: meContactId,
      },
      update: {},
    });
    result.membersCreated += 1;

    if (item.parsed.type === "self") {
      // Saved Messages — only me.
      if (processed % 200 === 0)
        await onProgress("phase_5c_direct_members", processed, total);
      continue;
    }

    // direct: counterpart is the user whose user_id equals sourceId.
    const counterpartUserId = item.parsed.counterpartUserId;
    if (!counterpartUserId) {
      result.membersSkippedUnknownCounterpart += 1;
      if (processed % 200 === 0)
        await onProgress("phase_5c_direct_members", processed, total);
      continue;
    }
    const identityId = identityIdByUserId.get(counterpartUserId);
    if (!identityId) {
      // Counterpart is not in contacts.GetContacts (implicit chat).
      // Best-effort: look up identity by source/sourceId in DB.
      const fallback = await db.contactIdentity.findUnique({
        where: {
          source_sourceId: { source: "telegram", sourceId: counterpartUserId },
        },
        select: { id: true, contactId: true },
      });
      if (fallback) {
        await db.chatMember.upsert({
          where: {
            chatId_identityId: { chatId, identityId: fallback.id },
          },
          create: {
            chatId,
            identityId: fallback.id,
            contactId: fallback.contactId,
          },
          update: {},
        });
        result.membersCreated += 1;
      } else {
        result.membersSkippedUnknownCounterpart += 1;
      }
      if (processed % 200 === 0)
        await onProgress("phase_5c_direct_members", processed, total);
      continue;
    }
    const idRow = await db.contactIdentity.findUnique({
      where: { id: identityId },
      select: { contactId: true },
    });
    await db.chatMember.upsert({
      where: {
        chatId_identityId: { chatId, identityId },
      },
      create: {
        chatId,
        identityId,
        contactId: idRow?.contactId ?? null,
      },
      update: {},
    });
    result.membersCreated += 1;

    if (processed % 200 === 0)
      await onProgress("phase_5c_direct_members", processed, total);
  }
  await onProgress("phase_5c_direct_members", total, total);
}

// -------- Orchestrator --------

export async function runTelegramApiPhases45(
  client: TelegramClient,
  myUserId: string,
  myIdentityId: string,
  meContactId: string,
  identityIdByUserId: Map<string, string>,
  onProgress: ProgressCallback = noopProgress,
): Promise<ChatImportResult> {
  const result = emptyChatResult();
  const { collected } = await importDialogs(client, myUserId, result, onProgress);
  await enrichChats(client, collected, result, onProgress);
  await importDirectChatMembers(
    collected,
    myIdentityId,
    meContactId,
    identityIdByUserId,
    result,
    onProgress,
  );
  return result;
}

// Re-export the dialog raw-data helper for callers that want to persist
// the entity snapshot somewhere else later.
export { safeJsonable };
