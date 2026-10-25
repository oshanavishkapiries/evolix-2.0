import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

const connect = () => drizzle(neon(env.DATABASE_URL), { schema });
let client: ReturnType<typeof connect> | undefined;

// Connects on first use, not at import, so `next build` works without DATABASE_URL.
export const db = new Proxy({} as ReturnType<typeof connect>, {
  get(_, key) {
    const real = (client ??= connect());
    const value = Reflect.get(real, key, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
