'use strict';

// Deploys MockChog to Monad testnet and mints token #0 to the deployer.
// Usage: node scripts/deploy-mock-chog.js
// Env: TEST_WALLET_PK (deployer, funded with testnet MON), MONAD_TESTNET_RPC_URL (optional).
// Prints the contract address, mint tx, and token metadata. Never prints the private key.

require('dotenv').config();
const { ethers } = require('ethers');
const { compile } = require('./compile');

const RPC_URL = process.env.MONAD_TESTNET_RPC_URL || 'https://testnet-rpc.monad.xyz';
const EXPECTED_CHAIN_ID = 10143n;

// Token #0 traits, in MockChog traitCategories order:
// Background, Base, Body, Eyes, Form, Head, Mouth, Naked, Side, Skin, Tier
const GENESIS_TRAITS = [
  'Purple', // Background
  'Standard', // Base
  'Round', // Body
  'XD', // Eyes
  'Classic', // Form
  'BTC Cap', // Head
  'Rainbow Puke', // Mouth
  'Clothed', // Naked
  'Left', // Side
  'Pink', // Skin
  'Uncommon', // Tier
];

async function main() {
  const pk = process.env.TEST_WALLET_PK;
  if (!pk) throw new Error('TEST_WALLET_PK is not set');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (net.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong chain: got ${net.chainId}, expected ${EXPECTED_CHAIN_ID}`);
  }
  const wallet = new ethers.Wallet(pk, provider);
  console.log('Deployer:', wallet.address);
  console.log('Balance (MON):', ethers.formatEther(await provider.getBalance(wallet.address)));

  const artifactPath = require('path').join(__dirname, '..', 'contracts', 'artifacts', 'MockChog.json');
  let artifact;
  try {
    artifact = require(artifactPath);
  } catch {
    console.log('No artifact found, compiling…');
    compile();
    artifact = require(artifactPath);
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('Deploying MockChog…');
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log('MockChog deployed at:', address);

  console.log('Minting token #0 with genesis traits…');
  const tx = await contract.mintWithTraits(wallet.address, GENESIS_TRAITS);
  const receipt = await tx.wait();
  console.log('Mint tx:', receipt.hash);
  console.log('Owner of token #0:', await contract.ownerOf(0));

  recordMint(address, wallet.address, 0, receipt, GENESIS_TRAITS);

  const uri = await contract.tokenURI(0);
  console.log('tokenURI (truncated):', uri.slice(0, 120) + '…');

  console.log('\nNext steps:');
  console.log(`  CHOG_CONTRACT_ADDRESS=${address}`);
  console.log('  MONAD_RPC_URL=https://testnet-rpc.monad.xyz');
}

// Appends the mint to contracts/deployments.json so the backend can serve
// exact token history without scanning logs. Contains only public data.
function recordMint(contractAddress, minter, tokenId, receipt, traitValues) {
  const fs = require('fs');
  const recordPath = require('path').join(__dirname, '..', 'contracts', 'deployments.json');
  let data = { tokens: {} };
  try {
    data = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch {
    // start fresh
  }
  const categories = [
    'Background', 'Base', 'Body', 'Eyes', 'Form', 'Head',
    'Mouth', 'Naked', 'Side', 'Skin', 'Tier',
  ];
  const traits = {};
  categories.forEach((cat, i) => {
    traits[cat] = traitValues[i];
  });
  data.chainId = 10143;
  data.contract = contractAddress;
  data.deployer = minter;
  data.tokens = data.tokens || {};
  data.tokens[String(tokenId)] = {
    minter,
    mintTx: receipt.hash,
    mintBlock: receipt.blockNumber,
    traits,
  };
  fs.writeFileSync(recordPath, JSON.stringify(data, null, 2) + '\n');
  console.log('Recorded mint in contracts/deployments.json');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Deploy failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = { main, GENESIS_TRAITS };
