/** India detection for structured locations (city / state / country). Pure. */

export interface StructuredLocation {
  city?: string | undefined;
  region?: string | undefined;
  country?: string | undefined;
  /** Free-text address when the source gave no structure. */
  text?: string | undefined;
}

export type IndiaReason = 'country' | 'city' | 'state' | 'text';
export interface IndiaDetection {
  isIndia: boolean;
  reason?: IndiaReason;
}

export const INDIA_CITIES: readonly string[] = [
  'bengaluru', 'bangalore', 'mumbai', 'navi mumbai', 'thane', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'greater noida',
  'ghaziabad', 'faridabad', 'hyderabad', 'secunderabad', 'pune', 'chennai', 'kolkata', 'ahmedabad', 'gandhinagar', 'jaipur', 'kochi',
  'cochin', 'chandigarh', 'mohali', 'panchkula', 'indore', 'bhopal', 'coimbatore', 'thiruvananthapuram', 'trivandrum', 'bhubaneswar',
  'lucknow', 'kanpur', 'nagpur', 'vadodara', 'baroda', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubli', 'hubballi', 'belagavi',
  'surat', 'visakhapatnam', 'vizag', 'vijayawada', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'kozhikode', 'calicut', 'thrissur',
  'patna', 'ranchi', 'jamshedpur', 'raipur', 'guwahati', 'dehradun', 'nashik', 'aurangabad', 'rajkot', 'jodhpur', 'udaipur', 'agra',
  'varanasi', 'amritsar', 'ludhiana', 'jalandhar', 'bhilai', 'pimpri', 'chinchwad', 'kharghar', 'vapi', 'goa', 'panaji',
  'puducherry', 'pondicherry', 'shillong', 'siliguri', 'durgapur', 'cuttack', 'warangal', 'tirupati', 'nellore', 'kakinada',
];

export const INDIA_STATES: readonly string[] = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand',
  'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal', 'andaman and nicobar',
  'chandigarh', 'dadra and nagar haveli', 'daman and diu', 'delhi', 'nct of delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep', 'puducherry',
];

const alt = (xs: readonly string[]): RegExp => new RegExp(`\\b(?:${xs.map((x) => x.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const CITY_RE = alt(INDIA_CITIES);
const STATE_RE = alt(INDIA_STATES);
const COUNTRY_IN = new Set(['in', 'ind', 'india', 'bharat', 'republic of india']);
const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase();

/** True for an India country code or name. A bare "IN" is only ever passed here as a country, never a region (Indiana). */
export const isIndiaCountry = (c: string | undefined): boolean => COUNTRY_IN.has(norm(c));
export const isIndiaCity = (c: string | undefined): boolean => !!c && CITY_RE.test(c);
export const isIndiaState = (r: string | undefined): boolean => !!r && STATE_RE.test(r);
export const mentionsIndia = (t: string | undefined): boolean => !!t && (/\bindia\b/i.test(t) || CITY_RE.test(t));

/**
 * Country wins: a stated non-India country is never India ("Mumbai, US" is not). Without a country, a known Indian city
 * then a known Indian state decide. A bare "IN" region is never read as India (Indiana).
 */
export function detectIndia(locs: readonly StructuredLocation[]): IndiaDetection {
  let best: IndiaDetection = { isIndia: false };
  const rank: Record<IndiaReason, number> = { country: 4, city: 3, state: 2, text: 1 };
  for (const l of locs) {
    let hit: IndiaReason | null = null;
    if (norm(l.country) !== '') {
      if (isIndiaCountry(l.country)) hit = 'country';
    } else if (isIndiaCity(l.city)) hit = 'city';
    else if (isIndiaState(l.region)) hit = 'state';
    else if (mentionsIndia(l.text)) hit = 'text';
    if (hit && (!best.reason || rank[hit] > rank[best.reason])) best = { isIndia: true, reason: hit };
  }
  return best;
}
