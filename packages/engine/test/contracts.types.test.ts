import { describe, expectTypeOf, it } from 'vitest';
import type { SensitiveFinding, HealthCheckId, TextLayer, ExtractMeta } from '../src/resume/types';
import type { Criterion, EligibilityProfileInput } from '../src/eligibility/types';

describe('slice 1 contracts', () => {
  it('SensitiveFinding has no value field', () => {
    expectTypeOf<keyof SensitiveFinding>().toEqualTypeOf<'kind' | 'start' | 'end' | 'severity'>();
  });
  it('has nine health check ids and four text layers', () => {
    expectTypeOf<HealthCheckId>().toMatchTypeOf<string>();
    expectTypeOf<TextLayer>().toEqualTypeOf<'readable' | 'partial' | 'none' | 'garbled'>();
  });
  it('criterion is discriminated and profile requires confirmed', () => {
    expectTypeOf<Criterion['type']>().toMatchTypeOf<string>();
    expectTypeOf<EligibilityProfileInput['confirmed']>().toEqualTypeOf<true>();
    expectTypeOf<ExtractMeta['pages']>().toEqualTypeOf<number | null>();
  });
});
