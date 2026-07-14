import { describe, expect, it } from "vitest";
import { parseShowcaseMap } from "./showcase";

describe("parseShowcaseMap", () => {
  it("keeps well-formed cards and normalizes arrays", () => {
    const map = parseShowcaseMap({
      preview_a: { persona: "Dila", goal: "fix a line", shows: ["Cast", "Inpaint"], steps: ["select", "run"] },
      preview_b: { persona: "Kerem", goal: "extend" } // missing arrays -> defaulted to []
    });
    expect(map.preview_a.shows).toEqual(["Cast", "Inpaint"]);
    expect(map.preview_b.steps).toEqual([]);
  });

  it("drops malformed entries and non-string array items", () => {
    const map = parseShowcaseMap({
      good: { persona: "X", goal: "Y", shows: ["a", 3, null], steps: [] },
      noPersona: { goal: "Y" },
      noGoal: { persona: "X" },
      nullish: null
    });
    expect(Object.keys(map)).toEqual(["good"]);
    expect(map.good.shows).toEqual(["a"]);
  });

  it("returns empty map for non-object input", () => {
    expect(parseShowcaseMap(null)).toEqual({});
    expect(parseShowcaseMap("nope")).toEqual({});
  });
});
