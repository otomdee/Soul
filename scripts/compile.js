'use strict';

// Compiles contracts/MockChog.sol with solc + OpenZeppelin imports.
// Usage: node scripts/compile.js
// Output: contracts/artifacts/MockChog.json ({ abi, bytecode })

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts');
const ARTIFACTS_DIR = path.join(CONTRACTS_DIR, 'artifacts');

function findImports(importPath) {
  try {
    // Resolve @openzeppelin/... from node_modules, relative imports from contracts/
    let fullPath;
    if (importPath.startsWith('@')) {
      fullPath = path.join(__dirname, '..', 'node_modules', importPath);
    } else {
      fullPath = path.resolve(CONTRACTS_DIR, importPath);
    }
    return { contents: fs.readFileSync(fullPath, 'utf8') };
  } catch (err) {
    return { error: `Import not found: ${importPath}` };
  }
}

function compile() {
  const sourcePath = path.join(CONTRACTS_DIR, 'MockChog.sol');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'MockChog.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  if (output.errors) {
    const fatal = output.errors.filter((e) => e.severity === 'error');
    for (const e of output.errors) console.error(e.formattedMessage || e.message);
    if (fatal.length) throw new Error('Compilation failed');
  }
  const contract = output.contracts['MockChog.sol']['MockChog'];
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const artifactPath = path.join(ARTIFACTS_DIR, 'MockChog.json');
  fs.writeFileSync(
    artifactPath,
    JSON.stringify({ contractName: 'MockChog', abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2)
  );
  console.log('Artifact written to', artifactPath);
  return artifactPath;
}

if (require.main === module) {
  try {
    compile();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { compile };
