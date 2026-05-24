// Telegram MTProto session verification (non-interactive).
//
// SECURITY: outputs ONLY derived facts — counts, booleans, integer ids,
// string lengths. Never prints first_name, last_name, username, phone,
// session string, api_hash, or any free-form personal data. If you add
// new probes, keep this invariant.
//
// Run via plain Node: node scripts/telegram-test.mjs
// (No interactive prompts — the saved session is reused.)

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "..", ".env");

function parseEnvFile(text) {
  const map = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

async function main() {
  const text = await fs.readFile(ENV_PATH, "utf8");
  const env = parseEnvFile(text);

  const apiIdRaw = env.get("TELEGRAM_API_ID");
  const apiHash = env.get("TELEGRAM_API_HASH");
  const sessionString = env.get("TELEGRAM_SESSION_STRING");

  console.log("Env presence check:");
  console.log(`  TELEGRAM_API_ID:         ${apiIdRaw ? "present" : "missing"}`);
  console.log(`  TELEGRAM_API_HASH:       ${apiHash ? "present" : "missing"}`);
  console.log(
    `  TELEGRAM_SESSION_STRING: ${sessionString ? `present (length ${sessionString.length})` : "missing"}`,
  );

  if (!apiIdRaw || !apiHash || !sessionString) {
    console.error(
      "Missing one of TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING in .env. Run scripts/telegram-auth.mjs first.",
    );
    process.exit(1);
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    console.error("TELEGRAM_API_ID must be a positive integer");
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 3 },
  );

  console.log("");
  console.log("Connecting (no interactive prompts expected)...");
  try {
    await client.connect();
  } catch (err) {
    console.error(`Connect failed: ${err?.constructor?.name ?? "Error"}`);
    process.exit(2);
  }

  const authorized = await client.isUserAuthorized();
  console.log(`  authorized: ${authorized}`);
  if (!authorized) {
    console.error("Session is not authorized — re-run scripts/telegram-auth.mjs");
    await client.disconnect();
    process.exit(3);
  }

  let me;
  try {
    me = await client.getMe();
  } catch (err) {
    console.error(`getMe failed: ${err?.constructor?.name ?? "Error"}`);
    await client.disconnect();
    process.exit(4);
  }

  const userId = me?.id?.toString?.() ?? "unknown";
  const hasUsername = typeof me?.username === "string" && me.username.length > 0;
  const hasPhone = typeof me?.phone === "string" && me.phone.length > 0;
  const firstNameLen =
    typeof me?.firstName === "string" ? me.firstName.length : 0;
  const lastNameLen =
    typeof me?.lastName === "string" ? me.lastName.length : 0;

  console.log("");
  console.log("getMe (derived facts only):");
  console.log(`  user_id:           ${userId}`);
  console.log(`  has_username:      ${hasUsername}`);
  console.log(`  has_phone:         ${hasPhone}`);
  console.log(`  first_name length: ${firstNameLen}`);
  console.log(`  last_name length:  ${lastNameLen}`);

  let contactsCount = "unknown";
  try {
    const contacts = await client.invoke(
      new Api.contacts.GetContacts({ hash: 0n }),
    );
    contactsCount =
      Array.isArray(contacts?.users) ? contacts.users.length : "unknown";
  } catch (err) {
    console.error(`GetContacts failed: ${err?.constructor?.name ?? "Error"}`);
  }
  console.log("");
  console.log("contacts.GetContacts:");
  console.log(`  contacts count: ${contactsCount}`);

  let dialogsCount = 0;
  let firstDialogHasId = false;
  try {
    const dialogs = await client.getDialogs({ limit: 1 });
    dialogsCount = Array.isArray(dialogs) ? dialogs.length : 0;
    if (dialogsCount > 0) {
      const d = dialogs[0];
      firstDialogHasId =
        d?.id !== undefined && d?.id !== null;
    }
  } catch (err) {
    console.error(`getDialogs failed: ${err?.constructor?.name ?? "Error"}`);
  }
  console.log("");
  console.log("getDialogs(limit=1) — connectivity probe:");
  console.log(`  fetched dialogs: ${dialogsCount}`);
  console.log(`  first dialog has id field: ${firstDialogHasId}`);

  await client.disconnect();
  console.log("");
  console.log("✅ Session works. No interactive prompts were required.");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err?.constructor?.name ?? "Error"}\n`);
  process.exit(99);
});
