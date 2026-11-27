const encode = value => new TextEncoder().encode(value);
const decode = bytes => new TextDecoder().decode(bytes);
export const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unbase64 = data => Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
export const token = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encode(value))));
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function encryptionKey(secret) {
  return crypto.subtle.importKey('raw', unbase64(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(secret, id, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(id) }, await encryptionKey(secret), encode(JSON.stringify(value))));
  // Chunk the conversion for large, valid registry records.
  let binary = '';
  for (let i = 0; i < result.length; i += 8192) binary += String.fromCharCode(...result.subarray(i, i + 8192));
  return base64url(iv) + '.' + btoa(binary);
}
export async function unseal(secret, id, ciphertext) {
  const [iv, encrypted] = ciphertext.split('.');
  const value = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv), additionalData: encode(id) }, await encryptionKey(secret), unbase64(encrypted));
  return JSON.parse(decode(value));
}
