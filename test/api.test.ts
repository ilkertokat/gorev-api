import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startServer } from "./helpers.ts";

let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer({ loginLimit: 3 }); });
after(async () => { await srv.close(); });

describe("auth", () => {
  it("registers, rejects duplicates and validates input", async () => {
    const ok = await srv.call("POST", "/auth/register", { email: "Ayse@Ornek.com", name: "Ayşe", password: "uzun-parola-1" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.email, "ayse@ornek.com");
    assert.ok(ok.body.token);

    const dup = await srv.call("POST", "/auth/register", { email: "ayse@ornek.com", name: "Ayşe", password: "uzun-parola-1" });
    assert.equal(dup.status, 409);

    const bad = await srv.call("POST", "/auth/register", { email: "değil", name: "A", password: "kısa" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "validation_error");
    assert.deepEqual(bad.body.error.details.map((d: { field: string }) => d.field).sort(), ["email", "name", "password"]);
  });

  it("logs in, never reveals whether the email exists, and rate-limits", async () => {
    await srv.call("POST", "/auth/register", { email: "mehmet@ornek.com", name: "Mehmet", password: "dogru-parola-1" });
    const good = await srv.call("POST", "/auth/login", { email: "mehmet@ornek.com", password: "dogru-parola-1" });
    assert.equal(good.status, 200);

    const wrongPw = await srv.call("POST", "/auth/login", { email: "mehmet@ornek.com", password: "yanlis" });
    const noUser = await srv.call("POST", "/auth/login", { email: "yok@ornek.com", password: "yanlis" });
    assert.equal(wrongPw.status, 401);
    assert.deepEqual(wrongPw.body, noUser.body);

    await srv.call("POST", "/auth/login", { email: "mehmet@ornek.com", password: "yanlis" });
    await srv.call("POST", "/auth/login", { email: "mehmet@ornek.com", password: "yanlis" });
    const blocked = await srv.call("POST", "/auth/login", { email: "mehmet@ornek.com", password: "dogru-parola-1" });
    assert.equal(blocked.status, 429);
  });

  it("protects routes and rejects bad tokens", async () => {
    assert.equal((await srv.call("GET", "/me")).status, 401);
    assert.equal((await srv.call("GET", "/me", undefined, "a.b.c")).status, 401);
    const token = await srv.register("me@ornek.com");
    const me = await srv.call("GET", "/me", undefined, token);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "me@ornek.com");
    assert.equal(me.body.user.password_hash, undefined);
  });
});

describe("projects & tasks", () => {
  it("runs a full CRUD flow", async () => {
    const t = await srv.register("crud@ornek.com");
    const p = await srv.call("POST", "/projects", { name: "Web sitesi", color: "#22c55e" }, t);
    assert.equal(p.status, 201);

    const task = await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "Ana sayfa tasarımı", priority: 3, due_date: "2026-10-20" }, t);
    assert.equal(task.status, 201);
    assert.equal(task.body.status, "todo");

    const upd = await srv.call("PATCH", `/tasks/${task.body.id}`, { status: "done" }, t);
    assert.equal(upd.body.status, "done");
    assert.equal(upd.body.title, "Ana sayfa tasarımı");

    const list = await srv.call("GET", "/projects", undefined, t);
    assert.equal(list.body.data[0].task_count, 1);
    assert.equal(list.body.data[0].done_count, 1);

    assert.equal((await srv.call("DELETE", `/projects/${p.body.id}`, undefined, t)).status, 204);
    assert.equal((await srv.call("GET", `/tasks/${task.body.id}`, undefined, t)).status, 404); // zincirleme silindi
  });

  it("isolates users from each other's data", async () => {
    const alice = await srv.register("alice@ornek.com"), bob = await srv.register("bob@ornek.com");
    const p = await srv.call("POST", "/projects", { name: "Gizli" }, alice);
    const task = await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "Sır" }, alice);

    assert.equal((await srv.call("GET", `/projects/${p.body.id}/tasks`, undefined, bob)).status, 404);
    assert.equal((await srv.call("PATCH", `/tasks/${task.body.id}`, { title: "hack" }, bob)).status, 404);
    assert.equal((await srv.call("DELETE", `/tasks/${task.body.id}`, undefined, bob)).status, 404);
    assert.equal((await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "x" }, bob)).status, 404);
    assert.equal((await srv.call("GET", "/tasks", undefined, bob)).body.meta.total, 0);
  });

  it("filters, searches, sorts and paginates", async () => {
    const t = await srv.register("liste@ornek.com");
    const p = await srv.call("POST", "/projects", { name: "Liste" }, t);
    const items = [
      { title: "Logo çiz", priority: 1, status: "done" },
      { title: "API dokümanı yaz", priority: 3 },
      { title: "Logo revizyonu", priority: 2, due_date: "2020-01-01" },
      { title: "Sunucu taşı", priority: 3, status: "doing" },
      { title: "Test yaz", priority: 2 },
    ];
    for (const it of items) await srv.call("POST", `/projects/${p.body.id}/tasks`, it, t);

    const logo = await srv.call("GET", "/tasks?q=logo", undefined, t);
    assert.equal(logo.body.meta.total, 2);

    const high = await srv.call("GET", "/tasks?priority=3&sort=created", undefined, t);
    assert.deepEqual(high.body.data.map((x: { title: string }) => x.title), ["API dokümanı yaz", "Sunucu taşı"]);

    const overdue = await srv.call("GET", "/tasks?overdue=true", undefined, t);
    assert.deepEqual(overdue.body.data.map((x: { title: string }) => x.title), ["Logo revizyonu"]);

    const page2 = await srv.call("GET", "/tasks?limit=2&page=2&sort=created", undefined, t);
    assert.deepEqual(page2.body.meta, { page: 2, limit: 2, total: 5, pages: 3 });
    assert.deepEqual(page2.body.data.map((x: { title: string }) => x.title), ["Logo revizyonu", "Sunucu taşı"]);

    assert.equal((await srv.call("GET", "/tasks?sort=hack;DROP", undefined, t)).status, 400);
  });

  it("returns consistent errors for bad input", async () => {
    const t = await srv.register("hata@ornek.com");
    const p = await srv.call("POST", "/projects", { name: "P" }, t);
    const bad = await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "", priority: 9, due_date: "20/10/2026" }, t);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details.length, 3);
    for (const due_date of ["2026-02-30", "2026-13-01", "2025-02-29", "2026-00-10"]) {
      const res = await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "Tarih", due_date }, t);
      assert.equal(res.status, 400, due_date);
      assert.equal(res.body.error.details[0].field, "due_date");
    }
    const leap = await srv.call("POST", `/projects/${p.body.id}/tasks`, { title: "Artık yıl", due_date: "2028-02-29" }, t);
    assert.equal(leap.status, 201);
    assert.equal((await srv.call("PATCH", `/tasks/${leap.body.id}`, { due_date: "2028-04-31" }, t)).status, 400);
    assert.equal((await srv.call("POST", "/projects", "{bozuk json", t)).body.error.code, "invalid_json");
    assert.equal((await srv.call("GET", "/tasks/abc", undefined, t)).status, 404);
    assert.equal((await srv.call("GET", "/olmayan", undefined, t)).status, 404);
  });
});

describe("docs", () => {
  it("serves the OpenAPI document and the docs page", async () => {
    const spec = await srv.call("GET", "/openapi.json");
    assert.equal(spec.body.openapi, "3.1.0");
    assert.ok(spec.body.paths["/tasks"].get.parameters.length >= 7);
    const res = await fetch(srv.base + "/docs");
    assert.match(await res.text(), /swagger-ui/);
  });
});
