export type Ats = 'greenhouse' | 'lever' | 'ashby';
/** ISO 3166-1 alpha-2, uppercase. Validated against data/places.json. */
export type CountryCode = string;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
