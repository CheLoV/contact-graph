import type { Prisma } from "@prisma/client";

export const contactRowInclude = {
  identities: {
    select: {
      id: true,
      source: true,
      sourceId: true,
      handle: true,
      confidence: true,
    },
  },
  phoneNumbers: {
    orderBy: { isPrimary: "desc" },
    take: 10,
  },
  emails: {
    orderBy: { isPrimary: "desc" },
    take: 10,
  },
  addresses: {
    orderBy: { createdAt: "asc" },
    take: 1,
  },
  urls: {
    orderBy: { id: "asc" },
    take: 100,
  },
  tagsOnContact: {
    include: { tag: true },
  },
} satisfies Prisma.ContactInclude;

export type ContactRow = Prisma.ContactGetPayload<{
  include: typeof contactRowInclude;
}>;
