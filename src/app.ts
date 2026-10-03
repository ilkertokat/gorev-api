import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { DB } from "./db.ts";
import { HttpError, errorHandler, notFound } from "./errors.ts";
import { docsHtml, openapi } from "./openapi.ts";
import { RateLimiter, hashPassword, signToken, verifyPassword, verifyToken } from "./security.ts";

export interface AppOptions {
  db: DB;
  jwtSecret: string;
  loginLimit?: number;
}

// --- doğrulama şemaları ------------------------------------------------------
z.config(z.locales.tr()); // varsayılan doğrulama mesajları Türkçe
const Register = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin"),
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı").max(80),
  password: z.string().min(8, "Parola en az 8 karakter olmalı").max(128),
});
const Login = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });
const ProjectInput = z.object({
  name: z.string().trim().min(1, "Proje adı gerekli").max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Renk #RRGGBB biçiminde olmalı").optional(),
});
const Status = z.enum(["todo", "doing", "done"]);
const TaskInput = z.object({
  title: z.string().trim().min(1, "Başlık gerekli").max(200),
  description: z.string().max(5000).optional(),
  status: Status.optional(),
  priority: z.number().int().min(1, "Öncelik 1-3 arası olmalı").max(3, "Öncelik 1-3 arası olmalı").optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı").nullable().optional(),
});
const TaskQuery = z.object({
  status: Status.optional(),
  priority: z.coerce.number().int().min(1).max(3).optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  sort: z.enum(["created", "-created", "due", "-due", "priority", "-priority"]).default("-created"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SORTS: Record<string, string> = {
  created: "t.created_at ASC, t.id ASC", "-created": "t.created_at DESC, t.id DESC",
  due: "t.due_date IS NULL, t.due_date ASC", "-due": "t.due_date DESC",
  priority: "t.priority ASC, t.id", "-priority": "t.priority DESC, t.id",
};

const id = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw notFound();
  return n;
};

declare module "express-serve-static-core" {
  interface Request { userId?: number }
}

export function createApp({ db, jwtSecret, loginLimit = 5 }: AppOptions) {
  const app = express();
  const limiter = new RateLimiter(loginLimit, 15 * 60 * 1000);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  // --- kimlik doğrulama ara katmanı -----------------------------------------
  const auth = (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const payload = token && verifyToken(token, jwtSecret);
    if (!payload) return next(new HttpError(401, "unauthorized", "Geçerli bir oturum anahtarı gerekli"));
    req.userId = payload.sub;
    next();
  };

  /** Projenin bu kullanıcıya ait olduğunu doğrular; başkasının projesi için 404 döner (varlığını sızdırmaz). */
  const ownProject = (userId: number, projectId: number) => {
    const p = db.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?").get(projectId, userId);
    if (!p) throw notFound("Proje");
    return p;
  };
  const ownTask = (userId: number, taskId: number) => {
    const t = db.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
                          WHERE t.id = ? AND p.owner_id = ?`).get(taskId, userId);
    if (!t) throw notFound("Görev");
    return t;
  };

  app.get("/health", (_req, res) => { res.json({ ok: true }); });
  app.get("/openapi.json", (_req, res) => { res.json(openapi); });
  app.get("/docs", (_req, res) => { res.type("html").send(docsHtml); });

  // --- auth ------------------------------------------------------------------
  app.post("/auth/register", async (req, res) => {
    const body = Register.parse(req.body);
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(body.email)) {
      throw new HttpError(409, "email_taken", "Bu e-posta ile kayıtlı bir hesap var");
    }
    const hash = await hashPassword(body.password);
    const r = db.prepare("INSERT INTO users(email, name, password_hash) VALUES (?, ?, ?)").run(body.email, body.name, hash);
    const userId = Number(r.lastInsertRowid);
    res.status(201).json({ user: { id: userId, email: body.email, name: body.name }, token: signToken(userId, body.email, jwtSecret) });
  });

  app.post("/auth/login", async (req, res) => {
    const body = Login.parse(req.body);
    const key = `${req.ip}|${body.email}`;
    if (!limiter.take(key)) throw new HttpError(429, "too_many_attempts", "Çok fazla deneme. 15 dakika sonra tekrar deneyin.");
    const user = db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").get(body.email) as
      { id: number; email: string; name: string; password_hash: string } | undefined;
    // Kullanıcı yoksa da aynı hata: hangi e-postaların kayıtlı olduğu sızdırılmaz
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(401, "invalid_credentials", "E-posta ya da parola hatalı");
    }
    limiter.reset(key);
    res.json({ user: { id: user.id, email: user.email, name: user.name }, token: signToken(user.id, user.email, jwtSecret) });
  });

  app.get("/me", auth, (req, res) => {
    const user = db.prepare("SELECT id, email, name, created_at FROM users WHERE id = ?").get(req.userId!);
    if (!user) throw notFound("Kullanıcı");
    const stats = db.prepare(`SELECT COUNT(*) AS total, SUM(t.status = 'done') AS done FROM tasks t
                              JOIN projects p ON p.id = t.project_id WHERE p.owner_id = ?`).get(req.userId!);
    res.json({ user, stats: { total: Number(stats?.total ?? 0), done: Number(stats?.done ?? 0) } });
  });

  // --- projeler --------------------------------------------------------------
  app.get("/projects", auth, (req, res) => {
    const rows = db.prepare(`SELECT p.*, COUNT(t.id) AS task_count, COALESCE(SUM(t.status = 'done'), 0) AS done_count
                             FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
                             WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`).all(req.userId!);
    res.json({ data: rows });
  });

  app.post("/projects", auth, (req, res) => {
    const body = ProjectInput.parse(req.body);
    const r = db.prepare("INSERT INTO projects(owner_id, name, color) VALUES (?, ?, ?)")
      .run(req.userId!, body.name, body.color ?? "#4f46e5");
    res.status(201).json(ownProject(req.userId!, Number(r.lastInsertRowid)));
  });

  app.patch("/projects/:id", auth, (req, res) => {
    const pid = id(req.params.id as string);
    ownProject(req.userId!, pid);
    const body = ProjectInput.partial().parse(req.body);
    if (body.name !== undefined) db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(body.name, pid);
    if (body.color !== undefined) db.prepare("UPDATE projects SET color = ? WHERE id = ?").run(body.color, pid);
    res.json(ownProject(req.userId!, pid));
  });

  app.delete("/projects/:id", auth, (req, res) => {
    const pid = id(req.params.id as string);
    ownProject(req.userId!, pid);
    db.prepare("DELETE FROM projects WHERE id = ?").run(pid);
    res.status(204).end();
  });

  // --- görevler --------------------------------------------------------------
  app.post("/projects/:id/tasks", auth, (req, res) => {
    const pid = id(req.params.id as string);
    ownProject(req.userId!, pid);
    const b = TaskInput.parse(req.body);
    const r = db.prepare(`INSERT INTO tasks(project_id, title, description, status, priority, due_date)
                          VALUES (?, ?, ?, ?, ?, ?)`)
      .run(pid, b.title, b.description ?? "", b.status ?? "todo", b.priority ?? 2, b.due_date ?? null);
    res.status(201).json(ownTask(req.userId!, Number(r.lastInsertRowid)));
  });

  /** Kullanıcının tüm görevleri (isteğe bağlı olarak tek projede): filtre, arama, sıralama, sayfalama. */
  const listTasks = (req: Request, res: Response, projectId?: number) => {
    const q = TaskQuery.parse(req.query);
    const where = ["p.owner_id = ?"];
    const args: (string | number)[] = [req.userId!];
    if (projectId) { where.push("t.project_id = ?"); args.push(projectId); }
    if (q.status) { where.push("t.status = ?"); args.push(q.status); }
    if (q.priority) { where.push("t.priority = ?"); args.push(q.priority); }
    if (q.q) { where.push("(t.title LIKE ? OR t.description LIKE ?)"); args.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.overdue === "true") where.push("t.status != 'done' AND t.due_date < date('now')");
    const from = `FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ${where.join(" AND ")}`;
    const total = Number(db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...args)?.n ?? 0);
    const data = db.prepare(`SELECT t.* ${from} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .all(...args, q.limit, (q.page - 1) * q.limit);
    res.json({ data, meta: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } });
  };

  app.get("/tasks", auth, (req, res) => listTasks(req, res));
  app.get("/projects/:id/tasks", auth, (req, res) => {
    const pid = id(req.params.id as string);
    ownProject(req.userId!, pid);
    listTasks(req, res, pid);
  });

  app.get("/tasks/:id", auth, (req, res) => { res.json(ownTask(req.userId!, id(req.params.id as string))); });

  app.patch("/tasks/:id", auth, (req, res) => {
    const tid = id(req.params.id as string);
    ownTask(req.userId!, tid);
    const b = TaskInput.partial().parse(req.body);
    const fields = Object.entries(b).filter(([, v]) => v !== undefined);
    if (fields.length) {
      db.prepare(`UPDATE tasks SET ${fields.map(([k]) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
        .run(...fields.map(([, v]) => v as string | number | null), tid);
    }
    res.json(ownTask(req.userId!, tid));
  });

  app.delete("/tasks/:id", auth, (req, res) => {
    const tid = id(req.params.id as string);
    ownTask(req.userId!, tid);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(tid);
    res.status(204).end();
  });

  app.use((_req, _res, next) => next(new HttpError(404, "not_found", "Uç bulunamadı")));
  app.use(errorHandler);
  return app;
}
