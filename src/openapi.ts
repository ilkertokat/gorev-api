/** OpenAPI 3.1 tanımı — /openapi.json'dan sunulur, /docs Swagger UI ile gösterir. */
const err = { $ref: "#/components/schemas/Error" };
const json = (schema: object) => ({ "application/json": { schema } });
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const secured = [{ bearer: [] }];

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Görev API",
    version: "1.0.0",
    description: "JWT kimlik doğrulamalı görev yönetimi API'si. Önce /auth/register ya da /auth/login ile token alın, sağ üstteki **Authorize** düğmesine yapıştırın.",
  },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "object", properties: {
        code: { type: "string" }, message: { type: "string" },
        details: { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } } } } } },
      Auth: { type: "object", properties: { user: { $ref: "#/components/schemas/User" }, token: { type: "string" } } },
      User: { type: "object", properties: { id: { type: "integer" }, email: { type: "string" }, name: { type: "string" } } },
      Project: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, color: { type: "string", example: "#4f46e5" },
        task_count: { type: "integer" }, done_count: { type: "integer" }, created_at: { type: "string" } } },
      Task: { type: "object", properties: { id: { type: "integer" }, project_id: { type: "integer" }, title: { type: "string" },
        description: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] },
        priority: { type: "integer", minimum: 1, maximum: 3 }, due_date: { type: ["string", "null"], format: "date" },
        created_at: { type: "string" }, updated_at: { type: "string" } } },
      TaskInput: { type: "object", required: ["title"], properties: { title: { type: "string", example: "Ana sayfa tasarımı" },
        description: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] },
        priority: { type: "integer", minimum: 1, maximum: 3, example: 2 }, due_date: { type: ["string", "null"], example: "2026-10-20" } } },
      Page: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, pages: { type: "integer" } } },
    },
  },
  paths: {
    "/auth/register": { post: { tags: ["Kimlik"], summary: "Hesap oluştur",
      requestBody: { required: true, content: json({ type: "object", required: ["email", "name", "password"], properties: {
        email: { type: "string", example: "ilker@ornek.com" }, name: { type: "string", example: "İlker" }, password: { type: "string", minLength: 8, example: "guclu-parola-123" } } }) },
      responses: { 201: { description: "Oluşturuldu", content: json({ $ref: "#/components/schemas/Auth" }) }, 400: { description: "Geçersiz veri", content: json(err) }, 409: { description: "E-posta kayıtlı", content: json(err) } } } },
    "/auth/login": { post: { tags: ["Kimlik"], summary: "Giriş yap (15 dakikada 5 deneme)",
      requestBody: { required: true, content: json({ type: "object", properties: { email: { type: "string", example: "ilker@ornek.com" }, password: { type: "string", example: "guclu-parola-123" } } }) },
      responses: { 200: { description: "Başarılı", content: json({ $ref: "#/components/schemas/Auth" }) }, 401: { description: "Hatalı bilgiler", content: json(err) }, 429: { description: "Çok fazla deneme", content: json(err) } } } },
    "/me": { get: { tags: ["Kimlik"], summary: "Oturumdaki kullanıcı ve özet", security: secured, responses: { 200: { description: "OK" }, 401: { description: "Yetkisiz", content: json(err) } } } },
    "/projects": {
      get: { tags: ["Projeler"], summary: "Projelerim (görev sayılarıyla)", security: secured,
        responses: { 200: { description: "OK", content: json({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Project" } } } }) } } },
      post: { tags: ["Projeler"], summary: "Proje oluştur", security: secured,
        requestBody: { required: true, content: json({ type: "object", required: ["name"], properties: { name: { type: "string", example: "Müşteri sitesi" }, color: { type: "string", example: "#22c55e" } } }) },
        responses: { 201: { description: "Oluşturuldu", content: json({ $ref: "#/components/schemas/Project" }) } } } },
    "/projects/{id}": {
      patch: { tags: ["Projeler"], summary: "Projeyi güncelle", security: secured, parameters: [idParam],
        requestBody: { content: json({ type: "object", properties: { name: { type: "string" }, color: { type: "string" } } }) }, responses: { 200: { description: "OK" }, 404: { description: "Bulunamadı", content: json(err) } } },
      delete: { tags: ["Projeler"], summary: "Projeyi ve görevlerini sil", security: secured, parameters: [idParam], responses: { 204: { description: "Silindi" } } } },
    "/projects/{id}/tasks": {
      get: { tags: ["Görevler"], summary: "Projenin görevleri", security: secured, parameters: [idParam], responses: { 200: { description: "OK" } } },
      post: { tags: ["Görevler"], summary: "Görev ekle", security: secured, parameters: [idParam],
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/TaskInput" }) },
        responses: { 201: { description: "Oluşturuldu", content: json({ $ref: "#/components/schemas/Task" }) }, 400: { description: "Geçersiz veri", content: json(err) } } } },
    "/tasks": { get: { tags: ["Görevler"], summary: "Tüm görevlerim: filtre, arama, sıralama, sayfalama", security: secured,
      parameters: [
        { name: "status", in: "query", schema: { type: "string", enum: ["todo", "doing", "done"] } },
        { name: "priority", in: "query", schema: { type: "integer", minimum: 1, maximum: 3 } },
        { name: "q", in: "query", description: "Başlık ve açıklamada arama", schema: { type: "string" } },
        { name: "overdue", in: "query", description: "Süresi geçmiş ve bitmemiş", schema: { type: "string", enum: ["true", "false"] } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["created", "-created", "due", "-due", "priority", "-priority"], default: "-created" } },
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
      ],
      responses: { 200: { description: "OK", content: json({ type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Task" } }, meta: { $ref: "#/components/schemas/Page" } } }) } } } },
    "/tasks/{id}": {
      get: { tags: ["Görevler"], summary: "Görev ayrıntısı", security: secured, parameters: [idParam], responses: { 200: { description: "OK" }, 404: { description: "Bulunamadı", content: json(err) } } },
      patch: { tags: ["Görevler"], summary: "Görevi güncelle", security: secured, parameters: [idParam],
        requestBody: { content: json({ $ref: "#/components/schemas/TaskInput" }) }, responses: { 200: { description: "OK" } } },
      delete: { tags: ["Görevler"], summary: "Görevi sil", security: secured, parameters: [idParam], responses: { 204: { description: "Silindi" } } } },
  },
};

export const docsHtml = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Görev API — Dokümantasyon</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#ui", persistAuthorization: true, docExpansion: "list" });</script></body></html>`;
