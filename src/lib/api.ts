import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiError> {
  return NextResponse.json({ ok: false, error: { code, message, details } }, {
    status,
  });
}

export function failFromZod(err: ZodError): NextResponse<ApiError> {
  return fail("VALIDATION_ERROR", "Невалидные данные", 400, err.issues);
}
