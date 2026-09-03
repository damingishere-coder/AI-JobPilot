const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const EXPECTED_EXTENSION_ID = 'igmjpelbjhlglhegjbgmdbgfcdflmigp';

function extensionIdFromKey(key) {
  const publicKey = Buffer.from(key, 'base64');
  const hash = crypto.createHash('sha256').update(publicKey).digest();
  return Array.from(hash.subarray(0, 16), (byte) =>
    `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 0x0f))}`,
  ).join('');
}

test('manifest public key derives the backend allowlisted extension id', () => {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, '1.4.2');
  assert.equal(extensionIdFromKey(manifest.key), EXPECTED_EXTENSION_ID);

  const publicKey = crypto.createPublicKey({
    key: Buffer.from(manifest.key, 'base64'),
    format: 'der',
    type: 'spki',
  });
  assert.equal(publicKey.asymmetricKeyType, 'rsa');
  assert.deepEqual(
    manifest.host_permissions.filter((permission) => permission.startsWith('http://localhost:') || permission.startsWith('http://127.0.0.1:')),
    ['http://localhost:6866/*', 'http://127.0.0.1:6866/*'],
  );
});
