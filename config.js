// ── Ogre World Frontend Config ─────────────────────────────────────────────────
// Edit this file to configure the dashboard without touching index.html.

// ── Site ───────────────────────────────────────────────────────────────────────
const SITE_TITLE = 'Ogre Watch';

// ── GitHub repo ────────────────────────────────────────────────────────────────
const GITHUB_OWNER = 'rawtechusa-sys';
const GITHUB_REPO  = 'ogrestats';
const BRANCH       = 'main';

// ── Timezone ─────────────────────────────────────────────────────────────────────
// Shared by every page. The header dropdown (index.html) writes localStorage
// 'swamp-tz'; date helpers call getTimeZone()/withTZ() at render time, so any
// re-render reflects the current mode. 'local' omits timeZone so toLocale* uses the
// visitor's browser zone. Default is Ogre Time (the streamer's clock, America/New_York).
const TZ_MODES = {
  ogre:  { label: 'Ogre Time',  zone: 'America/New_York' },
  local: { label: 'Local Time', zone: undefined },
  utc:   { label: 'UTC',        zone: 'UTC' },
};
function getTZMode() {
  try { const m = localStorage.getItem('swamp-tz'); if (TZ_MODES[m]) return m; } catch (e) {}
  return 'ogre';
}
function getTimeZone() { return TZ_MODES[getTZMode()].zone; }
// Merge the active zone into a toLocale* options object ('local' -> no timeZone key).
function withTZ(opts) {
  const z = getTimeZone();
  return z ? Object.assign({}, opts, { timeZone: z }) : opts;
}

// ── Roaches ────────────────────────────────────────────────────────────────────
const ROACH_CONFIG = {
  count:        11,     // number of roaches on screen
  fleeRadius:   120,    // px -- how close the mouse must get before they flee
  fleeMaxSpeed: 2.2,    // max speed when fleeing
  fleeAccel:    0.25,   // speed added per frame when fleeing
  idleSpeedMin: 0.15,   // minimum wander speed
  idleSpeedMax: 0.35,   // maximum wander speed
  idleDecel:    0.04,   // how quickly they slow back to idle after fleeing
  turnSpeedMin: 0.003,  // minimum wander turn rate (rad/frame)
  turnSpeedMax: 0.012,  // maximum wander turn rate (rad/frame)
  wanderMinFrames: 60,  // minimum frames between direction changes
  wanderMaxFrames: 180, // maximum frames between direction changes
  sizeMin:      7,      // minimum body size (px)
  sizeMax:      11,     // maximum body size (px)
  alpha:        1,   // opacity (0–1)
};

// ── Eyeballs ───────────────────────────────────────────────────────────────────
const EYE_CONFIG = {
  count:      7,     // number of eyeballs on screen
  bumpRadius: 0,    // px -- mouse contact radius
  bumpForce:  1,     // impulse multiplier on bump
  mouseVelMix: 0.02, // how much mouse velocity transfers to the eye on bump
  friction:   0.995, // velocity multiplier per frame (1 = no friction)
  bounceDamp: 0.7,   // energy retained on wall bounce (0–1)
  sizeMin:    18,    // minimum eye radius (px)
  sizeMax:    25,    // maximum eye radius (px)
  alpha:      1,   // opacity (0–1)
};
