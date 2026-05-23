import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, failFromZod, ok } from "@/lib/api";
import {
  createContactSchema,
  listContactsQuerySchema,
} from "@/lib/validators/contact";

export const contactListInclude = {
  phoneNumbers: { take: 3, orderBy: { isPrimary: "desc" } },
  emails: { take: 3, orderBy: { isPrimary: "desc" } },
  identities: { select: { id: true, source: true, handle: true } },
  _count: { select: { chatMembers: true, tagsOnContact: true } },
} satisfies Prisma.ContactInclude;

export type ContactListItem = Prisma.ContactGetPayload<{
  include: typeof contactListInclude;
}>;

export async function GET(req: NextRequest) {
  const parsed = listContactsQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) return failFromZod(parsed.error);

  const { archived, search, limit, offset } = parsed.data;
  const where: Prisma.ContactWhereInput = {};
  if (archived !== undefined) where.isArchived = archived;
  if (search) {
    where.OR = [
      { displayName: { contains: search } },
      { notes: { contains: search } },
      { phoneNumbers: { some: { number: { contains: search } } } },
      { emails: { some: { address: { contains: search } } } },
      { identities: { some: { handle: { contains: search } } } },
    ];
  }

  const [contacts, total] = await db.$transaction([
    db.contact.findMany({
      where,
      include: contactListInclude,
      orderBy: [{ displayName: "asc" }],
      take: limit,
      skip: offset,
    }),
    db.contact.count({ where }),
  ]);

  return ok({ contacts, total });
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail("INVALID_JSON", "Тело запроса должно быть JSON", 400);
  }

  const parsed = createContactSchema.safeParse(payload);
  if (!parsed.success) return failFromZod(parsed.error);

  const { displayName, phoneNumber, email, notes } = parsed.data;

  const contact = await db.$transaction(async (tx) => {
    const created = await tx.contact.create({
      data: { displayName, notes },
    });
    if (phoneNumber) {
      await tx.phoneNumber.create({
        data: { contactId: created.id, number: phoneNumber, isPrimary: true },
      });
    }
    if (email) {
      await tx.email.create({
        data: { contactId: created.id, address: email, isPrimary: true },
      });
    }
    return tx.contact.findUniqueOrThrow({
      where: { id: created.id },
      include: contactListInclude,
    });
  });

  return ok({ contact }, { status: 201 });
}
