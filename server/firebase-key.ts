/** Accept PEM text or the JSON representation copied from a service-account download. */
export function firebasePrivateKey(input: string): string {
  let key = input.trim();
  if (key.startsWith('{') || key.startsWith('"')) {
    try {
      const parsed = JSON.parse(key);
      key = typeof parsed === 'string' ? parsed : parsed.private_key;
    } catch {
      throw Error('FIREBASE_PRIVATE_KEY has invalid JSON. Paste the private_key value from the downloaded service-account file.');
    }
  }
  if (typeof key !== 'string') throw Error('FIREBASE_PRIVATE_KEY must contain the private_key value from your service-account file.');
  // Environment editors can preserve one or two levels of JSON newline escaping.
  key = key.trim().replace(/^'([\s\S]*)'$/, '$1').replace(/\\+r\\+n/g, '\n').replace(/\\+n/g, '\n').replace(/\r\n/g, '\n').trim();
  const match = key.match(/^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----$/);
  if (!match) throw Error('FIREBASE_PRIVATE_KEY format is invalid. Copy the full private_key, including its BEGIN and END PRIVATE KEY lines, then redeploy.');
  const body = match[1].replace(/\s/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)?.join('\n') || ''}\n-----END PRIVATE KEY-----\n`;
}
