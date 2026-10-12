'use strict';

require('dotenv').config();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';

function generateNonce() {
  return `soul-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
}

function buildSignMessage(address, nonce) {
  return `Sign this message to verify ownership of your Chog NFTs for Soul.\n\nAddress: ${address}\nNonce: ${nonce}`;
}

function verifySignature(message, signature, expectedAddress) {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === ethers.getAddress(expectedAddress).toLowerCase();
  } catch {
    return false;
  }
}

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  generateNonce,
  buildSignMessage,
  verifySignature,
  createToken,
  verifyToken,
};
