// Telegram MTProto authorization (interactive, one-time).
//
// SECURITY NOTES (read before changing):
// - This script is the ONLY component allowed to read .env and the ONLY
//   one allowed to print or persist the session string. It must never
//   console.log the session string, the SMS code, the 2FA password, or
//   the api_hash. Only derived facts (length, presence, user_id, count).
// - On any error we print the constructor name plus a category-specific
//   short message. Never err.stack — Node may bake function arguments
//   (and thus the code/password) into the trace.
// - Before rewriting .env we copy it to .env.backup. On success the
//   backup is deleted; on failure it is kept and the user is told.
//   .env.backup is in .gitignore.
//
// Run via:  !node scripts/telegram-auth.mjs
// (the `!` prefix lets the user's terminal forward stdin to input.text).

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "..", ".env");
const ENV_BACKUP_PATH = path.resolve(__dirname, "..", ".env.backup");

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

async function readEnv() {
  const text = await fs.readFile(ENV_PATH, "utf8");
  return { text, map: parseEnvFile(text) };
}

function reportEnvPresence(map, keys) {
  for (const key of keys) {
    const v = map.get(key);
    const status = v && v.length > 0 ? "present" : "missing";
    console.log(`  ${key}: ${status}`);
  }
}

async function writeEnvWithSession(originalText, sessionString) {
  await fs.writeFile(ENV_BACKUP_PATH, originalText, "utf8");

  try {
    const lines = originalText.split("\n");
    const newLine = `TELEGRAM_SESSION_STRING=${sessionString}`;
    const idx = lines.findIndex((l) =>
      l.startsWith("TELEGRAM_SESSION_STRING="),
    );
    if (idx >= 0) {
      lines[idx] = newLine;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.splice(lines.length - 1, 0, newLine);
      } else {
        lines.push(newLine);
        lines.push("");
      }
    }
    await fs.writeFile(ENV_PATH, lines.join("\n"), "utf8");
    await fs.unlink(ENV_BACKUP_PATH);
  } catch (err) {
    process.stderr.write(
      `Backup preserved at .env.backup, restore manually if needed (${err.constructor.name})\n`,
    );
    throw err;
  }
}

function classifyAuthError(err) {
  const name = err?.constructor?.name ?? "Error";
  switch (name) {
    case "FloodWaitError": {
      const seconds = typeof err.seconds === "number" ? err.seconds : "?";
      return `FloodWait: ${seconds} seconds`;
    }
    case "SessionPasswordNeededError":
      return "SessionPasswordNeededError (will prompt for cloud password)";
    case "PhoneCodeInvalidError":
      return "Invalid SMS code, retry";
    case "PasswordHashInvalidError":
      return "Invalid cloud password, retry";
    default:
      return `Auth error: ${name}`;
  }
}

async function main() {
  const { text: envText, map: env } = await readEnv();

  console.log("Env presence check:");
  reportEnvPresence(env, [
    "TELEGRAM_API_ID",
    "TELEGRAM_API_HASH",
    "TELEGRAM_PHONE",
  ]);

  const apiIdRaw = env.get("TELEGRAM_API_ID");
  const apiHash = env.get("TELEGRAM_API_HASH");
  const phone = env.get("TELEGRAM_PHONE");
  if (!apiIdRaw || !apiHash || !phone) {
    console.error(
      "Missing one of TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_PHONE in .env",
    );
    process.exit(1);
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    console.error("TELEGRAM_API_ID must be a positive integer");
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 5 },
  );

  console.log("Connecting to Telegram...");
  try {
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async () => await input.text("SMS code: "),
      password: async () => await input.text("2FA cloud password: "),
      onError: (err) => {
        console.error(classifyAuthError(err));
        return false;
      },
    });
  } catch (err) {
    console.error(classifyAuthError(err));
    process.exit(2);
  }

  const sessionString = client.session.save();
  if (typeof sessionString !== "string" || sessionString.length < 10) {
    console.error("Session string is unexpectedly short — aborting");
    await client.disconnect();
    process.exit(3);
  }

  try {
    await writeEnvWithSession(envText, sessionString);
  } catch {
    await client.disconnect();
    process.exit(4);
  }

  // Quick connectivity sanity check — derive-only output, no personal data.
  let me;
  try {
    me = await client.invoke(new Api.users.GetFullUser({ id: "me" }));
  } catch (err) {
    console.error(`getMe failed: ${err.constructor.name}`);
    await client.disconnect();
    process.exit(5);
  }

  const userId = me?.fullUser?.id?.toString?.() ?? "unknown";

  console.log("");
  console.log("✅ Authorization successful.");
  console.log(`Session saved to .env (length: ${sessionString.length} chars).`);
  console.log(`Connected as user_id: ${userId}`);

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err?.constructor?.name ?? "Error"}\n`);
  process.exit(99);
});
