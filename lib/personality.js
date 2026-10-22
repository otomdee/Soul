'use strict';

// Maps each of the 11 Chog trait categories to personality dimensions.
// Unknown values fall back to sensible defaults per category.

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

const MAPPINGS = {
  Eyes: {
    Tired: 'laid-back, sarcastic, unbothered',
    XD: 'excitable, meme-loving, high-energy',
    Happy: 'optimistic, warm, encouraging',
    Angry: 'fiery, confrontational, bold',
    Sleepy: 'dreamy, slow-paced, philosophical',
    Laser: 'intense, visionary, future-obsessed',
    default: 'observant, witty, curious',
  },
  Mouth: {
    'Rainbow Puke': 'absurdist, chaotic, unpredictable humor',
    Grit: 'tough, no-nonsense, straight-talking',
    Smile: 'friendly, approachable, wholesome',
    Frown: 'grumpy, cynical, dry-witted',
    Open: 'outspoken, loud, opinionated',
    default: 'expressive, playful, quick-witted',
  },
  Head: {
    'Dollar Cap': 'money-focused, hustler energy, always talking gains',
    'BTC Cap': 'crypto-maximalist lean, orange-pilled, long-term conviction',
    MCGA: 'politically edgy, provocative, loves a hot take',
    Crown: 'regal, confident, natural leader voice',
    Beanie: 'chill, casual, community-first',
    default: 'distinctive, self-aware, trend-spotting',
  },
  Tier: {
    Common: 'everyman, relatable, speaks for the crowd',
    Uncommon: 'slightly contrarian, quirky, offbeat takes',
    Rare: 'refined, confident, knows its worth',
    Epic: 'dramatic, legendary energy, main-character voice',
    Legendary: 'mythic, profound, speaks like history matters',
    Origin: 'OG purist, traditionalist, founding-myte energy',
    default: 'unique, self-assured, memorable',
  },
  Background: {
    Red: 'high-energy, urgent, passionate mood',
    Blue: 'calm, thoughtful, deep mood',
    Purple: 'mysterious, creative, visionary mood',
    Green: 'grounded, bullish, growth-oriented mood',
    Yellow: 'cheerful, loud, attention-grabbing mood',
    Black: 'edgy, nocturnal, sharp mood',
    default: 'adaptable mood that matches the vibe of the timeline',
  },
  Skin: {
    Pink: 'flamboyant, bold, loves the spotlight',
    Green: 'classic monanimal energy, meme-native, chaos-ready',
    Gold: 'luxurious, flex-heavy, premium taste',
    Origin: 'classic, traditionalist, old-soul energy',
    default: 'comfortable in its own skin, confident presence',
  },
  Base: {
    default: 'solid foundation, dependable voice',
  },
  Body: {
    default: 'expressive physicality that comes through in word choice',
  },
  Form: {
    default: 'shapeshifting curiosity, always evolving',
  },
  Naked: {
    default: 'unfiltered, honest, nothing to hide',
  },
  Side: {
    default: 'loyal companion energy, ride-or-die for its holders',
  },
};

function mapTrait(category, value) {
  const table = MAPPINGS[category] || {};
  if (!value) return table.default || 'neutral, balanced';
  if (table[value]) return table[value];
  // Case-insensitive fallback
  const key = Object.keys(table).find((k) => k.toLowerCase() === String(value).toLowerCase());
  if (key) return table[key];
  return table.default || 'neutral, balanced';
}

/**
 * Convert a traits object { Background, Eyes, ... } into a structured
 * personality description string.
 */
function mapTraitsToPersonality(traits = {}) {
  const lines = [];
  for (const category of TRAIT_CATEGORIES) {
    const value = traits[category] ?? traits[category.toLowerCase()] ?? 'Unknown';
    const vibe = mapTrait(category, value);
    lines.push(`- ${category}: ${value} → ${vibe}`);
  }
  return lines.join('\n');
}

module.exports = {
  TRAIT_CATEGORIES,
  MAPPINGS,
  mapTrait,
  mapTraitsToPersonality,
};
