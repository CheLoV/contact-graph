import { createHash } from "node:crypto";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const DEFAULT_REGION: CountryCode =
  (process.env.DEFAULT_PHONE_REGION as CountryCode | undefined) ?? "RU";

export type ParsedPhone = { number: string; label?: string };
export type ParsedEmail = { address: string; label?: string };
export type ParsedUrl = { url: string; label?: string };

export type ParsedSocialProfile = {
  service: string; // 'vk' | 'telegram' | 'facebook' | 'twitter' | 'skype' | 'xmpp' | 'aim' | …
  sourceId: string; // стабильный id для ContactIdentity.sourceId
  handle?: string;
  url?: string;
};

export type ParsedAddress = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formatted: string;
  kind: "home" | "work" | "other";
  label?: string;
  latitude?: number;
  longitude?: number;
};

export type ParsedAttribute = {
  key: string; // 'phonetic_first_name' | 'maiden_name' | 'gender' | 'role' | 'lang' | 'tz' | 'show_as' | 'related_name' | 'anniversary' | …
  value: string;
  label?: string;
};

export type UnknownProperty = {
  property: string; // нормализованное имя (без item-префикса), UPPERCASE
  rawLine: string;
};

export type ParsedVCard = {
  uid: string;
  displayName: string;
  nickname?: string;
  phones: ParsedPhone[];
  emails: ParsedEmail[];
  urls: ParsedUrl[];
  socialProfiles: ParsedSocialProfile[];
  addresses: ParsedAddress[];
  categories: string[];
  attributes: ParsedAttribute[];
  unknownProperties: UnknownProperty[];
  rawData: string;
  org?: string;
  title?: string;
  note?: string;
  birthday?: string;
};

type RawProperty = {
  group?: string;
  name: string;
  params: Map<string, string[]>; // имя UPPERCASE, значения как есть
  value: string;
  rawLine: string;
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
      // ВАЖНО: значения параметров НЕ lowercase'им — теряются username'ы.
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

  return { group, name, params, value, rawLine: line };
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

function inferAddressKind(prop: RawProperty): "home" | "work" | "other" {
  const types = getTypes(prop);
  if (types.includes("home")) return "home";
  if (types.includes("work")) return "work";
  return "other";
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

type StableUidInputs = {
  displayName: string;
  phones: string[]; // нормализованные значения
  emails: string[]; // как в файле, lowercased
  org?: string;
  title?: string;
  birthday?: string;
  firstAddressFormatted?: string;
};

function stableUid(inputs: StableUidInputs): string {
  // Включаем максимум стабильно-идентифицирующих полей, чтобы исключить
  // ложные слияния двух разных людей с одинаковым именем. Все опциональные
  // поля → пустая строка если отсутствуют. Phones/emails отсортированы,
  // чтобы порядок в файле не влиял на хэш.
  const phones = [...inputs.phones].sort().join(",");
  const emails = [...inputs.emails.map((e) => e.toLowerCase())].sort().join(",");
  const key = [
    inputs.displayName,
    phones,
    emails,
    inputs.org ?? "",
    inputs.title ?? "",
    inputs.birthday ?? "",
    inputs.firstAddressFormatted ?? "",
  ].join("|");
  return (
    "sha256:" + createHash("sha256").update(key).digest("hex").slice(0, 32)
  );
}

function parseBirthday(raw: string): string | undefined {
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

function isPlaceholder(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "" || t === "null" || t === "undefined";
}

function cleanAddrPart(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (isPlaceholder(s)) return undefined;
  return s.trim();
}

function parseAddress(
  prop: RawProperty,
  groupLabels: Map<string, string>,
): ParsedAddress | null {
  // ADR: PO-Box;Extended;Street;City;Region;PostalCode;Country
  const fields = prop.value.split(";").map((s) => cleanAddrPart(s));
  if (fields.every((f) => !f)) return null;
  const street = fields[2];
  const city = fields[3];
  const region = fields[4];
  const postalCode = fields[5];
  const country = fields[6];
  // Extended (fields[1]) и PO-Box (fields[0]) — игнорируем как редкие, но добавляем к street если street пустой
  const streetCombined =
    street ?? cleanAddrPart(fields[1]) ?? cleanAddrPart(fields[0]);
  const components = [streetCombined, city, region, postalCode, country].filter(
    (c): c is string => !!c,
  );
  const formatted = components.join(", ");
  if (!formatted) return null;
  return {
    street: streetCombined,
    city,
    region,
    postalCode,
    country,
    formatted,
    kind: inferAddressKind(prop),
    label: inferLabel(prop, groupLabels),
  };
}

function parseGeo(prop: RawProperty): { lat: number; lng: number } | null {
  // vCard 3: GEO:43.6043;1.4437
  // vCard 4: GEO:geo:43.6043,1.4437
  let v = prop.value.trim();
  if (v.toLowerCase().startsWith("geo:")) v = v.slice(4);
  const parts = v.split(/[;,]/).map((s) => s.trim());
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
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
      // см. CLAUDE.md — Apple-формат x-apple:%XX… ломает vCard structure
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
  return { service, sourceId, handle, url: url || undefined };
}

function parseImpp(prop: RawProperty): ParsedSocialProfile | null {
  // IMPP;X-SERVICE-TYPE=Skype:skype:vasya123
  // или IMPP:xmpp:user@host
  const value = prop.value.trim();
  if (!value) return null;
  const serviceParam = getParamFirst(prop, "X-SERVICE-TYPE");
  const colonIdx = value.indexOf(":");
  const schemePart = colonIdx === -1 ? undefined : value.slice(0, colonIdx).toLowerCase();
  const idPart = colonIdx === -1 ? value : value.slice(colonIdx + 1);
  const service = (serviceParam ?? schemePart ?? "impp").toLowerCase();
  const sourceId = idPart.trim();
  if (!sourceId) return null;
  return {
    service,
    sourceId,
    handle: sourceId,
    url: value,
  };
}

const MESSENGER_PROPS: Record<string, string> = {
  "X-AIM": "aim",
  "X-SKYPE": "skype",
  "X-MSN": "msn",
  "X-JABBER": "xmpp",
  "X-ICQ": "icq",
  "X-YAHOO": "yahoo",
  "X-GTALK": "gtalk",
  "X-GADUGADU": "gadugadu",
};

function parseMessengerProperty(prop: RawProperty): ParsedSocialProfile | null {
  const service = MESSENGER_PROPS[prop.name];
  if (!service) return null;
  const sourceId = prop.value.trim();
  if (!sourceId) return null;
  return { service, sourceId, handle: sourceId };
}

function parseFbUrl(prop: RawProperty): ParsedSocialProfile | null {
  const url = prop.value.trim();
  if (!url) return null;
  const handle = extractFromUrl(url, /facebook\.com\/([^?/\s]+)/i);
  if (!handle) return null;
  return { service: "facebook", sourceId: handle, handle, url };
}

// Свойства, которые мы целенаправленно НЕ логируем как unknown (служебные/обработанные).
const KNOWN_OR_IGNORED = new Set<string>([
  // Структура vCard
  "BEGIN", "END", "VERSION", "PRODID", "REV", "UID",
  // Парсятся как основные поля
  "FN", "N", "ORG", "TITLE", "NOTE", "BDAY", "TEL", "EMAIL", "URL",
  "NICKNAME", "CATEGORIES", "ADR", "GEO",
  // Парсятся в ContactIdentity
  "X-SOCIALPROFILE", "IMPP", "FBURL",
  "X-AIM", "X-SKYPE", "X-MSN", "X-JABBER", "X-ICQ", "X-YAHOO", "X-GTALK", "X-GADUGADU",
  // Парсятся в attributes
  "ROLE", "GENDER", "LANG", "TZ",
  "X-PHONETIC-FIRST-NAME", "X-PHONETIC-LAST-NAME", "X-MAIDENNAME",
  "X-ABSHOWAS", "X-ABRELATEDNAMES", "X-ABDATE",
  // Лейбл-помощник
  "X-ABLABEL",
  // Игнор по дизайну
  "PHOTO", "LOGO", "SOUND", "KEY", "AGENT", "CLASS",
  "SOURCE", "NAME", "MAILER", "LABEL",
  "X-IMAGETYPE", "X-IMAGEHASH", "X-SHARED-PHOTO-DISPLAY-PREF",
  "VND-63-SENSITIVE-CONTENT-CONFIG",
  // Apple internal blobs (base64 binary, no semantic value)
  "X-ADDRESSING-GRAMMAR",
]);

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
  let nickname: string | undefined;
  const phones: ParsedPhone[] = [];
  const emails: ParsedEmail[] = [];
  const urls: ParsedUrl[] = [];
  const socialProfiles: ParsedSocialProfile[] = [];
  const addresses: ParsedAddress[] = [];
  const categories: string[] = [];
  const attributes: ParsedAttribute[] = [];
  const unknownProperties: UnknownProperty[] = [];
  let pendingGeo: { lat: number; lng: number } | undefined;

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
      case "NICKNAME":
        if (!nickname && p.value.trim()) {
          nickname = p.value
            .split(",")
            .map((s) => s.trim())
            .find((s) => s.length > 0);
        }
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
      case "FBURL": {
        const sp = parseFbUrl(p);
        if (sp) socialProfiles.push(sp);
        break;
      }
      case "X-SOCIALPROFILE": {
        const sp = extractSocialProfile(p);
        if (sp) socialProfiles.push(sp);
        break;
      }
      case "IMPP": {
        const sp = parseImpp(p);
        if (sp) socialProfiles.push(sp);
        break;
      }
      case "ADR": {
        const addr = parseAddress(p, groupLabels);
        if (addr) addresses.push(addr);
        break;
      }
      case "GEO": {
        const g = parseGeo(p);
        if (g) pendingGeo = g;
        break;
      }
      case "CATEGORIES": {
        for (const c of p.value.split(",")) {
          const t = c.trim();
          if (t) categories.push(t);
        }
        break;
      }
      case "ROLE":
        if (p.value.trim()) attributes.push({ key: "role", value: p.value.trim() });
        break;
      case "GENDER":
        if (p.value.trim()) attributes.push({ key: "gender", value: p.value.trim() });
        break;
      case "LANG":
        if (p.value.trim()) attributes.push({ key: "lang", value: p.value.trim() });
        break;
      case "TZ":
        if (p.value.trim()) attributes.push({ key: "tz", value: p.value.trim() });
        break;
      case "X-PHONETIC-FIRST-NAME":
        if (p.value.trim()) attributes.push({ key: "phonetic_first_name", value: p.value.trim() });
        break;
      case "X-PHONETIC-LAST-NAME":
        if (p.value.trim()) attributes.push({ key: "phonetic_last_name", value: p.value.trim() });
        break;
      case "X-MAIDENNAME":
        if (p.value.trim()) attributes.push({ key: "maiden_name", value: p.value.trim() });
        break;
      case "X-ABSHOWAS":
        if (p.value.trim()) attributes.push({ key: "show_as", value: p.value.trim().toLowerCase() });
        break;
      case "X-ABRELATEDNAMES":
        if (p.value.trim()) {
          attributes.push({
            key: "related_name",
            value: p.value.trim(),
            label: inferLabel(p, groupLabels),
          });
        }
        break;
      case "X-ABDATE":
        if (p.value.trim()) {
          attributes.push({
            key: "anniversary",
            value: p.value.trim(),
            label: inferLabel(p, groupLabels),
          });
        }
        break;
      default: {
        if (MESSENGER_PROPS[p.name]) {
          const sp = parseMessengerProperty(p);
          if (sp) socialProfiles.push(sp);
          break;
        }
        if (!KNOWN_OR_IGNORED.has(p.name)) {
          unknownProperties.push({ property: p.name, rawLine: p.rawLine });
        }
        break;
      }
    }
  }

  // Привязка GEO: если есть адрес — координаты к первому без них; иначе создаём фантомный адрес.
  if (pendingGeo) {
    const target = addresses.find((a) => a.latitude === undefined);
    if (target) {
      target.latitude = pendingGeo.lat;
      target.longitude = pendingGeo.lng;
    } else {
      addresses.push({
        formatted: `${pendingGeo.lat}, ${pendingGeo.lng}`,
        kind: "other",
        latitude: pendingGeo.lat,
        longitude: pendingGeo.lng,
      });
    }
  }

  const displayName = fn && fn.length > 0 ? fn : n ? joinName(n) : "";

  if (
    !displayName &&
    phones.length === 0 &&
    emails.length === 0 &&
    socialProfiles.length === 0 &&
    addresses.length === 0
  ) {
    return null;
  }

  const dedupedPhones = dedupBy(phones, (p) => p.number);
  const dedupedEmails = dedupBy(emails, (e) => e.address.toLowerCase());
  const dedupedUrls = dedupBy(urls, (u) => u.url);
  const dedupedSocial = dedupBy(socialProfiles, (s) => `${s.service}:${s.sourceId}`);
  const dedupedAddresses = dedupBy(addresses, (a) => a.formatted);
  const dedupedCategories = Array.from(
    new Set(categories.map((c) => c.toLowerCase())),
  ).map((lc) => categories.find((orig) => orig.toLowerCase() === lc) ?? lc);

  const finalUid =
    uid && uid.length > 0
      ? uid
      : stableUid({
          displayName,
          phones: dedupedPhones.map((p) => p.number),
          emails: dedupedEmails.map((e) => e.address),
          org,
          title,
          birthday,
          firstAddressFormatted: dedupedAddresses[0]?.formatted,
        });

  return {
    uid: finalUid,
    displayName: displayName || "Без имени",
    nickname,
    phones: dedupedPhones,
    emails: dedupedEmails,
    urls: dedupedUrls,
    socialProfiles: dedupedSocial,
    addresses: dedupedAddresses,
    categories: dedupedCategories,
    attributes,
    unknownProperties,
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
  // Unfold continuation lines.
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
