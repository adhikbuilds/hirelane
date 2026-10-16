import { headers } from "next/headers";
import { currencyFor } from "../../landing/pricing-model";
import { Chapter, H2, LEAD } from "./chapter";
import { PricingCards } from "./pricing-cards";
import { Reveal } from "./reveal";

/** Chapter 7, the offer. INR or USD comes from Accept-Language; the visitor can switch. */
export async function Pricing() {
  const h = await headers();
  return (
    <Chapter id="pricing" chapter="Offer" label="Pricing">
      <Reveal className="max-w-[640px]">
        <h2 className={H2}>Pay for what you send.</h2>
        <p className={`${LEAD} mt-5`}>Planned prices. Checkout opens soon.</p>
      </Reveal>
      <Reveal index={1} className="mt-10">
        <PricingCards initialCurrency={currencyFor(h.get("accept-language"))} />
      </Reveal>
    </Chapter>
  );
}
