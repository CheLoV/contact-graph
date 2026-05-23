import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, failFromZod, ok } from "@/lib/api";
import { updateContactSchema } from "@/lib/validators/contact";
import { contactListInclude } from "../route";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const contact = await db.contact.findUnique({
    where: { id },
    include: contactListInclude,
  });
  if (!contact) return fail("NOT_FOUND", "Контакт не найден", 404);
  return ok({ contact });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail("INVALID_JSON", "Тело запроса должно быть JSON", 400);
  }

  const parsed = updateContactSchema.safeParse(payload);
  if (!parsed.success) return failFromZod(parsed.error);

  try {
    const contact = await db.contact.update({
      where: { id },
      data: parsed.data,
      include: contactListInclude,
    });
    return ok({ contact });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return fail("NOT_FOUND", "Контакт не найден", 404);
    }
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.contact.delete({ where: { id } });
    return ok({ id });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return fail("NOT_FOUND", "Контакт не найден", 404);
    }
    throw e;
  }
}
