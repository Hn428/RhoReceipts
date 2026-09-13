import { describe, expect, it, vi } from "vitest";

import { coreName, nameAppears, vendorNameAppears } from "./match";
import { researchVendor } from "./vendor";
import { summarizeCoverage } from "./coverage";
import type { CustomerResearch } from "./customer";
import { money } from "@/lib/money";

const reply = (json: unknown) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(json)));

describe("name matching", () => {
  it("strips legal suffixes and punctuation", () => {
    expect(coreName("Tessellate Health, Inc.")).toBe("tessellate health");
    expect(coreName("Quill & Stone LLC")).toBe("quill and stone");
    expect(coreName("Inc")).toBe("inc");
    expect(coreName("Anthropic PBC")).toBe("anthropic");
    expect(coreName("Vasquez Annotation SRL")).toBe("vasquez annotation");
    expect(nameAppears("© 2026 TESSELLATE HEALTH. All rights reserved", "Tessellate Health, Inc.")).toBe(true);
    expect(nameAppears("Tessellated Health Partners", "Tessellate Health, Inc.")).toBe(false);
  });

  it("matches vendors on their distinctive words", () => {
    expect(vendorNameAppears("Gusto | Online payroll for small businesses", "Gusto Payroll")).toBe(true);
    expect(vendorNameAppears("Amazon Web Services (AWS) cloud computing", "Amazon Web Services")).toBe(true);
    expect(vendorNameAppears("Lambda: the GPU cloud for AI", "Lambda GPU Cloud")).toBe(true);
    expect(vendorNameAppears("Payroll software reviews", "Gusto Payroll")).toBe(false);
  });
});

describe("vendor research", () => {
  it("finds a public footprint and keeps only results that name the vendor", async () => {
    const research = await researchVendor("Gusto Payroll", {
      apiKey: "secret",
      fetcher: reply({
        answer: "Gusto is a payroll and HR platform.",
        results: [
          { title: "Gusto: Payroll, HR, Benefits", url: "https://gusto.com", content: "Gusto payroll." },
          { title: "Best payroll apps", url: "https://reviews.example", content: "A list." },
          { title: "Bad", url: "javascript:alert(1)", content: "Gusto" },
        ],
      }),
    });
    expect(research).toMatchObject({ provider: "tavily", outcome: "found", summary: "Gusto is a payroll and HR platform." });
    expect(research.sources.map((s) => s.sourceDomain)).toEqual(["gusto.com"]);
    expect(research.detail).toContain("doesn't confirm it's the same business");
  });

  it("reports no footprint, and never a verdict from a failure", async () => {
    expect((await researchVendor("Mission Street Studios", { apiKey: "secret", fetcher: reply({ results: [] }) })).outcome).toBe("not_found");
    expect((await researchVendor("AWS")).outcome).toBe("unavailable");
    const failed = await researchVendor("AWS", { apiKey: "secret", fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("secret")) });
    expect(failed).toMatchObject({ provider: "unavailable", outcome: "unavailable" });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });
});

describe("research coverage", () => {
  const usd = (dollars: number) => money(dollars * 100, "USD");
  const result = (status: CustomerResearch["status"], extra: Partial<CustomerResearch> = {}) =>
    ({ status, provider: "tavily", checkedAt: "", domain: null, reason: "", registration: "", evidence: [], ...extra }) as CustomerResearch;

  it("splits the month's revenue by research status", () => {
    const coverage = summarizeCoverage([
      { customerId: "a", customerName: "A", amount: usd(600), transactionIds: [], attribution: "invoice" },
      { customerId: "b", customerName: "B", amount: usd(200), transactionIds: [], attribution: "invoice" },
      { customerId: "c", customerName: "C", amount: usd(100), transactionIds: [], attribution: "name_match" },
      { customerId: null, customerName: "Stripe payouts", amount: usd(100), transactionIds: [], attribution: "aggregated" },
    ], {
      a: result("Verified", { flags: ["adverse_news"] }),
      b: result("Needs review"),
      c: result("Flagged", { provider: "simulated" }),
    }, "USD");
    expect(coverage).toMatchObject({
      total: usd(1000), verified: usd(600), needsReview: usd(200), flagged: usd(100), unresearched: usd(100),
      verifiedShare: 0.6, shares: { verified: 0.6, needsReview: 0.2, flagged: 0.1, unresearched: 0.1 }, simulated: true,
      counts: { verified: 1, needsReview: 1, flagged: 1, adverseNews: 1 },
    });
    expect(summarizeCoverage([], {}, "USD").verifiedShare).toBeNull();
  });
});
