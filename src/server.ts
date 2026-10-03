import { createApp } from "./app.ts";
import { openDb } from "./db.ts";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error("JWT_SECRET ortam değişkeni en az 32 karakter olmalı.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const app = createApp({ db: openDb(), jwtSecret: secret });
app.listen(port, () => console.log(`Görev API http://localhost:${port} adresinde çalışıyor`));
