import type { Prisma } from "@prisma/client";

export const chatRowSelect = {
  id: true,
  source: true,
  sourceId: true,
  type: true,
  title: true,
  memberCount: true,
  messageCount: true,
  lastMessageAt: true,
  description: true,
  isPublic: true,
  photoFileId: true,
  megagroup: true,
  creationDate: true,
  usernames: true,
  slowmodeSeconds: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChatSelect;

export type ChatRow = Prisma.ChatGetPayload<{ select: typeof chatRowSelect }>;
