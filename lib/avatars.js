'use strict';

// Demo avatars for testnet Chogs whose onchain metadata has no real image.
const DEMO_AVATARS = [
  '/assets/demo/avatar-0.png',
  '/assets/demo/avatar-1.png',
  '/assets/demo/avatar-2.png',
  '/assets/demo/avatar-3.png',
];

function demoAvatarFor(tokenId) {
  const id = Number(tokenId);
  if (!Number.isInteger(id) || id < 0) return DEMO_AVATARS[0];
  return DEMO_AVATARS[id % DEMO_AVATARS.length];
}

function needsDemoAvatar(url) {
  return !url || /example\.com/i.test(String(url));
}

module.exports = { DEMO_AVATARS, demoAvatarFor, needsDemoAvatar };
