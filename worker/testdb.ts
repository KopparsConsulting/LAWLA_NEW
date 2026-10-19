/** Minimal D1-attrapp ovanpå Nodes inbyggda SQLite, för Worker-testerna. Täcker det modulerna använder. */
import { DatabaseSync } from "node:sqlite";

export function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async <T>() => (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...(params as never[])) as { changes?: number };
      return { meta: { changes: r?.changes ?? 0 } };
    },
  });
  return { exec: async (sql: string) => db.exec(sql), prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
