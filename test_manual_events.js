// Self-check for manual-events.js's moderation/chat join.
//
//   deno run --allow-read test_manual_events.js
//
// manual-events.js is a browser IIFE that ends in `})(window)`, so it is loaded
// here under a one-line `window` shim rather than imported as a module.

globalThis.window = globalThis;
const src = await Deno.readTextFile(new URL('./manual-events.js', import.meta.url));
// Indirect eval: runs in global scope, so the IIFE's `window` is our shim.
(0, eval)(src);

const ME = globalThis.ManualEvents;

let failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}

// ── lastMessageBefore ────────────────────────────────────────────────────────

const messages = [
  { platform: 'kick',    author: 'someone',   text: 'first',      ts: 100 },
  { platform: 'kick',    author: 'Someone',   text: 'second',     ts: 150 },
  { platform: 'twitch',  author: 'someone',   text: 'wrong plat', ts: 190 },
  { platform: 'kick',    author: 'bystander', text: 'wrong user', ts: 195 },
  { platform: 'kick',    author: 'someone',   text: 'last words', ts: 199 },
  { platform: 'kick',    author: 'someone',   text: 'too late',   ts: 201 },
  { platform: 'kick',    author: 'someone',   text: 'no ts' },
];
const ev = { event: 'moderation', ts: 200, platform: 'kick', type: 'ban', username: 'someone' };

eq('exact match takes the latest message at or before the event ts',
   (ME.lastMessageBefore(messages, ev) || {}).text, 'last words');

eq('a message exactly on the event ts still matches',
   (ME.lastMessageBefore(messages, { ...ev, ts: 201 }) || {}).text, 'too late');

eq('a message after the event is ignored',
   (ME.lastMessageBefore(messages, { ...ev, ts: 160 }) || {}).text, 'second');

eq('a different platform is ignored',
   (ME.lastMessageBefore(messages, { ...ev, platform: 'twitch' }) || {}).text, 'wrong plat');

eq('a different user is ignored',
   (ME.lastMessageBefore(messages, { ...ev, username: 'bystander' }) || {}).text, 'wrong user');

// "@Name" in chat vs "name" on the moderation row, and vice versa.
const handles = [
  { platform: 'youtube', author: '@SomeHandle', text: 'handled', ts: 50 },
];
eq('chat "@Name" matches a bare moderation username, case-insensitively',
   (ME.lastMessageBefore(handles, { ts: 60, platform: 'youtube', username: 'somehandle' }) || {}).text,
   'handled');
eq('a moderation "@Name" matches a bare chat author, case-insensitively',
   (ME.lastMessageBefore([{ platform: 'kick', author: 'LOUD_user', text: 'quiet', ts: 10 }],
                         { ts: 20, platform: 'kick', username: '@loud_User' }) || {}).text,
   'quiet');

eq('platform casing does not matter',
   (ME.lastMessageBefore([{ platform: 'Kick', author: 'u', text: 'hi', ts: 1 }],
                         { ts: 2, platform: 'kick', username: 'u' }) || {}).text, 'hi');

check('no username -> null', ME.lastMessageBefore(messages, { ...ev, username: '' }) === null);
check('missing username -> null', ME.lastMessageBefore(messages, { ts: 200, platform: 'kick' }) === null);
check('no event ts -> null', ME.lastMessageBefore(messages, { ...ev, ts: undefined }) === null);
check('no platform -> null', ME.lastMessageBefore(messages, { ts: 200, username: 'someone' }) === null);
check('no match -> null', ME.lastMessageBefore(messages, { ...ev, ts: 99 }) === null);
check('empty message list -> null', ME.lastMessageBefore([], ev) === null);
check('non-array messages -> null', ME.lastMessageBefore(null, ev) === null);
check('null event -> null', ME.lastMessageBefore(messages, null) === null);

// A message with no ts can never be placed relative to the event, so it is
// never the answer even when it is the only candidate.
check('a message with no ts never matches',
      ME.lastMessageBefore([{ platform: 'kick', author: 'someone', text: 'no ts' }], ev) === null);

// Unsorted input must still give the newest match, not the first one seen.
const shuffled = [
  { platform: 'kick', author: 'someone', text: 'older',  ts: 120 },
  { platform: 'kick', author: 'someone', text: 'newest', ts: 180 },
  { platform: 'kick', author: 'someone', text: 'middle', ts: 150 },
];
eq('unsorted messages still yield the newest match',
   (ME.lastMessageBefore(shuffled, ev) || {}).text, 'newest');

// ── attachLastMessages ───────────────────────────────────────────────────────

const mods = [
  { event: 'moderation', ts: 200, platform: 'kick',   type: 'ban',     username: 'someone' },
  { event: 'moderation', ts: 196, platform: 'kick',   type: 'timeout', username: 'bystander' },
  { event: 'moderation', ts: 200, platform: 'kick',   type: 'ban',     username: 'ghost' },
  { event: 'moderation', ts: 200, platform: 'youtube', type: 'removed', username: 'someone' },
];
eq('attachLastMessages counts the events it matched', ME.attachLastMessages(mods, messages), 2);
eq('matched event carries {text, ts}', mods[0].lastMessage, { text: 'last words', ts: 199 });
eq('second matched event carries its own message', mods[1].lastMessage, { text: 'wrong user', ts: 195 });
check('a user who never spoke keeps no lastMessage field', !('lastMessage' in mods[2]));
check('a platform with no messages keeps no lastMessage field', !('lastMessage' in mods[3]));

eq('attachLastMessages with no messages attaches nothing', ME.attachLastMessages(mods, []), 0);
eq('attachLastMessages tolerates a non-array message list', ME.attachLastMessages(mods, null), 0);
eq('attachLastMessages tolerates a non-array event list', ME.attachLastMessages(null, messages), 0);

// A fractional ts (Twitch IRC timestamps are floats) survives the round trip.
const frac = [{ event: 'moderation', ts: 10.5, platform: 'twitch', type: 'ban', username: 'u' }];
ME.attachLastMessages(frac, [{ platform: 'twitch', author: 'u', text: 'bye', ts: 5.115 }]);
eq('a fractional ts is preserved', frac[0].lastMessage, { text: 'bye', ts: 5.115 });

// A message whose text is empty still attaches (the renderer decides whether
// an empty quote is worth drawing).
const blank = [{ event: 'moderation', ts: 10, platform: 'kick', type: 'ban', username: 'u' }];
eq('an empty text still attaches', ME.attachLastMessages(blank, [{ platform: 'kick', author: 'u', text: '', ts: 1 }]), 1);
eq('an empty text stays an empty string', blank[0].lastMessage, { text: '', ts: 1 });

// ── Result ───────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  Deno.exit(1);
}
console.log('\nall checks passed');
