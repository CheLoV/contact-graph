import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, failFromZod, ok } from "@/lib/api";
import {
  importJobStatusQuerySchema,
  telegramImportRequestSchema,
} from "@/lib/validators/import";
import { runTelegramImport } from "@/lib/importers/telegram-orchestrator";

export const dynamic = "force-dynamic";

const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000;

async function reapOrphanedJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
  const { count } = await db.importJob.updateMany({
    where: {
      source: "telegram",
      status: "running",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "failed",
      finishedAt: new Date(),
      errors: JSON.stringify([
        { reason: "timed out or process restarted" },
      ]),
    },
  });
  return count;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("INVALID_BODY", "Тело запроса должно быть JSON", 400);
  }
  const parsed = telegramImportRequestSchema.safeParse(body);
  if (!parsed.success) return failFromZod(parsed.error);
  const { mode, jsonPath } = parsed.data;

  await reapOrphanedJobs();

  const job = await db.importJob.create({
    data: {
      source: "telegram",
      status: "running",
      total: 0,
      processed: 0,
      currentPhase: "pending",
    },
  });

  // Fire-and-forget: the orchestrator updates the job row as it progresses.
  void runTelegramImport(mode, { jobId: job.id, jsonPath })
    .catch(async (err) => {
      console.error("[telegram import] crashed", err);
      const reason =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      await db.importJob
        .update({
          where: { id: job.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            currentPhase: "crashed",
            errors: JSON.stringify([{ reason }]),
          },
        })
        .catch(() => {});
    });

  return ok({ jobId: job.id, mode }, { status: 202 });
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
    currentPhase: job.currentPhase,
    total: job.total,
    processed: job.processed,
    errors: job.errors ? (JSON.parse(job.errors) as unknown) : null,
    summary: job.summary ? (JSON.parse(job.summary) as unknown) : null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
}
