// Phone normalisation — one canonical implementation used by every importer.
// Returns E.164 ('+...') when libphonenumber-js can parse, else null.
// Tries three strategies in order to cover messy real-world inputs:
//   1. as-is with default region (catches '+7 921 …', '89095…' RU domestic)
//   2. '00' → '+' (European/RU international call prefix)
//   3. digits-only → '+'digits (Telegram API returns naked international)

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const DEFAULT_REGION: CountryCode =
  (process.env.DEFAULT_PHONE_REGION as CountryCode | undefined) ?? "RU";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const direct = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
  if (direct && direct.isValid()) return direct.number;

  if (trimmed.startsWith("00")) {
    const withPlus = parsePhoneNumberFromString("+" + trimmed.slice(2), DEFAULT_REGION);
    if (withPlus && withPlus.isValid()) return withPlus.number;
  }

  const digitsOnly = trimmed.replace(/[\s()\-]/g, "");
  if (/^\d{7,15}$/.test(digitsOnly)) {
    const withPlus = parsePhoneNumberFromString("+" + digitsOnly, DEFAULT_REGION);
    if (withPlus && withPlus.isValid()) return withPlus.number;
  }
  return null;
}
