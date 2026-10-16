import { headers } from "next/headers";
import { currencyFor } from "../../landing/pricing-model";
import { PricingPanel } from "./pricing-panel";

/** The pricing panel, with INR or USD chosen from Accept-Language like v2. */
export async function Pricing() {
  const h = await headers();
  return <PricingPanel initialCurrency={currencyFor(h.get("accept-language"))} />;
}
