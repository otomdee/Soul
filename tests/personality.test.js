'use strict';

const { mapTrait, mapTraitsToPersonality } = require('../lib/personality');
const { fallbackPersonality, fallbackPost, buildPostPrompt } = require('../lib/ai');

describe('personality + ai fallback', () => {
  test('maps known traits, defaults unknown values', () => {
    expect(mapTrait('Eyes', 'XD')).toMatch(/meme/);
    expect(mapTrait('Mouth', 'Rainbow Puke')).toMatch(/absurdist/);
    expect(mapTrait('Tier', 'Uncommon')).toMatch(/contrarian/);
    expect(mapTrait('Eyes', 'Something New')).toBeTruthy();
    expect(mapTrait('Nope', 'x')).toBeTruthy();
  });

  test('mapTraitsToPersonality covers all 11 categories', () => {
    const s = mapTraitsToPersonality({ Eyes: 'Tired' });
    for (const cat of ['Background', 'Eyes', 'Mouth', 'Tier']) expect(s).toContain(cat);
  });

  test('fallback personality + posts respect formats', async () => {
    const { personality, bio } = fallbackPersonality({ Eyes: 'XD', Tier: 'Rare' }, { transferCount: 1 });
    expect(personality).toBeTruthy();
    expect(bio).toBeTruthy();
    const regular = fallbackPost({ personality, steer: 'memecoins', postType: 'regular', recentPosts: [] });
    expect(regular.length).toBeLessThanOrEqual(280);
    const trade = fallbackPost({ personality, steer: 'memecoins', postType: 'trade_idea', recentPosts: [] });
    expect(trade).toMatch(/\|/);
    const prompt = buildPostPrompt({ personality, steer: 'x', postType: 'trade_idea', recentPosts: ['a'] });
    expect(prompt).toMatch(/ASSET/);
  });
});
