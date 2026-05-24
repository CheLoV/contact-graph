#!/usr/bin/env node
// CLI for running the full Telegram import outside the Next.js HTTP layer.
// Shares the orchestrator with /api/import/telegram so they behave identically.
//
// IMPORTANT: launch with `npx tsx` so .ts imports resolve:
//   npx tsx scripts/telegram-import-cli.mjs --mode=all
//   npx tsx scripts/telegram-import-cli.mjs --mode=api
//   npx tsx scripts/telegram-import-cli.mjs --mode=historical [--json-path=...]
//
// SECURITY: logs are deidentified. Never echoes names, phone numbers, or
// usernames — only counters, percentages, and identity ids.

const args = process.argv.slice(2);
const parsed = {};
for (const a of args) {
  const m = a.match(/^--([^=]+)=(.+)$/);
  if (m) parsed[m[1]] = m[2];
  else if (a.startsWith("--")) parsed[a.slice(2)] = true;
}

const mode = parsed["mode"];
if (!mode || !["api", "historical", "all"].includes(mode)) {
  console.error("Usage:");
  console.error("  npx tsx scripts/telegram-import-cli.mjs --mode=api|historical|all [--json-path=...]");
  process.exit(2);
}
const jsonPath = parsed["json-path"];

// Dynamic-import the TS orchestrator; tsx handles the .ts resolution.
const { runTelegramImport } = await import("../src/lib/importers/telegram-orchestrator.ts");
const { db } = await import("../src/lib/db.ts");

const startedAt = Date.now();
console.log(`[telegram-cli] starting mode=${mode}`);

const job = await db.importJob.create({
  data: {
    source: "telegram",
    status: "running",
    total: 0,
    processed: 0,
    currentPhase: "pending",
  },
});
console.log(`[telegram-cli] jobId=${job.id}`);

try {
  const summary = await runTelegramImport(mode, {
    jobId: job.id,
    jsonPath,
    log: (msg) => console.log(msg),
  });
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log("");
  console.log(`[telegram-cli] DONE in ${seconds}s`);
  console.log("=== Summary ===");
  if (summary.api) {
    console.log("API contacts:");
    console.log(`  mergedByPhone:                ${summary.api.contactsMergedByPhone}`);
    console.log(`  createdFromTelegram:          ${summary.api.contactsCreatedFromTelegram}`);
    console.log(`  createdNoPhone:               ${summary.api.contactsCreatedNoPhone}`);
    console.log(`  identitiesPromoted:           ${summary.api.identitiesPromoted}`);
    console.log(`  conflicts:                    ${summary.api.conflicts.length}`);
    console.log(`  enrichmentSucceeded:          ${summary.api.enrichmentSucceeded}`);
    console.log(`  enrichmentSkippedBots:        ${summary.api.enrichmentSkippedBots}`);
    console.log(`  enrichmentSkippedAlreadyDone: ${summary.api.enrichmentSkippedAlreadyDone}`);
    console.log(`  enrichmentFailed:             ${summary.api.enrichmentFailed}`);
    console.log(`  photosDownloaded:             ${summary.api.photosDownloaded}`);
    console.log(`  photosSkippedExisting:        ${summary.api.photosSkippedExisting}`);
  }
  if (summary.chats) {
    console.log("Chats:");
    for (const [type, count] of Object.entries(summary.chats.chatsByType)) {
      console.log(`  ${type.padEnd(11)} ${count}`);
    }
    console.log(`  enriched:                     ${summary.chats.chatsEnriched}`);
    console.log(`  membersCreated:               ${summary.chats.membersCreated}`);
    console.log(`  membersSkippedUnknown:        ${summary.chats.membersSkippedUnknownCounterpart}`);
  }
  if (summary.historical) {
    console.log("Historical (JSON):");
    console.log(`  jsonEntriesTotal:                   ${summary.historical.jsonEntriesTotal}`);
    console.log(`  jsonEntriesNormalized:              ${summary.historical.jsonEntriesNormalized}`);
    console.log(`  jsonEntriesSkippedUnparseable:      ${summary.historical.jsonEntriesSkippedUnparseable}`);
    console.log(`  addressbookCreated:                 ${summary.historical.addressbookCreated}`);
    console.log(`  addressbookMergedToExistingContact: ${summary.historical.addressbookMergedToExistingContact}`);
    console.log(`  addressbookCreatedNewContact:       ${summary.historical.addressbookCreatedNewContact}`);
    console.log(`  addressbookSkippedHasTelegram:      ${summary.historical.addressbookSkippedHasTelegram}`);
    console.log(`  addressbookSupersededOnReimport:    ${summary.historical.addressbookSupersededOnReimport}`);
  }
  const errors =
    (summary.api?.errors.length ?? 0) +
    (summary.chats?.errors.length ?? 0) +
    (summary.historical?.errors.length ?? 0);
  console.log(`Errors total: ${errors}`);
  await db.$disconnect();
  process.exit(0);
} catch (err) {
  console.error(`[telegram-cli] FAILED: ${err?.constructor?.name ?? "Error"}: ${err?.message ?? ""}`);
  await db.importJob
    .update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        currentPhase: "crashed",
        errors: JSON.stringify([{ reason: String(err?.message ?? err) }]),
      },
    })
    .catch(() => {});
  await db.$disconnect();
  process.exit(3);
}
