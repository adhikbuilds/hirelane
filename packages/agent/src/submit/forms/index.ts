import { FormParseError, type FormSpec, type Platform } from '../types';
import { readAshby } from './ashby';
import { readGreenhouse } from './greenhouse';
import { readLever } from './lever';

export { readAshby, readGreenhouse, readLever };

/** The reader for a platform. Throws FormParseError when the form is not one it understands. */
export function readFormSpec(platform: Platform, body: string): FormSpec {
  switch (platform) {
    case 'greenhouse':
      return readGreenhouse(body);
    case 'lever':
      return readLever(body);
    case 'ashby':
      return readAshby(body);
    default:
      throw new FormParseError('unknown platform');
  }
}
