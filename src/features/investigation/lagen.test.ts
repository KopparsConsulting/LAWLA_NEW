import { describe, expect, it } from "vitest";
import { lagenSummary } from "./lagen";
import type { LagenResolution, LagenStatus } from "../../../shared/lagen";

const r = (query: string, status: LagenStatus): LagenResolution => ({
  query,
  status,
  uri: null,
  url: null,
  identifier: null,
  title: null,
  kindLabel: null,
  source: null,
  pinLabel: null,
  excerpt: null,
});

describe("lagenSummary", () => {
  it("räknar per status", () => {
    const map = new Map([
      ["36 § AvtL", r("36 § AvtL", "found")],
      ["NJA 2099 s. 1", r("NJA 2099 s. 1", "invalid")],
      ["36 § lagen", r("36 § lagen", "unknown")],
    ]);
    expect(lagenSummary(map, ["36 § AvtL", "NJA 2099 s. 1", "36 § lagen", "SOU 2001:1"])).toBe(
      "1 finns på lagen.nu · 1 finns inte enligt lagen.nu · 2 gick inte att kontrollera",
    );
    expect(lagenSummary(undefined, ["x"])).toBeNull();
  });
});
