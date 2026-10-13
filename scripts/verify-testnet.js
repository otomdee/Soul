'use strict';

// Verifies the backend's blockchain integration against the live testnet contract.
// Usage: node scripts/verify-testnet.js
// Env: MONAD_RPC_URL, CHOG_CONTRACT_ADDRESS (see .env)

require('dotenv').config();
const assert = require('assert');
const {
  getOwnedTokenIds,
  verifyOwnership,
  getTokenMetadata,
  getTokenHistory,
  CHOG_CONTRACT_ADDRESS,
} = require('../lib/blockchain');

const PROBE_ADDRESS = '0xb528B7167D3Ec6BaA903eADcc80c912378A96d8e'; // test wallet, owns token #0

async function main() {
  console.log('Contract:', CHOG_CONTRACT_ADDRESS);
  console.log('RPC:', process.env.MONAD_RPC_URL);

  const owned = await getOwnedTokenIds(PROBE_ADDRESS);
  console.log('owned token IDs:', owned);
  assert.ok(owned.includes(0), 'expected token #0 in owned list');

  assert.strictEqual(await verifyOwnership(PROBE_ADDRESS, 0), true, 'owner should verify');
  assert.strictEqual(
    await verifyOwnership('0x0000000000000000000000000000000000000001', 0),
    false,
    'stranger should not verify'
  );
  console.log('ownership checks ok');

  const meta = await getTokenMetadata(0);
  console.log('traits:', JSON.stringify(meta.traits));
  console.log('name:', meta.name);
  const expected = ['Background', 'Base', 'Body', 'Eyes', 'Form', 'Head', 'Mouth', 'Naked', 'Side', 'Skin', 'Tier'];
  for (const cat of expected) assert.ok(meta.traits[cat], `missing trait ${cat}`);
  assert.strictEqual(meta.traits.Eyes, 'XD');
  console.log('metadata checks ok');

  const history = await getTokenHistory(0);
  console.log('history:', JSON.stringify(history));
  assert.ok(history.transferCount >= 1, 'expected at least the mint transfer');
  console.log('history checks ok');

  console.log('TESTNET VERIFICATION PASS');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('TESTNET VERIFICATION FAIL:', err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
