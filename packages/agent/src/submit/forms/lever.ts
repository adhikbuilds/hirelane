import { FormParseError, type FieldOption, type FormField, type FormSpec } from '../types';
import { detectBlockInBody } from '../challenge';
import { cleanLabel, looksRequired, tokenize, type Tok } from '../html';
import { fileRole, textKind } from './common';

/**
 * Reads a Lever application form from its HTML: input, textarea and select controls with the label that precedes them.
 * SYNTHETIC fixtures stand in for recorded ones, so the markup is unverified against the live service.
 * Hidden inputs and buttons are ignored. A password input is a login wall (block = login).
 */
export function readLever(body: string): FormSpec {
  const toks = tokenize(body);
  // <label for="x">text</label> and wrapping labels.
  const labelFor = new Map<string, string>();
  const wrapped = new Map<number, string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.type !== 'open' || t.tag !== 'label') continue;
    let text = '';
    let j = i + 1;
    const inner: number[] = [];
    for (; j < toks.length && !(toks[j]!.type === 'close' && toks[j]!.tag === 'label'); j++) {
      const u = toks[j]!;
      if (u.type === 'text') text += ` ${u.text}`;
      if (u.type === 'open' && ['input', 'textarea', 'select'].includes(u.tag)) inner.push(j);
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (t.attrs['for']) labelFor.set(t.attrs['for'], text);
    for (const k of inner) wrapped.set(k, text);
  }

  const fields: FormField[] = [];
  const radios = new Map<string, { field: FormField; at: number }>();
  let lastText = '';
  let sawPassword = false;
  const labelOf = (t: Tok, i: number): string => t.attrs['aria-label'] || labelFor.get(t.attrs['id'] ?? '\0') || wrapped.get(i) || t.attrs['placeholder'] || lastText;
  const requiredOf = (t: Tok, raw: string): boolean => 'required' in t.attrs || t.attrs['aria-required'] === 'true' || /\brequired\b/.test(t.attrs['class'] ?? '') || looksRequired(raw);

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.type === 'text') {
      lastText = t.text;
      continue;
    }
    if (t.type !== 'open') continue;
    if (t.tag === 'input') {
      const type = (t.attrs['type'] ?? 'text').toLowerCase();
      const name = t.attrs['name'] ?? '';
      if (type === 'password') sawPassword = true;
      if (['hidden', 'submit', 'button', 'reset', 'image', 'password'].includes(type) || !name) continue;
      if (type === 'radio') {
        const have = radios.get(name);
        const optLabel = wrapped.get(i) || labelFor.get(t.attrs['id'] ?? '\0') || t.attrs['value'] || '';
        const opt: FieldOption = { label: optLabel, value: t.attrs['value'] ?? optLabel };
        if (have) have.field.options!.push(opt);
        else {
          const f: FormField = { id: name, label: cleanLabel(lastText), kind: 'select', required: requiredOf(t, lastText), options: [opt] };
          radios.set(name, { field: f, at: i });
          fields.push(f);
        }
        continue;
      }
      const raw = labelOf(t, i);
      const label = cleanLabel(raw);
      const required = requiredOf(t, raw) || requiredOf(t, lastText);
      if (type === 'file') fields.push({ id: name, label, kind: 'file', required, fileRole: fileRole(name, label) });
      else if (type === 'checkbox') fields.push({ id: name, label, kind: 'boolean', required });
      else if (type === 'email') fields.push({ id: name, label, kind: 'email', required });
      else if (type === 'tel') fields.push({ id: name, label, kind: 'phone', required });
      else if (type === 'url') fields.push({ id: name, label, kind: 'url', required });
      else if (type === 'number') fields.push({ id: name, label, kind: 'number', required });
      else fields.push({ id: name, label, kind: textKind(name, label), required });
    } else if (t.tag === 'textarea') {
      const name = t.attrs['name'] ?? '';
      if (!name) continue;
      const raw = labelOf(t, i);
      fields.push({ id: name, label: cleanLabel(raw), kind: 'textarea', required: requiredOf(t, raw) || requiredOf(t, lastText) });
    } else if (t.tag === 'select') {
      const name = t.attrs['name'] ?? '';
      const options: FieldOption[] = [];
      let j = i + 1;
      for (; j < toks.length && !(toks[j]!.type === 'close' && toks[j]!.tag === 'select'); j++) {
        const o = toks[j]!;
        if (o.type === 'open' && o.tag === 'option') {
          const next = toks[j + 1];
          const text = next && next.type === 'text' ? next.text : '';
          const value = o.attrs['value'] ?? text;
          if (value !== '') options.push({ label: text || value, value });
        }
      }
      if (!name) continue;
      const raw = labelOf(t, i);
      fields.push({ id: name, label: cleanLabel(raw), kind: 'select', required: requiredOf(t, raw) || requiredOf(t, lastText), options });
      i = j;
    }
  }
  if (fields.length === 0 && !sawPassword) throw new FormParseError('lever form has no fields');
  return { platform: 'lever', fields, block: sawPassword ? 'login' : detectBlockInBody(body) };
}
