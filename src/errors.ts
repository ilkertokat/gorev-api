import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/** Uygulama hatası: tüm hata yanıtları aynı biçimde döner → { error: { code, message, details? } } */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = "Kayıt") => new HttpError(404, "not_found", `${what} bulunamadı`);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Gönderilen veri geçersiz",
        details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof SyntaxError && "body" in (err as object)) {
    res.status(400).json({ error: { code: "invalid_json", message: "Gövde geçerli bir JSON değil" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Beklenmeyen bir hata oluştu" } });
}
