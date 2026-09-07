import "dotenv/config";
import { Temporal } from "@js-temporal/polyfill";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json" with { type: "json" };

// Prisma 8 PostgreSQL timestamptz codecs require the Temporal API.
Object.assign(globalThis, { Temporal });

export const db = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"]!,
});
