import { z } from "zod";

export const importJobStatusQuerySchema = z.object({
  jobId: z.string().min(1, "jobId обязателен"),
});

export type ImportJobStatusQuery = z.infer<typeof importJobStatusQuerySchema>;

export const MAX_FILES_PER_IMPORT = 10;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 МБ

// Response schemas (используются клиентом для парсинга ответов API)
export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const importStartResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    jobId: z.string(),
    totalParsed: z.number(),
  }),
});

export const importEnrichmentSchema = z.object({
  addresses: z.number(),
  urls: z.number(),
  socialProfiles: z.number(),
  organizations: z.number(),
  titles: z.number(),
  tags: z.number(),
});

export const importSummarySchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  enrichment: importEnrichmentSchema,
  unknownProperties: z
    .object({
      blocksAffected: z.number(),
      counts: z.record(z.string(), z.number()),
    })
    .optional(),
});

export const importStatusResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.enum(["pending", "running", "done", "failed"]),
    total: z.number(),
    processed: z.number(),
    errors: z.unknown().nullable(),
    summary: importSummarySchema.nullable().optional(),
    startedAt: z.union([z.string(), z.date()]).nullable(),
    finishedAt: z.union([z.string(), z.date()]).nullable(),
  }),
});

export const importStartResponse = z.union([
  importStartResponseSchema,
  apiErrorResponseSchema,
]);

export const importStatusResponse = z.union([
  importStatusResponseSchema,
  apiErrorResponseSchema,
]);

// Telegram import — POST body
export const telegramImportRequestSchema = z.object({
  mode: z.enum(["api", "historical", "all"]),
  // optional path override for JSON-historical mode (defaults to sample-data path)
  jsonPath: z.string().min(1).optional(),
});
export type TelegramImportRequest = z.infer<typeof telegramImportRequestSchema>;
