import { PRICING } from "./model";

/** Placeholder until billing ships. States limits outright and invents no prices. */
export function PricingPlaceholder() {
  return (
    <section aria-labelledby="pricing-title" className="mt-16">
      <div className="border-b-2 border-rule-strong pb-2">
        <h2 id="pricing-title" className="text-[17px] font-semibold">
          Pricing
        </h2>
      </div>
      <table className="w-full max-w-[880px] text-left" data-testid="pricing">
        <thead className="text-[13px] text-ink-3">
          <tr className="border-b border-rule">
            <th className="py-2 pr-4 font-medium">Plan</th>
            <th className="py-2 pr-4 font-medium">What you get</th>
            <th className="py-2 font-medium">Availability</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-rule align-top">
            <th scope="row" className="py-3 pr-4 font-semibold">Free</th>
            <td className="py-3 pr-4">
              The first {PRICING.free.applications} applications are free. Each one is drafted from your resume and sent on only when you approve it.
            </td>
            <td className="py-3">Available now</td>
          </tr>
          <tr className="border-b border-rule align-top">
            <th scope="row" className="py-3 pr-4 font-semibold">Weekly</th>
            <td className="py-3 pr-4">More applications per week, billed weekly in {PRICING.weekly.currency}.</td>
            <td className="py-3 text-ink-2">{PRICING.weekly.availability}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
