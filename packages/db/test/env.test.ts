import { describe, expect, it } from 'vitest';
import { isLocalUrl } from '../src/env';

describe('isLocalUrl', () => {
  it.each([
    'postgres://hirelane:hirelane@localhost:5433/hirelane',
    'postgres://u:p@127.0.0.1:5433/db',
    'postgres://u:p@[::1]:5433/db',
  ])('accepts %s', (url) => expect(isLocalUrl(url)).toBe(true));

  it.each([
    'postgres://u:x@localhost:1@prod-host/db',
    'postgres://u:p@localhost:5433/db?host=prod.example.com',
    'postgres://u:p@db.prod.internal:5432/db',
    'not a url',
  ])('rejects %s', (url) => expect(isLocalUrl(url)).toBe(false));
});
