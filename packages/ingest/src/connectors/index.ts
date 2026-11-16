import type { Ats, Connector } from '../contract';
import { ashby } from './ashby';
import { greenhouse } from './greenhouse';
import { lever } from './lever';
import { jsonld } from '../jsonld/connector';
import { zohoRss } from '../zoho/rss';

export { ashby, greenhouse, jsonld, lever, zohoRss };
export { toIsoUtc, decodeEntitiesOnce, TOKEN_RE } from './shared';

export const connectors: Record<Ats, Connector> = { greenhouse, lever, ashby, jsonld, zoho_rss: zohoRss };
