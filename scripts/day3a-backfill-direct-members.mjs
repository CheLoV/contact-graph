#!/usr/bin/env node
// One-shot migration: backfill ChatMember rows for direct Telegram chats
// whose counterpart got discovered in Phase 5d.
//
// Why this exists: Phase 5c only counted skipped counterparts without
// creating a ChatMember row, so when Phase 5d later created identities
// for ~880 of those users, the ChatMember table never caught up. Phase
// 5d's "re-link" path also did nothing because there were no orphan rows
// to re-link.
//
// This script is idempotent: re-running it is a no-op once the rows exist.
//
// Run:   npx tsx scripts/day3a-backfill-direct-members.mjs
//
// SECURITY: only counts + identity ids are printed. No names, no handles.

await import("../src/lib/db.ts"); // side-effect: load .env
const { db } = await import("../src/lib/db.ts");

const meIdentity = await db.contactIdentity.findFirst({
  where: { source: "telegram_self" },
  select: { id: true, contactId: true },
});
if (!meIdentity) {
  console.error("No telegram_self identity in DB. Run the import first.");
  process.exit(1);
}
console.log(`me identity: ${meIdentity.id}, me contact: ${meIdentity.contactId}`);

const directChats = await db.chat.findMany({
  where: { source: "telegram", type: "direct" },
  select: { id: true, sourceId: true },
});
console.log(`directChatsScanned: ${directChats.length}`);

let backfilled = 0;
let alreadyLinked = 0;
let orphan = 0;
let createdMeMembers = 0;

for (const chat of directChats) {
  // Ensure ME is a member (defensive — should already be from Phase 5c).
  const meMember = await db.chatMember.findUnique({
    where: { chatId_identityId: { chatId: chat.id, identityId: meIdentity.id } },
  });
  if (!meMember) {
    await db.chatMember.create({
      data: {
        chatId: chat.id,
        identityId: meIdentity.id,
        contactId: meIdentity.contactId,
      },
    });
    createdMeMembers += 1;
  }

  // Look up counterpart identity. Direct-chat sourceId === counterpart user_id.
  const counterpartIdentity = await db.contactIdentity.findUnique({
    where: { source_sourceId: { source: "telegram", sourceId: chat.sourceId } },
    select: { id: true, contactId: true, confidence: true },
  });

  if (!counterpartIdentity) {
    // Truly unresolvable (deactivated / inaccessible Telegram account).
    orphan += 1;
    continue;
  }

  // Is there already a ChatMember for the counterpart? Check by identityId.
  const existing = await db.chatMember.findUnique({
    where: {
      chatId_identityId: {
        chatId: chat.id,
        identityId: counterpartIdentity.id,
      },
    },
  });
  if (existing) {
    // Make sure contactId is hydrated (Phase 5c earlier set null for some).
    if (existing.contactId !== counterpartIdentity.contactId) {
      await db.chatMember.update({
        where: { id: existing.id },
        data: { contactId: counterpartIdentity.contactId },
      });
    }
    alreadyLinked += 1;
    continue;
  }

  // Create the missing ChatMember row.
  await db.chatMember.create({
    data: {
      chatId: chat.id,
      identityId: counterpartIdentity.id,
      contactId: counterpartIdentity.contactId,
    },
  });
  backfilled += 1;
}

console.log("");
console.log("=== Backfill summary ===");
console.log(`  directChatsScanned:           ${directChats.length}`);
console.log(`  meMembersCreated:             ${createdMeMembers}`);
console.log(`  chatMembersBackfilled:        ${backfilled}`);
console.log(`  alreadyLinked (no-op):        ${alreadyLinked}`);
console.log(`  directChatsStillOrphan:       ${orphan}`);
console.log("");

// Verification SQL — counts, no identifying data.
const totalChatMembers = await db.chatMember.count();
const directChatsCount = await db.chat.count({
  where: { source: "telegram", type: "direct" },
});
const orphansAfter = await db.$queryRawUnsafe(`
  SELECT COUNT(*) as n FROM Chat c
  WHERE c.source = 'telegram'
    AND c.type = 'direct'
    AND NOT EXISTS (
      SELECT 1 FROM ChatMember cm
      WHERE cm.chatId = c.id
        AND cm.identityId != ?
    )
`, meIdentity.id);

console.log("=== Post-state ===");
console.log(`  total ChatMember rows:        ${totalChatMembers}`);
console.log(`  direct chats total:           ${directChatsCount}`);
console.log(`  direct chats w/o counterpart: ${Array.isArray(orphansAfter) ? orphansAfter[0].n : "?"}`);

await db.$disconnect();
process.exit(0);
