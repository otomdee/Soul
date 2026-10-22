'use strict';

// Trait pools for testnet Chogs minted through the sponsored claim flow.
// Order matches MockChog's onchain traitCategories().
const TRAIT_CATEGORIES = [
  'Background',
  'Base',
  'Body',
  'Eyes',
  'Form',
  'Head',
  'Mouth',
  'Naked',
  'Side',
  'Skin',
  'Tier',
];

const TRAIT_OPTIONS = {
  Background: ['Purple', 'Blue', 'Black', 'Cream', 'Sky', 'Pink'],
  Base: ['Standard', 'Spiky', 'Soft', 'Cosmic'],
  Body: ['Round', 'Chunky', 'Slim', 'Bouncy'],
  Eyes: ['XD', 'Laser', 'Tired', 'Sparkle', 'Crossed'],
  Form: ['Classic', 'Cosmic', 'Mischief', 'Feral'],
  Head: ['BTC Cap', 'Crown', 'Dollar Cap', 'None', 'Beanie'],
  Mouth: ['Rainbow Puke', 'Grit', 'Smile', 'Tongue', 'Fangs'],
  Naked: ['Clothed', 'Naked'],
  Side: ['Left', 'Right'],
  Skin: ['Pink', 'Green', 'Gold', 'Purple', 'Blue'],
  Tier: ['Common', 'Uncommon', 'Rare', 'Legendary'],
};

function randomTraits() {
  const crypto = require('crypto');
  const traits = {};
  for (const category of TRAIT_CATEGORIES) {
    const options = TRAIT_OPTIONS[category];
    traits[category] = options[crypto.randomInt(options.length)];
  }
  return traits;
}

function traitValues(traits) {
  return TRAIT_CATEGORIES.map((category) => String(traits[category] || ''));
}

module.exports = { TRAIT_CATEGORIES, TRAIT_OPTIONS, randomTraits, traitValues };
