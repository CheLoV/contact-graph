import { z } from "zod";

export const createContactSchema = z.object({
  displayName: z.string().min(1, "Имя обязательно").max(200),
  phoneNumber: z.string().trim().min(1).max(50).optional(),
  email: z.email().optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean().optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const listContactsQuerySchema = z.object({
  archived: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
