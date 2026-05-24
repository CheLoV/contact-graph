// Normalised shapes for Telegram API data. GramJS types are wide and partial
// (every field optional); we narrow them through parser functions and then
// the rest of the codebase only sees these types — no `any`, no surprises.

export type LastSeenStatus =
  | "online"
  | "recently"
  | "within_week"
  | "within_month"
  | "long_ago"
  | "hidden";

export type ApiUserData = {
  userId: string; // BigInt stringified — Telegram user_id
  firstName: string;
  lastName: string;
  username: string | null;
  phone: string | null; // raw, not yet normalized
  isBot: boolean;
  isVerified: boolean;
  isPremium: boolean;
  isScam: boolean;
  isFake: boolean;
  isDeleted: boolean;
  isMutualContact: boolean;
  lastSeenStatus: LastSeenStatus;
  photo: ApiPhotoRef | null;
};

export type ApiPhotoRef = {
  photoId: string; // BigInt stringified
  dcId: number;
  hasVideo: boolean;
};

export type ApiFullUserData = {
  userId: string;
  about: string | null; // bio
  commonChatsCount: number | null;
  businessHours: unknown | null; // JSON-safe shape, kept as-is for now
  businessLocation: unknown | null;
};

export type ApiChatType = "direct" | "group" | "supergroup" | "channel" | "self";

export type ApiChatData = {
  sourceId: string; // BigInt stringified (chat_id / channel_id / user_id for direct)
  type: ApiChatType;
  title: string | null;
  isPublic: boolean;
  primaryUsername: string | null;
  usernames: string[]; // for channels with multiple public usernames
  memberCount: number | null;
  photo: ApiPhotoRef | null;
  // type-specific: for direct chats, counterpartUserId === sourceId
  counterpartUserId: string | null;
};

export type ApiFullChatData = {
  sourceId: string;
  description: string | null;
  inviteLink: string | null;
  creationDate: Date | null;
  slowmodeSeconds: number | null;
  migratedFromChatId: string | null;
  megagroup: boolean;
};
