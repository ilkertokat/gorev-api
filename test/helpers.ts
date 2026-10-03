import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";

export const SECRET = "test-secret-test-secret-test-secret!";

/** Bellek içi veritabanıyla rastgele bir portta gerçek bir HTTP sunucusu başlatır. */
export async function startServer(opts: { loginLimit?: number } = {}) {
  const app = createApp({ db: openDb(":memory:"), jwtSecret: SECRET, ...opts });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function register(email = "ilker@ornek.com", password = "gizli-parola-123") {
    const r = await call("POST", "/auth/register", { email, name: "İlker", password });
    return r.body.token as string;
  }

  return { base, call, register, close: () => new Promise<void>((r) => server.close(() => r())) };
}
