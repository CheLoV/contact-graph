import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// Module-scoped singleton. Reused across importer phases (and any future
// server-side Telegram calls). Surviving across requests in a single
// Node process is the goal — fresh connection per request would burn
// session establishment time (~200ms) and is a Telegram-side anti-pattern.

let _client: TelegramClient | null = null;
let _connected = false;

function readCredentials(): { apiId: number; apiHash: string; session: string } {
  const apiIdRaw = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const session = process.env.TELEGRAM_SESSION_STRING;
  if (!apiIdRaw || !apiHash || !session) {
    throw new Error(
      "Telegram credentials missing in environment: " +
        "TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION_STRING required. " +
        "Run scripts/telegram-auth.mjs once to create the session.",
    );
  }
  const apiId = Number(apiIdRaw);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer");
  }
  return { apiId, apiHash, session };
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (_client && _connected) return _client;

  const { apiId, apiHash, session } = readCredentials();

  _client = new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    { connectionRetries: 5 },
  );

  // GramJS prints a banner on connect; we don't suppress it here — it's
  // useful when looking at server logs to confirm the client started.
  await _client.connect();
  _connected = true;

  return _client;
}

export async function disconnectTelegramClient(): Promise<void> {
  if (_client && _connected) {
    await _client.disconnect();
    _connected = false;
  }
}

export function isTelegramConnected(): boolean {
  return _connected;
}
