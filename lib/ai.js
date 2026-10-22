'use strict';

require('dotenv').config();
const { mapTraitsToPersonality } = require('./personality');

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const AI_MODEL = process.env.AI_MODEL || 'gemini-2.0-flash';
const AI_API_KEY = process.env.AI_API_KEY || '';

const TIMEOUT_MS = 10000;

const CHOG_LORE =
  'Chog is the most adored monanimal on Monad: a mischievous, curious kid with purple spiky hair, ' +
  'big eyes, and a talent for causing chaos. Chogs are building the Chog World Order.';

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Gemini ${res.status}`);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text.trim()) throw new Error('Empty Gemini response');
      return text.trim();
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
    }
  }
  throw lastErr;
}

// Placeholder for an OpenAI-compatible provider (e.g. Muse Spark) —
// same interface, different endpoint. Kept swappable via AI_PROVIDER.
async function callMuse(prompt) {
  const base = process.env.MUSE_BASE_URL || 'https://api.example.com/v1';
  const url = `${base}/chat/completions`;
  const body = {
    model: AI_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Muse error ${res.status}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text.trim()) throw new Error('Empty Muse response');
      return text.trim();
    } catch (err) {
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Muse call failed after retry');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldUseLiveAI() {
  return Boolean(AI_API_KEY);
}

async function callAI(prompt) {
  if (!shouldUseLiveAI()) return null; // signal fallback
  try {
    if (AI_PROVIDER === 'muse') return await callMuse(prompt);
    return await callGemini(prompt);
  } catch (err) {
    console.error('AI call failed, using fallback:', err.message);
    return null;
  }
}

function buildPersonalityPrompt(traits, history = {}) {
  const traitDesc = mapTraitsToPersonality(traits);
  return [
    'You are creating a personality profile for a Chog — one of Monad\'s most adored monanimals.',
    CHOG_LORE,
    '',
    'Traits that define this Chog:',
    traitDesc,
    '',
    `Onchain history: minted on ${history.mintDate || 'an unknown date'}, ` +
      `${history.transferCount ?? '?'} transfers, currently held for ${history.currentHoldingDuration || 'an unknown duration'}.`,
    '',
    'Write a 2-3 paragraph personality profile (the system prompt that will define this character) ',
    'plus a one-line bio on the last line prefixed with "BIO:". ',
    'Be vivid, specific, and entertaining. Stay in character as a creature description.',
  ].join('\n');
}

function buildPostPrompt({ personality, steer, postType, recentPosts = [] }) {
  return [
    'SYSTEM: You are a Chog — a mischievous, curious monanimal from the Monad blockchain.',
    'You are a purple, spiky-haired kid with big eyes and a talent for causing chaos. You are part of the Chog World Order.',
    `Your personality is: ${personality}`,
    '',
    `Your owner is steering you towards: ${steer || 'whatever is on your mind'}`,
    '',
    'Rules:',
    '- Keep posts under 280 characters',
    '- Be in character at all times',
    '- Never break the fourth wall',
    postType === 'trade_idea'
      ? '- For trade ideas, use the format: ASSET | DIRECTION | CONVICTION | REASONING'
      : '- Write a casual tweet-style post',
    recentPosts.length
      ? `\nDo not repeat these recent posts:\n${recentPosts.map((p) => `- ${p}`).join('\n')}`
      : '',
    '',
    `USER: Generate a ${postType} post.`,
  ].join('\n');
}

// ---- Deterministic fallbacks (used when no API key or AI fails) ----

const FALLBACK_OPENERS = [
  'gchog. woke up in the Chog World Order and the timeline is already unhinged.',
  'another day on Monad, another chance to be extremely right about everything.',
  'caused a little chaos before breakfast and the timeline noticed.',
  'monanimal check: vibes immaculate, chaos levels rising.',
];

function fallbackPersonality(traits, history = {}) {
  const traitDesc = mapTraitsToPersonality(traits);
  const keys = Object.keys(traits || {});
  const signature = keys.length
    ? keys
        .slice(0, 3)
        .map((k) => `${k} ${traits[k]}`)
        .join(', ')
    : 'mysterious uncharted traits';
  const held = history.currentHoldingDuration || 'a good while';
  const personality = [
    `This Chog (${signature}) has seen things. Minted ${history.mintDate || 'back when the Chog World Order was still forming'}, `,
    `passed through ${history.transferCount ?? 0} hands and held tight for ${held}, it speaks with the `,
    `gravel of experience and the chaotic curiosity of a Chog that never misses.`,
    '',
    'Trait map:',
    traitDesc,
  ].join('\n');
  const tier = traits.Tier || traits.tier || 'wild';
  const bio = `${tier} monanimal of the Chog World Order · ${signature}`.slice(0, 140);
  return { personality, bio };
}

function fallbackPost({ personality, steer, postType, recentPosts = [] }) {
  void personality;
  void recentPosts;
  const topic = (steer || 'the Chog World Order and the charts').split('\n')[0].slice(0, 80);
  const opener = FALLBACK_OPENERS[Math.floor(Math.random() * FALLBACK_OPENERS.length)];
  if (postType === 'trade_idea') {
    const assets = ['MON', 'CHOG', 'BTC', 'ETH'];
    const asset = assets[Math.floor(Math.random() * assets.length)];
    const dir = Math.random() > 0.5 ? 'LONG' : 'SHORT';
    const conv = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];
    return `${asset} | ${dir} | ${conv} conviction | ${topic} — ${opener}`.slice(0, 280);
  }
  return `${opener} thinking about ${topic} today.`.slice(0, 280);
}

async function generatePersonality(traits, history = {}) {
  const prompt = buildPersonalityPrompt(traits, history);
  const live = await callAI(prompt);
  if (live) {
    const bioMatch = live.match(/^BIO:\s*(.+)$/m);
    const bio = bioMatch ? bioMatch[1].trim().slice(0, 160) : live.split('\n').pop().slice(0, 160);
    const personality = live.replace(/^BIO:.*$/m, '').trim() || live;
    return { personality, bio };
  }
  return fallbackPersonality(traits, history);
}

async function generatePost(personality, steer, postType = 'regular', recentPosts = []) {
  const prompt = buildPostPrompt({ personality, steer, postType, recentPosts });
  const live = await callAI(prompt);
  if (live) {
    return live.slice(0, 280);
  }
  return fallbackPost({ personality, steer, postType, recentPosts });
}

module.exports = {
  generatePersonality,
  generatePost,
  buildPersonalityPrompt,
  buildPostPrompt,
  fallbackPersonality,
  fallbackPost,
  shouldUseLiveAI,
};
