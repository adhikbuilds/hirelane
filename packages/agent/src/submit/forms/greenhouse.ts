import { FormParseError, type FieldOption, type FormField, type FormSpec } from '../types';
import { detectBlockInBody } from '../challenge';
import { asArray, asObject, fileRole, parseJson, str, textKind } from './common';

/**
 * Reads a Greenhouse application form from its JSON description (the shape of the public job-board questions list:
 * questions[] -> { label, required, fields[] -> { name, type, values[] } }). SYNTHETIC fixtures stand in for recorded
 * ones, so the shape is unverified against the live service.
 * The voluntary self-identification sections (compliance, demographic) are never read: Hirelane does not fill them.
 */
export function readGreenhouse(body: string): FormSpec {
  const root = asObject(parseJson(body, 'greenhouse form'), 'greenhouse form');
  const fields: FormField[] = [];
  for (const section of ['questions', 'location_questions'] as const) {
    for (const qv of asArray(root[section])) {
      const q = asObject(qv, 'question');
      const label = str(q['label']).trim();
      const required = q['required'] === true;
      for (const fv of asArray(q['fields'])) {
        const f = asObject(fv, 'field');
        const id = str(f['name']);
        if (!id) throw new FormParseError('greenhouse field without a name');
        const type = str(f['type']);
        const options: FieldOption[] = asArray(f['values']).map((v) => {
          const o = asObject(v, 'value');
          return { label: str(o['label']), value: str(o['value']) };
        });
        const base = { id, label, required };
        switch (type) {
          case 'input_file':
            fields.push({ ...base, kind: 'file', fileRole: fileRole(id, label) });
            break;
          case 'textarea':
            fields.push({ ...base, kind: 'textarea' });
            break;
          case 'multi_value_single_select':
            fields.push({ ...base, kind: options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o.label)) ? 'boolean' : 'select', options });
            break;
          case 'multi_value_multi_select':
            fields.push({ ...base, kind: 'multiselect', options });
            break;
          case 'input_text':
            fields.push({ ...base, kind: textKind(id, label) });
            break;
          case 'captcha':
            fields.push({ ...base, kind: 'captcha' });
            break;
          default:
            throw new FormParseError(`greenhouse field type ${type || '(none)'} is not supported`);
        }
      }
    }
  }
  if (fields.length === 0) throw new FormParseError('greenhouse form has no fields');
  const block = fields.some((f) => f.kind === 'captcha') ? 'captcha' : detectBlockInBody(body);
  return { platform: 'greenhouse', fields, block };
}
