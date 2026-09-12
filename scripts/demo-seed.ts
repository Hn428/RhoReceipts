import { writeFileSync } from "node:fs";
import { seedDemo } from "../src/lib/demo/seed";

async function main() {
  const result = await seedDemo(process.env.APP_URL!);
  writeFileSync(".demo/manifest.json", JSON.stringify(result, null, 2));
  console.log("Demo ready: all company data and customer research are simulated.");
  console.table(result.map(({ company, email, receipt, report }) => ({ company, "Founder sign-in": email, receipt, report })));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
