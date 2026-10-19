import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSettings, readMainPrompt } from "./settings";
import { fakeD1 } from "./testdb";
import type { ProjectSettings } from "../shared/sharing";

const ORIGIN = "https://lawla.example";
const env = { BACKEND_URL: "https://backend.test", DB: fakeD1() };

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", init.cookie ?? "lawla_session=tok");
  if (init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  return new Request(ORIGIN + path, { ...init, headers });
}
const call = (path: string, init?: RequestInit & { cookie?: string }) => handleSettings(req(path, init), env, new URL(ORIGIN + path));

beforeEach(() => {
  env.DB = fakeD1();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).endsWith("/api/Projects/5") ? Response.json({ id: 5 }) : Response.json({ message: "Nej" }, { status: 403 }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe("settings", () => {
  it("kräver inloggning och åtkomst till ärendet", async () => {
    expect((await call("/settings/5", { cookie: "" })).status).toBe(401);
    expect((await call("/settings/6")).status).toBe(403);
  });

  it("tomt när inget sparats, sedan sparas och läses huvudprompten", async () => {
    const empty = (await (await call("/settings/5")).json()) as ProjectSettings;
    expect(empty).toEqual({ mainPrompt: "", updatedAt: null });

    const put = await call("/settings/5", { method: "PUT", body: JSON.stringify({ mainPrompt: "  Skriv kort och hänvisa alltid till lagrum.  " }) });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as ProjectSettings;
    expect(saved.mainPrompt).toBe("Skriv kort och hänvisa alltid till lagrum.");
    expect(saved.updatedAt).not.toBeNull();

    const again = (await (await call("/settings/5")).json()) as ProjectSettings;
    expect(again.mainPrompt).toBe("Skriv kort och hänvisa alltid till lagrum.");
    expect(await readMainPrompt(env.DB, 5)).toBe("Skriv kort och hänvisa alltid till lagrum.");
    expect(await readMainPrompt(env.DB, 7)).toBe("");
  });

  it("skriver över och kan tömmas", async () => {
    await call("/settings/5", { method: "PUT", body: JSON.stringify({ mainPrompt: "A" }) });
    await call("/settings/5", { method: "PUT", body: JSON.stringify({ mainPrompt: "" }) });
    expect(await readMainPrompt(env.DB, 5)).toBe("");
  });

  it("avvisar felaktig kropp och klipper för långa prompter", async () => {
    expect((await call("/settings/5", { method: "PUT", body: JSON.stringify({ mainPrompt: 5 }) })).status).toBe(400);
    const long = await call("/settings/5", { method: "PUT", body: JSON.stringify({ mainPrompt: "x".repeat(10_000) }) });
    expect(((await long.json()) as ProjectSettings).mainPrompt).toHaveLength(4000);
  });
});
