import { describe, expect, it } from "vitest";

import { companyByName, listedCompanies, mockCompanies } from "./store";

describe("sample companies", () => {
  it("finds a company from a connection label or seeded name", () => {
    expect(companyByName("Quiverleaf AI")?.meta.slug).toBe("quiverleaf-ai");
    expect(companyByName("Acme AI, Inc. (mock)")?.meta.slug).toBe("acme-ai");
    expect(companyByName("Some Real Bank Customer")).toBeNull();
  });

  it("lists only one-click samples; token-only companies connect by token", () => {
    expect(listedCompanies.map((c) => c.meta.slug)).toEqual(["acme-ai", "northstar-labs"]);
    expect(mockCompanies.filter((c) => c.meta.token_only).map((c) => c.meta.slug))
      .toEqual(["quiverleaf-ai", "lanternfish-analytics"]);
    // A token-only company's token must pass the enroll form's format check.
    for (const company of mockCompanies.filter((c) => c.meta.token_only)) {
      expect(company.meta.mock_token).toMatch(/^rhobat_[A-Za-z0-9_]{16,}$/);
    }
  });

  it("marks only the companies whose customers are real businesses", () => {
    expect(mockCompanies.filter((c) => c.meta.real_customers).map((c) => c.meta.slug))
      .toEqual(["quiverleaf-ai", "lanternfish-analytics"]);
    // Real-customer companies need company domains, or live research has nothing to check.
    for (const company of mockCompanies.filter((c) => c.meta.real_customers)) {
      expect(company.customers.every((customer) => /@[a-z0-9-]+\.[a-z.]+$/.test(customer.email ?? ""))).toBe(true);
    }
  });
});
