import { invalid } from './http.js';
import { safeHttps } from '../seo.js';
import { secretPattern } from '../../src/lib/submission.mjs';

const protectedField = /^(?:__proto__|constructor|prototype)$/i;
const credentialKey = /(?:secret|password|api[-_]?key|access[-_]?token|authorization|credential|private[-_]?key)/i;
const placeholder = /^(?:\${[A-Z0-9_.-]+}|<[A-Z0-9_. -]+>|YOUR[-_ A-Z0-9]+|REPLACE[-_ A-Z0-9]+)$/;
export const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function checkSecrets(value, depth = 0) {
  if (depth > 16) invalid('Nested data exceeds the supported depth.');
  if (typeof value === 'string' && (secretPattern.test(value) || /(?:client[ _-]?secret|refresh[ _-]?token)\s*[:=]\s*[^\s]{8,}/i.test(value) || /\bBearer\s+[\w.+=/-]{12,}/i.test(value))) {
    invalid('Remove credential values and use placeholders.');
  }
  if (Array.isArray(value)) {
    for (const item of value) checkSecrets(item, depth + 1);
  } else if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (protectedField.test(key)) invalid('Unsupported object field.');
      if (credentialKey.test(key) && typeof item === 'string' && item && !placeholder.test(item)) {
        invalid('Remove credential values and use placeholders.');
      }
      checkSecrets(item, depth + 1);
    }
  }
}
export function text(value, label, max, required = true) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') invalid(label + ' must be text.');
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) invalid('Enter a valid ' + label + '.');
  checkSecrets(normalized);
  return normalized;
}
export function parsed(value, label) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { invalid(label + ' must be valid JSON.'); }
}
export function options(value, allowed, label) {
  if (!allowed.includes(value)) invalid('Select a valid ' + label + '.');
  return value;
}
export function integer(value, label, min, max) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))) invalid('Enter a whole number for ' + label + '.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) invalid(label + ' is out of range.');
  return number;
}
export const reason = value => text(value, 'reason', 200);
export function url(value, label, required = true) {
  const checked = text(value, label, 2048, required);
  if (!checked && !required) return '';
  const safe = safeHttps(checked);
  if (!safe) invalid('Enter an HTTPS ' + label + ' without credentials.');
  for (const name of new URL(safe).searchParams.keys()) {
    if (credentialKey.test(name)) invalid('Remove credentials from ' + label + '.');
  }
  return safe;
}
export function strings(value, label, maxItems, maxLength) {
  if (typeof value === 'string') value = value.split('\n').map(line => line.trim()).filter(Boolean);
  if (!Array.isArray(value) || value.length > maxItems) invalid('Enter a valid ' + label + ' list.');
  return value.map(item => text(item, label, maxLength));
}
