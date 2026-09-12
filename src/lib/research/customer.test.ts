import { describe, expect, it, vi } from "vitest";
import { normalizeDomain, researchCustomer, safeEvidenceUrl } from "./customer";

const subject = { name: "Real Widgets, Inc.", domain: "realwidgets.com", relatedParty: false, isDemo: false };
const result = (url = "https://realwidgets.com/about", title = "Real Widgets") => ({ url, title, content: "Real Widgets builds widgets." });
const fetcherFor = (results: unknown[]) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results })));

describe("customer research", () => {
  it("simulates fictional customers even with live credentials", async () => {
    const fetcher = fetcherFor([]);
    const research = await researchCustomer({ ...subject, isDemo: true }, { apiKey: "secret", fetcher });
    expect(research).toMatchObject({ provider: "simulated", status: "Verified", evidence: [] });
    expect(research.reason).toContain("fictional");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("flags related parties ahead of any web match", async () => {
    const fetcher = fetcherFor([result()]);
    expect((await researchCustomer({ ...subject, relatedParty: true }, { apiKey: "secret", fetcher })).status).toBe("Flagged");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await researchCustomer({ ...subject, isDemo: true, relatedParty: true })).status).toBe("Flagged");
  });
  it("requires a key and company-specific domain", async () => {
    const fetcher = fetcherFor([]);
    for (const domain of [null, "gmail.com", "invalid/domain"]) {
      expect((await researchCustomer({ ...subject, domain }, { apiKey: "secret", fetcher })).status).toBe("Needs review");
    }
    expect((await researchCustomer(subject)).provider).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("verifies matching name on billing domain and retains evidence", async () => {
    const fetcher = fetcherFor([
      result("https://news.example/story", "Real Widgets funding"),
      result(),
    ]);
    const research = await researchCustomer(subject, { apiKey: "secret", fetcher });
    expect(research.status).toBe("Verified");
    expect(research.officialDomainMatch).toBe(true);
    expect(research.evidence).toHaveLength(2);
    expect(research.evidence.map(({ kind, sourceDomain }) => ({ kind, sourceDomain }))).toEqual([
      { kind: "billing_domain", sourceDomain: "realwidgets.com" },
      { kind: "supporting", sourceDomain: "news.example" },
    ]);
    expect(research.registration).toContain("not been independently confirmed");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(init?.body as string)).toMatchObject({ include_answer: false });
  });
  it.each(["https://other.com", "https://realwidgets.com.evil.org", "https://notrealwidgets.com"])("rejects same-name businesses at %s", async (url) => {
    expect((await researchCustomer(subject, { apiKey: "secret", fetcher: fetcherFor([result(url)]) })).status).toBe("Needs review");
  });
  it("requires the name, not just a domain hit", async () => {
    const fetcher = fetcherFor([{ ...result(), title: "Domain for sale", content: "Buy this domain" }]);
    expect(await researchCustomer(subject, { apiKey: "secret", fetcher })).toMatchObject({
      status: "Needs review", officialDomainMatch: false,
      evidence: [{ kind: "billing_domain", sourceDomain: "realwidgets.com" }],
    });
  });
  it("flags a completed empty search without claiming nonexistence", async () => {
    expect(await researchCustomer(subject, { apiKey: "secret", fetcher: fetcherFor([]) })).toMatchObject({ status: "Flagged", provider: "tavily" });
  });
  it("does not turn provider failures into negative verdicts", async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error("secret provider detail")),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("error", { status: 429 })),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{"wrong":true}')),
    ]) {
      const research = await researchCustomer(subject, { apiKey: "secret", fetcher });
      expect(research).toMatchObject({ status: "Needs review", provider: "unavailable", evidence: [] });
      expect(JSON.stringify(research)).not.toContain("secret");
    }
  });
  it("discards unsafe source URLs and normalizes domains", async () => {
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeDomain(" WWW.Example.com ")).toBe("example.com");
    expect((await researchCustomer(subject, { apiKey: "secret", fetcher: fetcherFor([result("javascript:alert(1)")]) })).evidence).toEqual([]);
  });
});
