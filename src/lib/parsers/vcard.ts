import { createHash } from "node:crypto";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const DEFAULT_REGION: CountryCode =
  (process.env.DEFAULT_PHONE_REGION as CountryCode | undefined) ?? "RU";

export type ParsedPhone = { number: string; label?: string };
export type ParsedEmail = { address: string; label?: string };
export type ParsedUrl = { url: string; label?: string };

export type ParsedSocialProfile = {
  service: string; // 'vk' | 'telegram' | 'facebook' | 'twitter' | 'whatsapp' | …
  sourceId: string; // стабильный id для ContactIdentity.sourceId
  handle?: string;
  url?: string;
};

export type ParsedVCard = {
  uid: string;
  displayName: string;
  phones: ParsedPhone[];
  emails: ParsedEmail[];
  urls: ParsedUrl[];
  socialProfiles: ParsedSocialProfile[];
  rawData: string;
  org?: string;
  title?: string;
  note?: string;
  birthday?: string; // ISO YYYY-MM-DD, только если год >= 1900
};

type RawProperty = {
  group?: string;
  name: string;
  params: Map<string, string[]>; // param name uppercased, значения как есть (без lowercase!)
  value: string;
};

function unescapeValue(input: string): string {
  return input
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; ) {
    const ch = input.charAt(i);
    if (ch === "=" && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(input.charCodeAt(i));
    i += 1;
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return input;
  }
}

function splitRespectingQuotes(input: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
      continue;
    }
    if (ch === sep && !inQuotes) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out;
}

function parseLine(line: string): RawProperty | null {
  let colonIdx = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx === -1) return null;

  const head = line.slice(0, colonIdx);
  const rawValue = line.slice(colonIdx + 1);

  const parts = splitRespectingQuotes(head, ";");
  const first = parts.shift();
  if (!first) return null;

  let group: string | undefined;
  let nameRaw = first;
  const dotIdx = nameRaw.indexOf(".");
  if (dotIdx !== -1) {
    group = nameRaw.slice(0, dotIdx);
    nameRaw = nameRaw.slice(dotIdx + 1);
  }
  const name = nameRaw.toUpperCase();

  const params = new Map<string, string[]>();
  for (const param of parts) {
    if (!param) continue;
    const eqIdx = param.indexOf("=");
    let pname: string;
    let pvalues: string[];
    if (eqIdx === -1) {
      // Старый формат TEL;HOME → TYPE=HOME
      pname = "TYPE";
      pvalues = [param.trim()];
    } else {
      pname = param.slice(0, eqIdx).toUpperCase();
      let rawParam = param.slice(eqIdx + 1);
      if (
        rawParam.length >= 2 &&
        rawParam.startsWith('"') &&
        rawParam.endsWith('"')
      ) {
        rawParam = rawParam.slice(1, -1);
      }
      // ВНИМАНИЕ: значения параметров НЕ lowercase'им — теряются username'ы (Gluk_70 → gluk_70).
      // Регистр нормализуется только в местах использования (например, при сравнении TYPE).
      pvalues = rawParam
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    const existing = params.get(pname) ?? [];
    existing.push(...pvalues);
    params.set(pname, existing);
  }

  let value = rawValue;
  const encoding = params.get("ENCODING")?.[0]?.toLowerCase();
  if (encoding === "quoted-printable") {
    value = decodeQuotedPrintable(value);
  }
  value = unescapeValue(value);

  return { group, name, params, value };
}

const IGNORE_TYPE_TOKENS = new Set([
  "pref",
  "voice",
  "internet",
  "x400",
  "x-internet",
]);

function getParamFirst(prop: RawProperty, name: string): string | undefined {
  return prop.params.get(name)?.[0];
}

function getTypes(prop: RawProperty): string[] {
  return (prop.params.get("TYPE") ?? []).map((t) => t.toLowerCase());
}

function inferLabel(
  prop: RawProperty,
  groupLabels: Map<string, string>,
): string | undefined {
  if (prop.group) {
    const lbl = groupLabels.get(prop.group);
    if (lbl) return lbl;
  }
  const types = getTypes(prop);
  if (types.length > 0) {
    const meaningful = types.find((t) => !IGNORE_TYPE_TOKENS.has(t));
    return meaningful ?? types[0];
  }
  return undefined;
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, DEFAULT_REGION);
    if (parsed && parsed.isValid()) {
      return parsed.number;
    }
  } catch {
    // fall through
  }
  return trimmed;
}

function joinName(n: string): string {
  const parts = n.split(";").map((p) => p.trim());
  const family = parts[0] ?? "";
  const given = parts[1] ?? "";
  const additional = parts[2] ?? "";
  const prefix = parts[3] ?? "";
  const suffix = parts[4] ?? "";
  return [prefix, given, additional, family, suffix].filter(Boolean).join(" ");
}

function cleanAppleLabel(raw: string): string {
  return raw.replace(/^_\$!<(.*)>!\$_$/, "$1").trim();
}

function stableUid(
  displayName: string,
  firstPhone: string | undefined,
  firstEmail: string | undefined,
): string {
  const key = [displayName, firstPhone ?? "", firstEmail ?? ""].join("|");
  return (
    "sha256:" + createHash("sha256").update(key).digest("hex").slice(0, 32)
  );
}

function parseBirthday(raw: string): string | undefined {
  // Принимаем YYYY-MM-DD; пропускаем плейсхолдеры (год < 1900, типа Apple 1604-...).
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (!Number.isFinite(year) || year < 1900) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function extractFromUrl(url: string, pattern: RegExp): string | undefined {
  const m = url.match(pattern);
  return m && m[1] ? decodeURIComponent(m[1]) : undefined;
}

function extractSocialProfile(
  prop: RawProperty,
): ParsedSocialProfile | null {
  const types = getTypes(prop);
  const type = types[0];
  if (!type) return null;

  const service = type.toLowerCase();
  const xUser = getParamFirst(prop, "X-USER");
  const xUserId = getParamFirst(prop, "X-USERID");
  const url = prop.value.trim();
  const handle = xUser ? xUser.replace(/^@/, "") : undefined;

  let sourceId: string | undefined;
  switch (service) {
    case "vk":
      sourceId =
        xUserId ||
        handle ||
        extractFromUrl(url, /vk\.com\/(?:id)?([^?/\s]+)/i);
      break;
    case "telegram":
      sourceId =
        handle || extractFromUrl(url, /t\.me\/([^?/\s]+)/i);
      break;
    case "facebook":
      sourceId =
        handle || extractFromUrl(url, /facebook\.com\/([^?/\s]+)/i);
      break;
    case "twitter":
      sourceId =
        handle || extractFromUrl(url, /(?:twitter|x)\.com\/([^?/\s]+)/i);
      break;
    case "whatsapp":
      // Apple записывает x-user как `x-apple:%XX%XX…` с двоеточием в значении,
      // что ломает стандартный парсинг vCard. WhatsApp identity всё равно
      // надёжно слипнется с реальным импортом через PhoneNumber matching,
      // поэтому не плодим шумные identity из vCard.
      return null;
    case "instagram":
      sourceId =
        handle || extractFromUrl(url, /instagram\.com\/([^?/\s]+)/i);
      break;
    case "linkedin":
      sourceId =
        handle || extractFromUrl(url, /linkedin\.com\/in\/([^?/\s]+)/i);
      break;
    default:
      sourceId = handle || (url || undefined);
  }

  if (!sourceId) return null;

  return {
    service,
    sourceId,
    handle,
    url: url || undefined,
  };
}

function parseBlock(
  propertyLines: string[],
  rawBlock: string,
): ParsedVCard | null {
  const props: RawProperty[] = [];
  const groupLabels = new Map<string, string>();

  for (const raw of propertyLines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === "PHOTO") continue;
    if (p.name === "X-ABLABEL" && p.group) {
      groupLabels.set(p.group, cleanAppleLabel(p.value));
      continue;
    }
    props.push(p);
  }

  let uid: string | undefined;
  let fn: string | undefined;
  let n: string | undefined;
  let org: string | undefined;
  let title: string | undefined;
  let note: string | undefined;
  let birthday: string | undefined;
  const phones: ParsedPhone[] = [];
  const emails: ParsedEmail[] = [];
  const urls: ParsedUrl[] = [];
  const socialProfiles: ParsedSocialProfile[] = [];

  for (const p of props) {
    switch (p.name) {
      case "UID":
        if (p.value.trim()) uid = p.value.trim();
        break;
      case "FN":
        if (p.value.trim()) fn = p.value.trim();
        break;
      case "N":
        if (p.value.trim()) n = p.value;
        break;
      case "ORG":
        if (p.value.trim()) {
          org = p.value
            .split(";")
            .map((x) => x.trim())
            .filter(Boolean)
            .join(", ");
        }
        break;
      case "TITLE":
        if (p.value.trim()) title = p.value.trim();
        break;
      case "NOTE":
        if (p.value.trim()) note = p.value;
        break;
      case "BDAY":
        if (!birthday) {
          const bd = parseBirthday(p.value);
          if (bd) birthday = bd;
        }
        break;
      case "TEL": {
        const num = normalizePhone(p.value);
        if (num) phones.push({ number: num, label: inferLabel(p, groupLabels) });
        break;
      }
      case "EMAIL": {
        const addr = p.value.trim();
        if (addr) emails.push({ address: addr, label: inferLabel(p, groupLabels) });
        break;
      }
      case "URL": {
        const u = p.value.trim();
        if (u) urls.push({ url: u, label: inferLabel(p, groupLabels) });
        break;
      }
      case "X-SOCIALPROFILE": {
        const sp = extractSocialProfile(p);
        if (sp) socialProfiles.push(sp);
        break;
      }
      default:
        break;
    }
  }

  const displayName = fn && fn.length > 0 ? fn : n ? joinName(n) : "";

  if (
    !displayName &&
    phones.length === 0 &&
    emails.length === 0 &&
    socialProfiles.length === 0
  ) {
    return null;
  }

  // Дедупликация внутри блока
  const dedupedPhones = dedupBy(phones, (p) => p.number);
  const dedupedEmails = dedupBy(emails, (e) => e.address.toLowerCase());
  const dedupedUrls = dedupBy(urls, (u) => u.url);
  const dedupedSocial = dedupBy(socialProfiles, (s) => `${s.service}:${s.sourceId}`);

  const finalUid =
    uid && uid.length > 0
      ? uid
      : stableUid(
          displayName,
          dedupedPhones[0]?.number,
          dedupedEmails[0]?.address,
        );

  return {
    uid: finalUid,
    displayName: displayName || "Без имени",
    phones: dedupedPhones,
    emails: dedupedEmails,
    urls: dedupedUrls,
    socialProfiles: dedupedSocial,
    rawData: rawBlock,
    org,
    title,
    note,
    birthday,
  };
}

function dedupBy<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function parseVCard(content: string): ParsedVCard[] {
  // Unfold continuation lines: a CRLF/LF followed by SP/TAB joins to previous line.
  const unfolded = content.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");

  const lines = unfolded.split(/\r?\n/);
  const results: ParsedVCard[] = [];
  let buffer: string[] | null = null;
  let blockStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      buffer = [];
      blockStartIdx = i;
    } else if (upper === "END:VCARD" && buffer) {
      const rawBlock = lines.slice(blockStartIdx, i + 1).join("\n");
      const parsed = parseBlock(buffer, rawBlock);
      if (parsed) results.push(parsed);
      buffer = null;
    } else if (buffer) {
      if (line.trim()) buffer.push(line);
    }
  }

  return results;
}
