// ── Ogre World Frontend Config ─────────────────────────────────────────────────
// Edit this file to configure the dashboard without touching index.html.

// ── GitHub repo ────────────────────────────────────────────────────────────────
const GITHUB_OWNER = 'rawtechusa-sys';
const GITHUB_REPO  = 'ogrestats';
const BRANCH       = 'main';

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
  alpha:        0.55,   // opacity (0–1)
};

// ── Eyeballs ───────────────────────────────────────────────────────────────────
const EYE_CONFIG = {
  count:      5,     // number of eyeballs on screen
  bumpRadius: 31,    // px -- mouse contact radius
  bumpForce:  1,     // impulse multiplier on bump
  mouseVelMix: 0.07, // how much mouse velocity transfers to the eye on bump
  friction:   0.995, // velocity multiplier per frame (1 = no friction)
  bounceDamp: 0.7,   // energy retained on wall bounce (0–1)
  sizeMin:    25,    // minimum eye radius (px)
  sizeMax:    30,    // maximum eye radius (px)
  alpha:      0.5,   // opacity (0–1)
};
