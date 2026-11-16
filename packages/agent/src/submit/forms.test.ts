import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FormParseError } from './types';
import { readAshby, readFormSpec, readGreenhouse, readLever } from './forms';

const fx = (n: string): string => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8');
const byId = (spec: { fields: { id: string }[] }, id: string) => spec.fields.find((f) => f.id === id);

// The fixtures are SYNTHETIC (shape unverified against the live services).
describe('Greenhouse reader', () => {
  const spec = readGreenhouse(fx('greenhouse-form.json'));
  it('maps questions to typed fields with required flags', () => {
    expect(spec.platform).toBe('greenhouse');
    expect(byId(spec, 'first_name')).toMatchObject({ label: 'First Name', kind: 'text', required: true });
    expect(byId(spec, 'email')).toMatchObject({ kind: 'email', required: true });
    expect(byId(spec, 'phone')).toMatchObject({ kind: 'phone', required: false });
    expect(byId(spec, 'resume')).toMatchObject({ kind: 'file', fileRole: 'resume', required: true });
    expect(byId(spec, 'question_1001')).toMatchObject({ kind: 'url', required: false });
    expect(byId(spec, 'question_1003')).toMatchObject({ kind: 'boolean', options: [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }] });
  });
  it('never reads the voluntary self-identification section', () => {
    expect(byId(spec, 'gender')).toBeUndefined();
    expect(spec.block).toBeNull();
  });
  it('flags a CAPTCHA field', () => {
    expect(readGreenhouse(fx('greenhouse-form-captcha.json')).block).toBe('captcha');
  });
  it('refuses what it cannot read instead of guessing', () => {
    expect(() => readGreenhouse('not json')).toThrow(FormParseError);
    expect(() => readGreenhouse('{"questions":[]}')).toThrow(FormParseError);
    expect(() => readGreenhouse('{"questions":[{"label":"x","fields":[{"name":"a","type":"hologram"}]}]}')).toThrow(FormParseError);
    expect(() => readGreenhouse('[]')).toThrow(FormParseError);
  });
});

describe('Ashby reader', () => {
  const spec = readAshby(fx('ashby-form.json'));
  it('maps system and custom fields', () => {
    expect(byId(spec, '_systemfield_name')).toMatchObject({ kind: 'text', required: true, label: 'Name' });
    expect(byId(spec, '_systemfield_email')).toMatchObject({ kind: 'email' });
    expect(byId(spec, '_systemfield_resume')).toMatchObject({ kind: 'file', fileRole: 'resume' });
    expect(byId(spec, 'phone_field')).toMatchObject({ kind: 'phone', required: false });
    expect(byId(spec, 'graduation_year')).toMatchObject({ kind: 'number' });
    expect(byId(spec, 'notice_field')).toMatchObject({ kind: 'select', options: [{ label: 'Immediately', value: 'imm' }, { label: '15 days', value: '15d' }, { label: '30 days', value: '30d' }] });
    expect(byId(spec, 'relocate_field')).toMatchObject({ kind: 'boolean', required: false });
  });
  it('flags a CAPTCHA and refuses unreadable forms', () => {
    expect(readAshby(fx('ashby-form-captcha.json')).block).toBe('captcha');
    expect(() => readAshby('{}')).toThrow(FormParseError);
    expect(() => readAshby('{"formDefinition":{"sections":[{"fields":[{"field":{"path":"x","type":"Hologram"}}]}]}}')).toThrow(FormParseError);
  });
});

describe('Lever reader', () => {
  const spec = readLever(fx('lever-form.html'));
  it('reads labels, kinds and required flags from the markup', () => {
    expect(byId(spec, 'name')).toMatchObject({ label: 'Full name', kind: 'text', required: true });
    expect(byId(spec, 'email')).toMatchObject({ kind: 'email', required: true });
    expect(byId(spec, 'phone')).toMatchObject({ kind: 'phone', required: false });
    expect(byId(spec, 'resume')).toMatchObject({ kind: 'file', fileRole: 'resume', required: true });
    expect(byId(spec, 'urls[LinkedIn]')).toMatchObject({ label: 'LinkedIn URL', kind: 'url', required: false });
    expect(byId(spec, 'cards[grad][field0]')).toMatchObject({ label: 'Graduation year', required: true });
    expect(byId(spec, 'comments')).toMatchObject({ label: 'Additional information', kind: 'textarea', required: false });
  });
  it('groups radios into one select and keeps real options only', () => {
    expect(byId(spec, 'cards[reloc][field0]')).toMatchObject({ label: 'Are you willing to relocate?', kind: 'select', required: true, options: [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }] });
    expect(byId(spec, 'cards[notice][field0]')).toMatchObject({ kind: 'select', options: [{ label: 'Immediately', value: 'Immediately' }, { label: '30 days', value: '30 days' }] });
  });
  it('ignores hidden inputs, buttons, scripts and styles', () => {
    expect(byId(spec, 'csrf')).toBeUndefined();
    expect(byId(spec, 'ghost')).toBeUndefined();
    expect(spec.fields.every((f) => f.kind !== 'captcha')).toBe(true);
    expect(spec.block).toBeNull();
  });
  it('sees a CAPTCHA widget and a login wall', () => {
    expect(readLever(fx('lever-form-captcha.html')).block).toBe('captcha');
    expect(readLever(fx('lever-form-login.html')).block).toBe('login');
  });
  it('refuses a page with no form', () => {
    expect(() => readLever('<html><p>Hello</p></html>')).toThrow(FormParseError);
  });
  it('decodes entities in labels', () => {
    const s = readLever('<label for="a">R&amp;D &#39;team&#39; &#10033;</label><input id="a" name="a">');
    expect(s.fields[0]).toMatchObject({ label: "R&D 'team'", required: true });
  });
});

describe('readFormSpec', () => {
  it('dispatches by platform', () => {
    expect(readFormSpec('lever', fx('lever-form.html')).platform).toBe('lever');
    expect(readFormSpec('ashby', fx('ashby-form.json')).platform).toBe('ashby');
    expect(readFormSpec('greenhouse', fx('greenhouse-form.json')).platform).toBe('greenhouse');
    expect(() => readFormSpec('workday' as never, '')).toThrow(FormParseError);
  });
});
