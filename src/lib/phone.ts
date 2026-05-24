// Phone normalisation — one canonical implementation used by every importer.
// Returns E.164 ('+...') when libphonenumber-js can parse, else null.
// Tries three strategies in order to cover messy real-world inputs:
//   1. as-is with default region (catches '+7 921 …', '89095…' RU domestic)
//   2. '00' → '+' (European/RU international call prefix)
//   3. digits-only → '+'digits (Telegram API returns naked international)

// Workaround for tsx + Node 22 + libphonenumber-js CJS interop:
//   The high-level `parsePhoneNumberFromString` from libphonenumber-js
//   loads metadata via `require('*.json')`, which returns undefined under
//   tsx's loader, crashing inside isSupportedCountry. We sidestep by using
//   the `core` API (which accepts metadata as an explicit argument) and
//   loading metadata from the .json.js helper that libphonenumber ships
//   specifically for the ESM-can't-import-JSON case.
import { parsePhoneNumberFromString as _parse } from "libphonenumber-js/core";
import metadata from "libphonenumber-js/min/metadata";
import type { CountryCode, PhoneNumber } from "libphonenumber-js";

const DEFAULT_REGION: CountryCode =
  (process.env.DEFAULT_PHONE_REGION as CountryCode | undefined) ?? "RU";

function parse(text: string, region: CountryCode): PhoneNumber | undefined {
  return _parse(text, region, metadata);
}

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const direct = parse(trimmed, DEFAULT_REGION);
  if (direct && direct.isValid()) return direct.number;

  if (trimmed.startsWith("00")) {
    const withPlus = parse("+" + trimmed.slice(2), DEFAULT_REGION);
    if (withPlus && withPlus.isValid()) return withPlus.number;
  }

  const digitsOnly = trimmed.replace(/[\s()\-]/g, "");
  if (/^\d{7,15}$/.test(digitsOnly)) {
    const withPlus = parse("+" + digitsOnly, DEFAULT_REGION);
    if (withPlus && withPlus.isValid()) return withPlus.number;
  }
  return null;
}
