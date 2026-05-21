import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, env } from "prisma/config";

// 1. Get the directory of this current config file (ES6 equivalent of __dirname)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 2. Explicitly point dotenv to the .env file in this specific service folder
dotenv.config({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    // 3. Fallback to process.env if the Prisma env() helper still misses it
    url: env("DATABASE_URL") || process.env.DATABASE_URL,
  },
});
