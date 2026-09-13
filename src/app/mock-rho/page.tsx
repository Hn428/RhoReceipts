import { redirect } from "next/navigation";

import { mockCompanies } from "@/lib/rho/mock/store";

export default function MockRhoIndex() {
  redirect(`/mock-rho/${mockCompanies[0].meta.slug}`);
}
