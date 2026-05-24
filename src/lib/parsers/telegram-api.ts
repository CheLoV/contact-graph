// Normalise GramJS Api.User / UserFull / Chat / Channel responses into
// narrow application-level types. Pure functions, no IO.
//
// The raw GramJS types are wide unions with most fields optional — keeping
// them out of the rest of the codebase saves us from `as any` and runtime
// `field ?? undefined` noise.

import { Api } from "telegram";
import type {
  ApiChatData,
  ApiChatType,
  ApiFullChatData,
  ApiFullUserData,
  ApiPhotoRef,
  ApiUserData,
  LastSeenStatus,
} from "@/lib/telegram/types";

function bigIntStr(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value);
}

function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function mapUserStatus(status: Api.TypeUserStatus | undefined): LastSeenStatus {
  if (!status) return "hidden";
  if (status instanceof Api.UserStatusOnline) return "online";
  if (status instanceof Api.UserStatusRecently) return "recently";
  if (status instanceof Api.UserStatusLastWeek) return "within_week";
  if (status instanceof Api.UserStatusLastMonth) return "within_month";
  if (status instanceof Api.UserStatusOffline) {
    // wasOnline is a Unix timestamp; bucket into our enum.
    const wasOnline =
      typeof status.wasOnline === "number" ? status.wasOnline : 0;
    if (wasOnline === 0) return "long_ago";
    const ageMs = Date.now() - wasOnline * 1000;
    const day = 24 * 60 * 60 * 1000;
    if (ageMs < 7 * day) return "recently";
    if (ageMs < 30 * day) return "within_week";
    if (ageMs < 90 * day) return "within_month";
    return "long_ago";
  }
  // UserStatusEmpty + anything new we haven't seen yet
  return "hidden";
}

function extractPhoto(photo: Api.TypeUserProfilePhoto | undefined): ApiPhotoRef | null {
  if (!photo) return null;
  if (!(photo instanceof Api.UserProfilePhoto)) return null;
  return {
    photoId: bigIntStr(photo.photoId),
    dcId: typeof photo.dcId === "number" ? photo.dcId : 0,
    hasVideo: photo.hasVideo === true,
  };
}

function extractChatPhoto(photo: Api.TypeChatPhoto | undefined): ApiPhotoRef | null {
  if (!photo) return null;
  if (!(photo instanceof Api.ChatPhoto)) return null;
  return {
    photoId: bigIntStr(photo.photoId),
    dcId: typeof photo.dcId === "number" ? photo.dcId : 0,
    hasVideo: photo.hasVideo === true,
  };
}

export function parseApiUser(user: Api.User): ApiUserData {
  return {
    userId: bigIntStr(user.id),
    firstName: stringOrEmpty(user.firstName),
    lastName: stringOrEmpty(user.lastName),
    username: stringOrNull(user.username),
    phone: stringOrNull(user.phone),
    isBot: user.bot === true,
    isVerified: user.verified === true,
    isPremium: user.premium === true,
    isScam: user.scam === true,
    isFake: user.fake === true,
    isDeleted: user.deleted === true,
    isMutualContact: user.mutualContact === true,
    lastSeenStatus: mapUserStatus(user.status),
    photo: extractPhoto(user.photo),
  };
}

export function parseApiUserFull(fullUser: Api.UserFull): ApiFullUserData {
  return {
    userId: bigIntStr(fullUser.id),
    about: stringOrNull(fullUser.about),
    commonChatsCount:
      typeof fullUser.commonChatsCount === "number"
        ? fullUser.commonChatsCount
        : null,
    businessHours: fullUser.businessWorkHours
      ? safeJsonable(fullUser.businessWorkHours)
      : null,
    businessLocation: fullUser.businessLocation
      ? safeJsonable(fullUser.businessLocation)
      : null,
  };
}

// `safeJsonable` exists so we can serialise GramJS class instances later
// without circular references blowing up JSON.stringify. We extract plain
// own enumerable fields and stringify BigInt to string.
function safeJsonable(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (typeof (input as { className?: unknown }).className === "string") {
    const out: Record<string, unknown> = {
      _class: (input as { className: string }).className,
    };
    for (const key of Object.keys(input)) {
      if (key === "className" || key.startsWith("CONSTRUCTOR_ID")) continue;
      const value = (input as Record<string, unknown>)[key];
      if (typeof value === "bigint") out[key] = value.toString();
      else if (value instanceof Date) out[key] = value.toISOString();
      else if (Array.isArray(value)) out[key] = value.map(safeJsonable);
      else if (typeof value === "object" && value !== null) {
        out[key] = safeJsonable(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  if (Array.isArray(input)) return input.map(safeJsonable);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>)) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "bigint") out[key] = value.toString();
    else out[key] = value;
  }
  return out;
}

export { safeJsonable };

// ---------- Chats / Channels ----------

export function parseApiChat(
  raw: Api.User | Api.Chat | Api.Channel,
  myUserId: string,
): ApiChatData | null {
  if (raw instanceof Api.User) {
    // Direct chat — the "chat" is the other user (or yourself, for Saved Messages).
    const userId = bigIntStr(raw.id);
    const isSelf = userId === myUserId;
    return {
      sourceId: userId,
      type: isSelf ? "self" : "direct",
      title: stringOrNull(
        [raw.firstName, raw.lastName].filter(Boolean).join(" "),
      ),
      isPublic: false,
      primaryUsername: stringOrNull(raw.username),
      usernames: [],
      memberCount: null,
      photo: extractPhoto(raw.photo),
      counterpartUserId: isSelf ? null : userId,
    };
  }
  if (raw instanceof Api.Chat) {
    // Basic group (legacy)
    return {
      sourceId: bigIntStr(raw.id),
      type: "group",
      title: stringOrNull(raw.title),
      isPublic: false,
      primaryUsername: null,
      usernames: [],
      memberCount:
        typeof raw.participantsCount === "number" ? raw.participantsCount : null,
      photo: extractChatPhoto(raw.photo),
      counterpartUserId: null,
    };
  }
  if (raw instanceof Api.Channel) {
    const isBroadcast = raw.broadcast === true;
    const isMegagroup = raw.megagroup === true;
    const type: ApiChatType = isMegagroup
      ? "supergroup"
      : isBroadcast
        ? "channel"
        : "group";
    // Channel.usernames is an array of Api.Username; pick activeOnly.
    const allUsernames: string[] = [];
    if (typeof raw.username === "string" && raw.username.length > 0) {
      allUsernames.push(raw.username);
    }
    if (Array.isArray(raw.usernames)) {
      for (const u of raw.usernames) {
        if (u instanceof Api.Username && typeof u.username === "string" && u.active) {
          if (!allUsernames.includes(u.username)) allUsernames.push(u.username);
        }
      }
    }
    return {
      sourceId: bigIntStr(raw.id),
      type,
      title: stringOrNull(raw.title),
      isPublic: allUsernames.length > 0,
      primaryUsername: allUsernames[0] ?? null,
      usernames: allUsernames,
      memberCount:
        typeof raw.participantsCount === "number" ? raw.participantsCount : null,
      photo: extractChatPhoto(raw.photo),
      counterpartUserId: null,
    };
  }
  return null;
}

export function parseApiFullChannel(full: Api.ChannelFull): ApiFullChatData {
  return {
    sourceId: bigIntStr(full.id),
    description: stringOrNull(full.about),
    inviteLink: extractInviteLink(full.exportedInvite),
    creationDate: null, // not in ChannelFull directly; would need migrated_from_max_id + Chat.date
    slowmodeSeconds:
      typeof full.slowmodeSeconds === "number" ? full.slowmodeSeconds : null,
    migratedFromChatId: full.migratedFromChatId
      ? bigIntStr(full.migratedFromChatId)
      : null,
    megagroup: false, // narrowed by caller — ChannelFull doesn't carry it; the Channel does
  };
}

export function parseApiFullChat(full: Api.ChatFull): ApiFullChatData {
  return {
    sourceId: bigIntStr(full.id),
    description: stringOrNull(full.about),
    inviteLink: extractInviteLink(full.exportedInvite),
    creationDate: null,
    slowmodeSeconds: null,
    migratedFromChatId: null,
    megagroup: false,
  };
}

function extractInviteLink(invite: Api.TypeExportedChatInvite | undefined): string | null {
  if (!invite) return null;
  if (invite instanceof Api.ChatInviteExported) {
    return stringOrNull(invite.link);
  }
  return null;
}
