import { describe, expect, it } from "vitest";

import {
  MoneyError,
  add,
  allocate,
  format,
  fromDecimalString,
  money,
  ratio,
  round,
  scale,
  subtract,
  sum,
  toDecimalString,
} from "./money";

const usd = (minor: number) => money(minor, "USD");

describe("construction", () => {
  it("rejects fractional minor units, which mean a float leaked in", () => {
    expect(() => money(10.5, "USD")).toThrow(MoneyError);
  });

  it("rejects values beyond safe integer range", () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, "USD")).toThrow(MoneyError);
  });

  it("normalises the currency code", () => {
    expect(money(100, "usd").currency).toBe("USD");
  });
});

describe("arithmetic", () => {
  it("adds and subtracts exactly", () => {
    expect(add(usd(1999), usd(1)).minor).toBe(2000);
    expect(subtract(usd(1000), usd(2500)).minor).toBe(-1500);
  });

  it("refuses to mix currencies", () => {
    expect(() => add(usd(100), money(100, "EUR"))).toThrow(/Currency mismatch/);
  });

  it("sums an empty list to a well-formed zero", () => {
    expect(sum([], "USD")).toEqual({ minor: 0, currency: "USD" });
  });

  it("catches a stray currency inside a sum", () => {
    expect(() => sum([usd(1), money(1, "GBP")], "USD")).toThrow(MoneyError);
  });

  it("survives the float trap that motivates this module", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point.
    const total = add(fromDecimalString("0.10", "USD"), fromDecimalString("0.20", "USD"));
    expect(total.minor).toBe(30);
    expect(toDecimalString(total)).toBe("0.30");
  });
});

describe("rounding", () => {
  it("rounds half to even, avoiding upward drift", () => {
    expect(round(0.5, "half-even")).toBe(0);
    expect(round(1.5, "half-even")).toBe(2);
    expect(round(2.5, "half-even")).toBe(2);
    expect(round(-1.5, "half-even")).toBe(-2);
  });

  it("rounds half away from zero when asked", () => {
    expect(round(2.5, "half-up")).toBe(3);
    expect(round(-2.5, "half-up")).toBe(-3);
  });

  it("does not drift across many scalings", () => {
    // Half-up would bias this sum upward; half-even should not.
    const values = Array.from({ length: 100 }, (_, i) => usd(i * 2 + 1));
    const halved = values.map((v) => scale(v, 0.5));
    const drift =
      halved.reduce((s, v) => s + v.minor, 0) -
      values.reduce((s, v) => s + v.minor, 0) / 2;
    expect(Math.abs(drift)).toBeLessThanOrEqual(1);
  });
});

describe("allocate", () => {
  it("splits evenly when it divides cleanly", () => {
    const parts = allocate(usd(9_600_000), Array(12).fill(1));
    expect(parts).toHaveLength(12);
    expect(new Set(parts.map((p) => p.minor))).toEqual(new Set([800_000]));
  });

  it("never loses or invents a cent", () => {
    // $95,000.01 across 12 months does not divide evenly.
    const total = usd(9_500_001);
    const parts = allocate(total, Array(12).fill(1));
    expect(parts.reduce((s, p) => s + p.minor, 0)).toBe(total.minor);
  });

  it("handles the classic 100 / 3 case", () => {
    const parts = allocate(usd(100), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p.minor, 0)).toBe(100);
  });

  it("respects weights", () => {
    const parts = allocate(usd(1000), [3, 1]);
    expect(parts.map((p) => p.minor)).toEqual([750, 250]);
  });

  it("preserves sign for refunds and outflows", () => {
    const parts = allocate(usd(-100), [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p.minor, 0)).toBe(-100);
    expect(parts.every((p) => p.minor <= 0)).toBe(true);
  });

  it("rejects weights that sum to zero", () => {
    expect(() => allocate(usd(100), [0, 0])).toThrow(MoneyError);
  });
});

describe("ratio", () => {
  it("leaves money space and returns a plain number", () => {
    expect(ratio(usd(2500), usd(10_000))).toBe(0.25);
  });

  it("refuses to divide by zero", () => {
    expect(() => ratio(usd(100), usd(0))).toThrow(MoneyError);
  });
});

describe("parsing and formatting", () => {
  it("round-trips a decimal string", () => {
    expect(toDecimalString(fromDecimalString("1234.56", "USD"))).toBe("1234.56");
  });

  it("pads a missing fraction", () => {
    expect(fromDecimalString("42", "USD").minor).toBe(4200);
    expect(fromDecimalString("42.5", "USD").minor).toBe(4250);
  });

  it("strips thousands separators", () => {
    expect(fromDecimalString("1,771,069.76", "USD").minor).toBe(177_106_976);
  });

  it("rejects more precision than the currency supports", () => {
    expect(() => fromDecimalString("1.005", "USD")).toThrow(/precision/);
  });

  it("handles zero-decimal currencies", () => {
    expect(fromDecimalString("500", "JPY").minor).toBe(500);
    expect(toDecimalString(money(500, "JPY"))).toBe("500");
  });

  it("formats for presentation", () => {
    expect(format(usd(177_106_976))).toBe("$1,771,069.76");
    expect(format(usd(177_106_976), { showCents: false })).toBe("$1,771,070");
  });

  it("formats negatives without losing the sign", () => {
    expect(format(usd(-7_160_400))).toBe("-$71,604.00");
  });
});
