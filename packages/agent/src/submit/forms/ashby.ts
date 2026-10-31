import { FormParseError, type FieldKind, type FieldOption, type FormField, type FormSpec } from '../types';
import { detectBlockInBody } from '../challenge';
import { asArray, asObject, fileRole, parseJson, str, textKind } from './common';

/**
 * Reads an Ashby application form from its JSON description (formDefinition.sections[].fields[] ->
 * { isRequired, field: { path, title, type, selectableValues } }). SYNTHETIC fixtures stand in for recorded ones, so the
 * shape is unverified against the live service.
 */
export function readAshby(body: string): FormSpec {
  const root = asObject(parseJson(body, 'ashby form'), 'ashby form');
  const def = asObject(root['formDefinition'], 'formDefinition');
  const fields: FormField[] = [];
  for (const sv of asArray(def['sections'])) {
    for (const iv of asArray(asObject(sv, 'section')['fields'])) {
      const item = asObject(iv, 'field item');
      const f = asObject(item['field'], 'field');
      const id = str(f['path']);
      if (!id) throw new FormParseError('ashby field without a path');
      const label = str(f['title']).trim();
      const required = item['isRequired'] === true;
      const type = str(f['type']);
      const options: FieldOption[] = asArray(f['selectableValues']).map((v) => {
        const o = asObject(v, 'selectable value');
        return { label: str(o['label']), value: str(o['value']) };
      });
      const base = { id, label, required };
      const simple: Record<string, FieldKind> = { Email: 'email', Phone: 'phone', LongText: 'textarea', Number: 'number', Boolean: 'boolean', ValueSelect: 'select', MultiValueSelect: 'multiselect', Captcha: 'captcha' };
      if (type === 'File') fields.push({ ...base, kind: 'file', fileRole: fileRole(id, label) });
      else if (type === 'String' || type === 'Date') fields.push({ ...base, kind: textKind(id, label) });
      else if (simple[type]) fields.push({ ...base, kind: simple[type]!, ...(options.length ? { options } : {}) });
      else throw new FormParseError(`ashby field type ${type || '(none)'} is not supported`);
    }
  }
  if (fields.length === 0) throw new FormParseError('ashby form has no fields');
  const block = fields.some((f) => f.kind === 'captcha') ? 'captcha' : detectBlockInBody(body);
  return { platform: 'ashby', fields, block };
}
