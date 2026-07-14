import { describe, expect, it } from "vitest";
import { detectAudibleWindow, trimPlan } from "./silence";

// 1 kHz "sample rate" keeps the math readable: 1000 samples = 1 second.
const SR = 1000;

function signal(leadS: number, toneS: number, tailS: number, amplitude = 0.5): number[] {
  return [
    ...new Array(Math.round(leadS * SR)).fill(0),
    ...new Array(Math.round(toneS * SR)).fill(amplitude),
    ...new Array(Math.round(tailS * SR)).fill(0)
  ];
}

describe("detectAudibleWindow", () => {
  it("finds the audible window with edge padding", () => {
    const window = detectAudibleWindow(signal(0.5, 1, 2), SR)!;
    expect(window.start).toBeCloseTo(0.45, 2); // 0.5 lead - 0.05 pad
    expect(window.end).toBeCloseTo(1.55, 2); // 1.5 tone end + 0.05 pad
  });

  it("returns null for pure silence and sub-threshold noise", () => {
    expect(detectAudibleWindow(new Array(SR).fill(0), SR)).toBeNull();
    expect(detectAudibleWindow(new Array(SR).fill(0.001), SR)).toBeNull();
  });

  it("returns the full range when there is no silence to cut", () => {
    const window = detectAudibleWindow(new Array(2 * SR).fill(0.5), SR)!;
    expect(window.start).toBe(0);
    expect(window.end).toBe(2);
  });
});

describe("trimPlan", () => {
  it("keeps the full clip when analysis is unavailable", () => {
    expect(trimPlan(undefined, 8)).toEqual({ offset: 0, duration: 8, cut: 0, silent: false });
  });

  it("flags fully silent outputs", () => {
    expect(trimPlan(null, 8)).toMatchObject({ silent: true, cut: 8 });
  });

  it("ignores trims below the threshold", () => {
    const plan = trimPlan({ start: 0.1, end: 9.9, duration: 10 }, 10);
    expect(plan).toMatchObject({ offset: 0, duration: 10, cut: 0 });
  });

  it("cuts significant leading and trailing silence", () => {
    const plan = trimPlan({ start: 0.8, end: 7.5, duration: 10 }, 10);
    expect(plan.offset).toBeCloseTo(0.8);
    expect(plan.duration).toBeCloseTo(6.7);
    expect(plan.cut).toBeCloseTo(3.3);
    expect(plan.silent).toBe(false);
  });
});
