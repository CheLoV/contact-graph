// Telegram JSON-export parser — limited to contacts.list[] for Day 3-A.
// Full message-level parsing for Day 3-Б will live in a different file.
//
// The JSON file can be ~150 MB on disk and ~600 MB in memory after parse;
// callers must launch with NODE_OPTIONS='--max-old-space-size=4096'
// (already set in npm run dev / CLI scripts).

import fs from "node:fs/promises";
import { normalizePhone } from "@/lib/phone";

export type ParsedTelegramAddressbookEntry = {
  firstName: string;
  lastName: string;
  rawPhone: string;
  normalizedPhone: string | null;
  dateAdded: Date | null;
  rawData: string; // JSON-string of the original entry
};

function isContactEntry(value: unknown): value is {
  first_name?: unknown;
  last_name?: unknown;
  phone_number?: unknown;
  date?: unknown;
} {
  return typeof value === "object" && value !== null;
}

export async function parseTelegramJsonAddressbook(
  jsonPath: string,
): Promise<ParsedTelegramAddressbookEntry[]> {
  const text = await fs.readFile(jsonPath, "utf8");
  const data: unknown = JSON.parse(text);

  if (typeof data !== "object" || data === null) return [];
  const contacts = (data as { contacts?: unknown }).contacts;
  if (typeof contacts !== "object" || contacts === null) return [];
  const list = (contacts as { list?: unknown }).list;
  if (!Array.isArray(list)) return [];

  const out: ParsedTelegramAddressbookEntry[] = [];
  for (const entry of list) {
    if (!isContactEntry(entry)) continue;
    const rawPhone =
      typeof entry.phone_number === "string" ? entry.phone_number.trim() : "";
    if (!rawPhone) continue;
    const firstName =
      typeof entry.first_name === "string" ? entry.first_name : "";
    const lastName = typeof entry.last_name === "string" ? entry.last_name : "";
    const normalized = normalizePhone(rawPhone);
    let dateAdded: Date | null = null;
    if (typeof entry.date === "string") {
      const d = new Date(entry.date);
      if (!Number.isNaN(d.getTime())) dateAdded = d;
    }
    out.push({
      firstName,
      lastName,
      rawPhone,
      normalizedPhone: normalized,
      dateAdded,
      rawData: JSON.stringify(entry),
    });
  }
  return out;
}
