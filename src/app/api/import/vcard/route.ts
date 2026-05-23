import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, failFromZod, ok } from "@/lib/api";
import { parseVCard, type ParsedVCard } from "@/lib/parsers/vcard";
import {
  createImportJob,
  importVCards,
  reapOrphanedJobs,
} from "@/lib/importers/vcard";
import {
  importJobStatusQuerySchema,
  MAX_FILES_PER_IMPORT,
  MAX_TOTAL_BYTES,
} from "@/lib/validators/import";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return fail(
      "INVALID_FORM_DATA",
      "Тело запроса должно быть multipart/form-data",
      400,
    );
  }

  const rawFiles = formData.getAll("files");
  const files: File[] = [];
  for (const entry of rawFiles) {
    if (entry instanceof File) files.push(entry);
  }

  if (files.length === 0) {
    return fail("NO_FILES", "Загрузите хотя бы один .vcf файл", 400);
  }
  if (files.length > MAX_FILES_PER_IMPORT) {
    return fail(
      "TOO_MANY_FILES",
      `Максимум ${MAX_FILES_PER_IMPORT} файлов за один импорт`,
      400,
    );
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_TOTAL_BYTES) {
    return fail(
      "FILE_TOO_LARGE",
      `Суммарный размер файлов превышает ${MAX_TOTAL_BYTES / 1024 / 1024} МБ`,
      400,
    );
  }

  // Чистим зависшие задачи перед стартом
  await reapOrphanedJobs("vcard");

  // Парсим все файлы синхронно — это быстро (130мс на 1850 контактов)
  const combined: ParsedVCard[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseVCard(text);
      combined.push(...parsed);
    } catch (err) {
      return fail(
        "PARSE_ERROR",
        `Не удалось распарсить файл ${file.name}: ${(err as Error).message}`,
        400,
      );
    }
  }

  // Дедупликация между файлами по UID — последний выигрывает
  const byUid = new Map<string, ParsedVCard>();
  for (const item of combined) byUid.set(item.uid, item);
  const deduped = Array.from(byUid.values());

  const jobId = await createImportJob("vcard", deduped.length);

  // Fire-and-forget: импорт идёт в фоне, клиент пуллит прогресс через GET
  void importVCards(deduped, jobId).catch((err) => {
    console.error("[vcard import] crashed", err);
  });

  return ok({ jobId, totalParsed: deduped.length }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const parsed = importJobStatusQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) return failFromZod(parsed.error);

  const job = await db.importJob.findUnique({
    where: { id: parsed.data.jobId },
  });
  if (!job) return fail("NOT_FOUND", "Импорт не найден", 404);

  return ok({
    status: job.status,
    total: job.total,
    processed: job.processed,
    errors: job.errors ? (JSON.parse(job.errors) as unknown) : null,
    summary: job.summary ? (JSON.parse(job.summary) as unknown) : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
}
