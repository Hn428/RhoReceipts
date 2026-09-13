import { writeFileSync } from "node:fs";
import { seedDemo } from "../src/lib/demo/seed";

async function main() {
  // Vendor checks run live when a Tavily key is available; customers are always simulated.
  const result = await seedDemo(process.env.APP_URL!, { liveResearch: Boolean(process.env.TAVILY_API_KEY) });
  writeFileSync(".demo/manifest.json", JSON.stringify(result, null, 2));
  console.log(`Demo ready: company data and customer research are simulated. Vendor web checks ${process.env.TAVILY_API_KEY ? "ran live through Tavily" : "are off (no TAVILY_API_KEY)"}.`);
  console.table(result.map(({ company, email, receipt, report }) => ({ company, "Founder sign-in": email, receipt, report })));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
