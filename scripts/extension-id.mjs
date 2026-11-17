// Prints the Chrome extension ID that belongs to a key – it only READS the file you give it and never writes anything.
//   node scripts/extension-id.mjs <path-to-private-key.pem>      -> public key (for LINGOLENS_EXTENSION_PUBLIC_KEY) + extension ID
//   node scripts/extension-id.mjs --public <base64-public-key>   -> extension ID of a "key" value from a manifest
// The private key stays on your machine: this script prints only the PUBLIC half.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const idFromDer = (der) => [...createHash('sha256').update(der).digest().subarray(0, 16)].map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join('');

const args = process.argv.slice(2);
try {
  if (args[0] === '--public' && args[1]) {
    const der = Buffer.from(args[1].replace(/\s+/g, ''), 'base64');
    createPublicKey({ key: der, format: 'der', type: 'spki' }); // validates it
    console.log('Extension ID:', idFromDer(der));
  } else if (args[0]) {
    const pub = createPublicKey(createPrivateKey(readFileSync(args[0])));
    const der = pub.export({ type: 'spki', format: 'der' });
    console.log('Public key (base64, safe to share / put in the build):');
    console.log(der.toString('base64'));
    console.log('\nExtension ID:', idFromDer(der));
  } else {
    console.log('usage: node scripts/extension-id.mjs <private-key.pem>  |  --public <base64-public-key>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
}
