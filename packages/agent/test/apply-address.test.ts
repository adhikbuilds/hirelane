import { describe, expect, it } from 'vitest';
import { applyAddressOf } from '../src/index';

describe('applyAddressOf', () => {
  it('carries the reply handle as the +tag so replies reach the address inbound:scan accepts', () => {
    expect(applyAddressOf({ handle: 'Asha.K3X', replyHandle: 'AbC123', domain: 'Apply.Hirelane.in' })).toBe('asha.k3x+abc123@apply.hirelane.in');
  });
});
