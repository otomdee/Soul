'use strict';

const { verifyToken } = require('./auth');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const decoded = verifyToken(token);
    req.user = { address: decoded.address, tokenIds: decoded.tokenIds || [] };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const decoded = verifyToken(token);
      req.user = { address: decoded.address, tokenIds: decoded.tokenIds || [] };
    } catch {
      // ignore — treat as anonymous
    }
  }
  return next();
}

module.exports = { authMiddleware, optionalAuth };
