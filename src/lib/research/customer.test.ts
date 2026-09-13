import { describe, expect, it, vi } from "vitest";
import { isComplete, normalizeDomain, researchCustomer, safeEvidenceUrl, REGISTRY_DOMAINS } from "./customer";
import type { JudgeDecision } from "./judge";

const subject = { name: "Real Widgets, Inc.", domain: "realwidgets.com", relatedParty: false, isDemo: false };
const hit = (url: string, title = "Real Widgets", content = "Real Widgets builds widgets.", published_date?: string) =>
  ({ url, title, content, ...(published_date ? { published_date } : {}) });

interface Web {
  /** The judgement the mocked OpenAI model returns, or "fail" for an API error. */
  judge?: JudgeDecision | "fail";
  presence?: unknown[];
  answer?: string;
  homepage?: string | null;
  registry?: unknown[];
  news?: unknown[];
  fail?: ("presence" | "extract" | "registry" | "news")[];
}

/** Routes each Tavily call by endpoint and request shape, like the real API would. */
function tavily(web: Web) {
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const body = JSON.parse(init!.body as string);
    const reply = (json: unknown) => new Response(JSON.stringify(json));
    if (String(url) === "https://api.openai.com/v1/responses") {
      if (!web.judge || web.judge === "fail") return new Response("error", { status: 500 });
      return reply({ status: "completed", output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(web.judge) }] },
      ] });
    }
    if (String(url).endsWith("/extract")) {
      if (web.fail?.includes("extract")) return new Response("error", { status: 500 });
      return reply(web.homepage === null || web.homepage === undefined
        ? { results: [], failed_results: [{ url: body.urls[0] }] }
        : { results: [{ url: body.urls[0], raw_content: web.homepage }] });
    }
    if (body.include_domains) {
      if (web.fail?.includes("registry")) return new Response("error", { status: 429 });
      return reply({ results: web.registry ?? [] });
    }
    if (body.topic === "news") {
      if (web.fail?.includes("news")) throw new Error("secret provider detail");
      return reply({ results: web.news ?? [] });
    }
    if (web.fail?.includes("presence")) return reply({ wrong: true });
    return reply({ results: web.presence ?? [], answer: web.answer });
  });
}

const callsTo = (fetcher: ReturnType<typeof tavily>) => fetcher.mock.calls.map(([url, init]) => ({
  url: String(url), body: JSON.parse(init!.body as string),
}));

describe("customer research", () => {
  it("runs website, web presence, registry and news checks in one pass", async () => {
    const fetcher = tavily({
      presence: [hit("https://news.example/story", "Real Widgets funding"), hit("https://realwidgets.com/about")],
      answer: "Real Widgets makes industrial widgets.",
      homepage: "Welcome to Real Widgets — widgets for industry. © 2026 Real Widgets, Inc.",
      registry: [hit("https://opencorporates.com/companies/us_de/123", "REAL WIDGETS, INC. :: Delaware (US)")],
      news: [hit("https://press.example/a", "Real Widgets opens plant", "Real Widgets opened a new plant.", "2026-05-01")],
    });
    const research = await researchCustomer(subject, { apiKey: "secret", fetcher });

    expect(research).toMatchObject({ status: "Verified", provider: "tavily", flags: [], officialDomainMatch: true });
    expect(research.signals).toMatchObject({
      website: { outcome: "found" },
      webPresence: { outcome: "found" },
      registry: { outcome: "found" },
      news: { outcome: "found" },
    });
    expect(research.profile).toEqual({ summary: "Real Widgets makes industrial widgets." });
    expect(research.reason).toContain("registry listing was found");
    expect(research.registration).toContain("not by querying a registry directly");
    expect(research.evidence.map((e) => e.kind)).toEqual(["billing_domain", "supporting"]);
    expect(research.signals!.news.sources[0].publishedDate).toBe("2026-05-01T00:00:00.000Z");
    expect(isComplete(research)).toBe(true);

    const calls = callsTo(fetcher);
    expect(calls).toHaveLength(4);
    expect(calls.find((c) => c.url.endsWith("/extract"))!.body).toMatchObject({ urls: ["https://realwidgets.com"] });
    expect(calls.find((c) => c.body.include_domains)!.body.include_domains).toEqual(REGISTRY_DOMAINS);
    expect(calls.find((c) => c.body.topic === "news")!.body).toMatchObject({ time_range: "year" });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("verifies on the website alone, and names only what matched", async () => {
    const research = await researchCustomer(subject, {
      apiKey: "secret",
      fetcher: tavily({ homepage: "Real Widgets — widgets for industry." }),
    });
    expect(research.status).toBe("Verified");
    expect(research.signals).toMatchObject({ website: { outcome: "found" }, webPresence: { outcome: "not_found" }, registry: { outcome: "not_found" }, news: { outcome: "not_found" } });
    expect(research.reason).toMatch(/^The customer's website names the company\. /);
  });

  it.each(["https://other.com", "https://realwidgets.com.evil.org", "https://notrealwidgets.com"])(
    "doesn't count a same-name business hosted at %s", async (url) => {
      const research = await researchCustomer(subject, { apiKey: "secret", fetcher: tavily({ presence: [hit(url)], homepage: "Coming soon" }) });
      expect(research.status).toBe("Needs review");
      expect(research.signals!.webPresence.outcome).toBe("not_found");
    },
  );

  it("requires the whole name, not a partial word or a bare domain hit", async () => {
    const research = await researchCustomer({ ...subject, name: "Real Widgets Group" }, {
      apiKey: "secret",
      fetcher: tavily({ presence: [hit("https://realwidgets.com", "Domain for sale", "Buy this domain")], homepage: "Widgets and more" }),
    });
    expect(research.status).toBe("Needs review");
  });

  it("flags a parked billing domain", async () => {
    const research = await researchCustomer(subject, {
      apiKey: "secret",
      fetcher: tavily({ homepage: "realwidgets.com — This domain is for sale! Make an offer on this domain." }),
    });
    expect(research).toMatchObject({ status: "Flagged", flags: ["parked_domain"] });
  });

  it("flags no footprint only when every identity check completed empty", async () => {
    const empty = await researchCustomer(subject, { apiKey: "secret", fetcher: tavily({}) });
    expect(empty).toMatchObject({ status: "Flagged", flags: ["no_footprint"], provider: "tavily" });
    expect(empty.reason).toContain("not proof the customer doesn't exist");

    const partial = await researchCustomer(subject, { apiKey: "secret", fetcher: tavily({ fail: ["registry"] }) });
    expect(partial.status).toBe("Needs review");
    expect(partial.flags).toEqual([]);
    expect(isComplete(partial)).toBe(false);
  });

  it("calls out adverse news without changing a verified identity", async () => {
    const research = await researchCustomer(subject, {
      apiKey: "secret",
      fetcher: tavily({
        homepage: "Real Widgets",
        news: [
          hit("https://press.example/b", "Real Widgets opens plant"),
          hit("https://press.example/a", "Real Widgets announces layoffs", "Real Widgets laid off 20% of staff."),
          hit("https://press.example/c", "Unrelated company files for bankruptcy", "Another firm entirely."),
        ],
      }),
    });
    expect(research).toMatchObject({ status: "Verified", flags: ["adverse_news"] });
    expect(research.signals!.news).toMatchObject({ outcome: "attention" });
    expect(research.signals!.news.sources.map((s) => s.title)).toEqual(["Real Widgets announces layoffs", "Real Widgets opens plant"]);
  });

  it("flags related parties and the founder's own domain, and still researches them", async () => {
    const related = await researchCustomer({ ...subject, relatedParty: true }, { apiKey: "secret", fetcher: tavily({ homepage: "Real Widgets" }) });
    expect(related).toMatchObject({ status: "Flagged", flags: ["related_party"] });
    expect(related.signals!.website.outcome).toBe("found");

    const founder = await researchCustomer({ ...subject, founderDomain: "RealWidgets.com" }, { apiKey: "secret", fetcher: tavily({ homepage: "Real Widgets" }) });
    expect(founder).toMatchObject({ status: "Flagged", flags: ["founder_domain"] });
  });

  it("skips domain checks without a company domain and never verifies on name alone", async () => {
    for (const domain of [null, "gmail.com", "invalid/domain"]) {
      const fetcher = tavily({ registry: [hit("https://opencorporates.com/x", "REAL WIDGETS, INC.")] });
      const research = await researchCustomer({ ...subject, domain }, { apiKey: "secret", fetcher });
      expect(research.status).toBe("Needs review");
      expect(research.signals).toMatchObject({ website: { outcome: "skipped" }, webPresence: { outcome: "skipped" }, registry: { outcome: "found" } });
      expect(callsTo(fetcher).some((c) => c.url.endsWith("/extract"))).toBe(false);
    }
  });

  it("reports missing configuration without calling out", async () => {
    const research = await researchCustomer(subject);
    expect(research).toMatchObject({ provider: "unavailable", status: "Needs review" });
    expect(isComplete(research)).toBe(false);
  });

  it("never turns provider failures into negative verdicts or leaks their details", async () => {
    const research = await researchCustomer(subject, { apiKey: "secret", fetcher: tavily({ fail: ["presence", "extract", "registry", "news"] }) });
    expect(research).toMatchObject({ status: "Needs review", provider: "unavailable", flags: [], evidence: [] });
    expect(research.reason).toContain("could not be completed");
    expect(JSON.stringify(research)).not.toContain("secret");
  });

  it("simulates fictional customers from ledger facts, even with live credentials", async () => {
    const fetcher = tavily({});
    const demo = { ...subject, isDemo: true };
    const invoiced = await researchCustomer({ ...demo, invoiced: true }, { apiKey: "secret", fetcher });
    expect(invoiced).toMatchObject({ provider: "simulated", status: "Verified", evidence: [] });
    expect(invoiced.signals!.website.detail).toMatch(/^Simulated/);

    const uninvoiced = await researchCustomer({ ...demo, invoiced: false }, { apiKey: "secret", fetcher });
    expect(uninvoiced).toMatchObject({ status: "Flagged", flags: ["no_footprint"] });

    const overdue = await researchCustomer({ ...demo, invoiced: true, overdueInvoice: true }, { apiKey: "secret", fetcher });
    expect(overdue).toMatchObject({ status: "Verified", flags: ["adverse_news"] });

    expect((await researchCustomer({ ...demo, relatedParty: true })).status).toBe("Flagged");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discards unsafe source URLs and normalizes domains", async () => {
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceUrl("https://user:pass@example.com")).toBeNull();
    expect(normalizeDomain(" WWW.Example.com ")).toBe("example.com");
    const research = await researchCustomer(subject, { apiKey: "secret", fetcher: tavily({ presence: [hit("javascript:alert(1)")] }) });
    expect(research.evidence).toEqual([]);
  });

  describe("with an OpenAI judge", () => {
    const openai = { apiKey: "openai-secret", model: "gpt-5.6-sol" };
    const web = {
      presence: [hit("https://realwidgets.com/about", "About us", "Real Widgets makes widgets for factories.")],
      homepage: "Real Widgets. Industrial widgets since 1998.",
      registry: [
        hit("https://find-and-update.company-information.service.gov.uk/company/1", "REAL WIDGETS LTD overview", "United Kingdom company."),
        hit("https://opencorporates.com/companies/us_de/2", "REAL WIDGETS, INC. :: Delaware (US)", "Delaware corporation."),
      ],
      news: [
        hit("https://press.example/a", "Real Widgets wins patent lawsuit", "Real Widgets won its case."),
        hit("https://press.example/b", "Real Widgets bakery closes", "A bakery in Ohio named Real Widgets shut down."),
      ],
    };
    const decision: JudgeDecision = {
      website: { verdict: "names_company", quote: "Real Widgets. Industrial widgets", reasoning: "The homepage is branded Real Widgets." },
      webPresence: { verdict: "confirms", source: 1, quote: "Real Widgets makes widgets", reasoning: "The about page on the domain names it." },
      registry: { verdict: "same_entity", source: 2, reasoning: "The Delaware Inc. matches; the UK Ltd is a different entity." },
      news: { items: [
        { source: 1, about_customer: true, adverse: false, reasoning: "A lawsuit the company won isn't adverse." },
        { source: 2, about_customer: false, adverse: true, reasoning: "A same-name bakery, not this company." },
      ] },
    };

    it("uses the model's judgement where string rules would be wrong", async () => {
      const fetcher = tavily({ ...web, judge: decision });
      const research = await researchCustomer(subject, { apiKey: "secret", openai, fetcher });
      expect(research).toMatchObject({ status: "Verified", flags: [], judge: { provider: "openai", model: "gpt-5.6-sol" } });
      // The Delaware entity, not the UK one the name rule would also accept.
      expect(research.signals!.registry.sources.map((s) => s.sourceDomain)).toEqual(["opencorporates.com"]);
      // Rules would call "lawsuit" adverse and count the bakery; the judge does neither.
      expect(research.signals!.news).toMatchObject({ outcome: "found" });
      expect(research.signals!.news.sources.map((s) => s.title)).toEqual(["Real Widgets wins patent lawsuit"]);
      expect(research.signals!.website.reasoning).toBe("The homepage is branded Real Widgets.");
      expect(isComplete(research)).toBe(true);

      const judgeCall = fetcher.mock.calls.find(([url]) => String(url).includes("openai"))!;
      const body = JSON.parse(judgeCall[1]!.body as string);
      expect(body).toMatchObject({ model: "gpt-5.6-sol", store: false, reasoning: { effort: "low" }, text: { format: { type: "json_schema", strict: true } } });
      expect(judgeCall[1]!.headers).toMatchObject({ Authorization: "Bearer openai-secret" });
      expect(body.input[1].content).toContain("BILLING DOMAIN: realwidgets.com");
      expect(body.input[1].content).toContain("REAL WIDGETS, INC. :: Delaware (US)");
    });

    it("doesn't count an invented quote or a source off the billing domain", async () => {
      const research = await researchCustomer(subject, {
        apiKey: "secret", openai,
        fetcher: tavily({
          ...web,
          presence: [hit("https://reviews.example/real-widgets", "Real Widgets review"), ...web.presence],
          judge: {
            ...decision,
            website: { verdict: "names_company", quote: "Welcome to Real Widgets Inc", reasoning: "Branded." },
            webPresence: { verdict: "confirms", source: 2, quote: "Real Widgets review", reasoning: "A review names it." },
          },
        }),
      });
      expect(research.signals!.website).toMatchObject({ outcome: "not_found" });
      expect(research.signals!.website.reasoning).toContain("isn't in the source");
      expect(research.signals!.webPresence).toMatchObject({ outcome: "not_found" });
      expect(research.signals!.webPresence.reasoning).toContain("isn't on the billing domain");
      expect(research.status).toBe("Needs review");
    });

    it("reports a different registry entity as no listing", async () => {
      const research = await researchCustomer(subject, {
        apiKey: "secret", openai,
        fetcher: tavily({ ...web, judge: { ...decision, registry: { verdict: "different_entity", source: 1, reasoning: "UK Ltd, not the US Inc." } } }),
      });
      expect(research.signals!.registry).toMatchObject({ outcome: "not_found", reasoning: "UK Ltd, not the US Inc." });
      expect(research.signals!.registry.detail).toContain("different entity");
      expect(research.registration).toContain("different entity");
    });

    it("falls back to string rules when the model fails, and isn't cached", async () => {
      const research = await researchCustomer(subject, { apiKey: "secret", openai, fetcher: tavily({ ...web, judge: "fail" }) });
      expect(research.judge).toEqual({ provider: "rules", fallback: true });
      expect(research.status).toBe("Verified");
      // The rules still see "lawsuit" as adverse — the reason the judge exists.
      expect(research.flags).toContain("adverse_news");
      expect(isComplete(research)).toBe(false);
      expect(JSON.stringify(research)).not.toContain("openai-secret");
    });

    it("isn't consulted for fictional customers", async () => {
      const fetcher = tavily({ judge: decision });
      const research = await researchCustomer({ ...subject, isDemo: true, invoiced: true }, { apiKey: "secret", openai, fetcher });
      expect(research.provider).toBe("simulated");
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
