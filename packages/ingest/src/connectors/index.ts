import type { Ats, Connector } from '../contract';
import { ashby } from './ashby';
import { greenhouse } from './greenhouse';
import { lever } from './lever';

export { ashby, greenhouse, lever };
export { toIsoUtc, decodeEntitiesOnce, TOKEN_RE } from './shared';

export const connectors: Record<Ats, Connector> = { greenhouse, lever, ashby };
