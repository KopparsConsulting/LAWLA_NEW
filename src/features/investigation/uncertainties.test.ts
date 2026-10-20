import { describe, expect, it } from "vitest";
import { circumstanceText, splitUncertainties } from "./uncertainties";

const ANALYSIS = `## Rättsläge

- **Förarbeten**: Prop. 2004/05:170, om verkställighet.

## Osäkerheter

- **Kraft av beslutet**: Det är oklart om beslutet om avvisning har vunnit laga kraft
  eller om det fortfarande är föremål för överklagande.
- **Hinder mot verkställighet**: Det är oklart om det finns några specifika omständigheter.

## Sammanfattning

Klienten …`;

describe("splitUncertainties", () => {
  it("delar upp avsnittet i punkter med rubrik", () => {
    const s = splitUncertainties(ANALYSIS)!;
    expect(s.headingText).toBe("Osäkerheter");
    expect(s.items.map((i) => i.title)).toEqual(["Kraft av beslutet", "Hinder mot verkställighet"]);
    expect(s.items[0]!.markdown).toContain("föremål för överklagande");
    expect(s.before).toContain("## Rättsläge");
    expect(s.after.startsWith("## Sammanfattning")).toBe(true);
  });

  it("klarar numrerad rubrik, numrerad lista och sista avsnitt", () => {
    const s = splitUncertainties("# Analys\n\n### 4. Oklarheter och risker\nIngress.\n\n1. Första\n2. Andra")!;
    expect(s.headingText).toBe("Oklarheter och risker");
    expect(s.intro).toBe("Ingress.");
    expect(s.items.map((i) => i.markdown)).toEqual(["Första", "Andra"]);
    expect(s.items[0]!.title).toBeNull();
    expect(s.after).toBe("");
  });

  it("fetstilsrubrik och stycken utan lista", () => {
    const s = splitUncertainties("Text.\n\n**Osäkerheter**\n\nFörsta stycket.\n\nAndra stycket.\n\n**Slutsats**\nX")!;
    expect(s.items.map((i) => i.markdown)).toEqual(["Första stycket.", "Andra stycket."]);
    expect(s.after.startsWith("**Slutsats**")).toBe(true);
  });

  it("underrubriker inom avsnittet blir egna punkter", () => {
    const s = splitUncertainties("## Osäkerheter\n- A\n### Detalj\n- B\n## Slut")!;
    expect(s.items.map((i) => i.markdown)).toEqual(["A", "**Detalj**:\n- B"]);
    expect(s.items[1]!.title).toBe("Detalj");
    expect(s.after).toBe("## Slut");
  });

  it("null utan osäkerhetsavsnitt", () => {
    expect(splitUncertainties("## Rättsläge\n- A")).toBeNull();
    expect(splitUncertainties("## Osäkerheter\n")).toBeNull();
  });

  it("omständighetens text knyts till punkten", () => {
    expect(circumstanceText({ title: "Kraft av beslutet", markdown: "" }, " Beslutet överklagades 3 mars. ")).toBe(
      "Kraft av beslutet: Beslutet överklagades 3 mars.",
    );
  });
});
