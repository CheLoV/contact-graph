// Single orchestrator that drives all Telegram import phases.
// Called from both the HTTP route (/api/import/telegram) and the CLI
// (scripts/telegram-import-cli.mjs) so they share the exact same flow.

import path from "node:path";
import fs from "node:fs/promises";

import { db } from "@/lib/db";
import { getTelegramClient } from "@/lib/telegram/client";
import { resetRateLimiterState } from "@/lib/telegram/rate-limit";

import {
  emptyApiResult,
  importMe,
  importApiContacts,
  enrichApiContacts,
  type TelegramApiImportResult,
  type ProgressCallback,
} from "./telegram-api";
import {
  emptyChatResult,
  importDialogs,
  enrichChats,
  importDirectChatMembers,
  type ChatImportResult,
} from "./telegram-api-chats";
import {
  emptyHistoricalResult,
  importTelegramHistorical,
  type TelegramHistoricalResult,
} from "./telegram-json";
import {
  discoverSkippedDirectUsers,
  type DiscoveryResult,
} from "./telegram-api-discovery";

export type TelegramImportMode = "api" | "historical" | "all";

export type TelegramImportSummary = {
  mode: TelegramImportMode;
  api: TelegramApiImportResult | null;
  chats: ChatImportResult | null;
  discovery: DiscoveryResult | null;
  historical: TelegramHistoricalResult | null;
};

export type LogFn = (msg: string) => void;

const DEFAULT_JSON_PATH = path.resolve("sample-data/telegram-export/result.json");

async function setPhase(
  jobId: string | null,
  phase: string,
  processed: number,
  total: number,
): Promise<void> {
  if (!jobId) return;
  await db.importJob.update({
    where: { id: jobId },
    data: { currentPhase: phase, processed, total },
  });
}

function makeProgress(jobId: string | null, log: LogFn): ProgressCallback {
  return async (phase, processed, total) => {
    await setPhase(jobId, phase, processed, total);
    if (total > 0) {
      const pct = Math.floor((processed / total) * 100);
      log(`  ${phase}: ${processed}/${total} (${pct}%)`);
    } else {
      log(`  ${phase}: 0/0`);
    }
  };
}

export async function runTelegramImport(
  mode: TelegramImportMode,
  options: {
    jobId?: string | null;
    jsonPath?: string;
    log?: LogFn;
  } = {},
): Promise<TelegramImportSummary> {
  const jobId = options.jobId ?? null;
  const jsonPath = options.jsonPath ?? DEFAULT_JSON_PATH;
  const log = options.log ?? (() => {});

  resetRateLimiterState();

  log("");
  log("Tip: импорт идёт 15-25 минут. Чтобы Codespaces не уснул,");
  log("     открой второй терминал и запусти: watch -n 30 date");
  log("");

  const summary: TelegramImportSummary = {
    mode,
    api: null,
    chats: null,
    discovery: null,
    historical: null,
  };

  if (mode === "api" || mode === "all") {
    const client = await getTelegramClient();
    const progress = makeProgress(jobId, log);

    log("Phase 1/6: Me");
    const apiResult = emptyApiResult();
    const { myUserId } = await importMe(client, apiResult, progress);

    log("Phase 2/6: contacts.GetContacts");
    const { identityIdByUserId } = await importApiContacts(
      client,
      myUserId,
      apiResult,
      progress,
    );

    log("Phase 3/6: enrichment");
    await enrichApiContacts(client, apiResult, progress);
    summary.api = apiResult;

    // Checkpoint between enrichment (slowest) and dialogs+members.
    // If the latter phases die, we can restore without re-running ~2k getFullUser.
    try {
      const dbPath = path.resolve("prisma/dev.db");
      const ckpt = path.resolve("prisma/dev.db.before-day3a-phase4");
      await fs.copyFile(dbPath, ckpt);
      log(`  [checkpoint] DB copied to prisma/dev.db.before-day3a-phase4`);
    } catch (err) {
      log(`  [checkpoint] WARN: could not copy DB — ${(err as Error).message}`);
    }

    log("Phase 4/6: dialogs");
    const chatResult = emptyChatResult();
    const { collected } = await importDialogs(
      client,
      myUserId,
      chatResult,
      progress,
    );

    log("Phase 5b/6: chat enrichment");
    await enrichChats(client, collected, chatResult, progress);

    if (apiResult.meIdentityId && apiResult.meContactId) {
      log("Phase 5c/6: direct chat members");
      await importDirectChatMembers(
        collected,
        apiResult.meIdentityId,
        apiResult.meContactId,
        identityIdByUserId,
        chatResult,
        progress,
      );
    }
    summary.chats = chatResult;

    // Phase 5d: discover the direct-chat counterparts that didn't have an
    // identity yet. Creates Contact + ContactIdentity + enriches via
    // getFullUser, then re-links orphan ChatMember rows.
    if (chatResult.skippedDirectUserIds.length > 0) {
      log(
        `Phase 5d/6: discover skipped direct users (${chatResult.skippedDirectUserIds.length} ids)`,
      );
      const discovery = await discoverSkippedDirectUsers(
        client,
        chatResult.skippedDirectUserIds,
        apiResult,
        progress,
      );
      summary.discovery = discovery;
    }
  }

  if (mode === "historical" || mode === "all") {
    log("Phase 6/6: JSON historical");
    const exists = await fileExistsAt(jsonPath);
    if (!exists) {
      throw new Error(`JSON path not found: ${jsonPath}`);
    }
    const histResult = emptyHistoricalResult();
    await importTelegramHistorical(jsonPath, histResult, makeProgress(jobId, log));
    summary.historical = histResult;
  }

  if (jobId) {
    await db.importJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        finishedAt: new Date(),
        currentPhase: "done",
        summary: JSON.stringify(summary),
      },
    });
  }

  return summary;
}

async function fileExistsAt(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
