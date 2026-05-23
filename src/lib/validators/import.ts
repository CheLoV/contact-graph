import { z } from "zod";

export const importJobStatusQuerySchema = z.object({
  jobId: z.string().min(1, "jobId обязателен"),
});

export type ImportJobStatusQuery = z.infer<typeof importJobStatusQuerySchema>;

export const MAX_FILES_PER_IMPORT = 10;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 МБ
