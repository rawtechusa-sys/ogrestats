// ── Manual stream events ───────────────────────────────────────────────────────
// Curator-authored markers for a stream: point events, time ranges, and
// whole-stream tags. Shared by the public chart (streams.html) and the hidden
// admin editor (admin.html), so this file holds the parse rules, the tag-list
// helpers and the Chart.js overlay plugin -- everything both pages must agree on.
//
// Per-stream document (data/streams/<id>/events_manual.json):
//   { "version": 1, "events": [
//       { "id": "me_...", "kind": "point",  "ts": 1683936454, "tag": "Gaming",   "note": "" },
//       { "id": "me_...", "kind": "range",  "ts": ..., "end_ts": ..., "tag": "...", "note": "" },
//       { "id": "me_...", "kind": "stream", "tag": "Wagequit", "note": "" } ] }
// Timestamps are unix SECONDS; the stream chart's x-axis is epoch milliseconds.
//
// A goal event (tag "Initial Goal" / "Goal Changed", see GOAL_TAGS) carries one
// extra field, `value`: the positive integer members/subs threshold the streamer
// is chasing. Every other event has no `value`.
//   { "id": "me_...", "kind": "point", "ts": ..., "tag": "Initial Goal", "value": 20, "note": "" }

(function (global) {
  'use strict';

  const SEED_TAGS = ['Initial Goal', 'Goal Changed', 'Stream Ragequit', 'Wagequit', 'Ragequit', 'Gaming'];

  // The tags (lowercased) whose events carry a numeric `value` -- the goal the
  // members/subs count is chasing.
  const GOAL_TAGS = ['initial goal', 'goal changed'];

  function isGoalTag(tag) {
    return typeof tag === 'string' && GOAL_TAGS.indexOf(tag.trim().toLowerCase()) !== -1;
  }

  // One accent for every manual-event mark, on every theme.
  const ACCENT = '255,120,200';
  // Goal hits get their own accent (red) and a solid line -- the manual events
  // are dashed magenta, so the two never read as the same kind of mark.
  const GOAL_ACCENT = '229,57,53';
  const LABEL_FONT = '11px "Share Tech Mono", monospace';
  // Three stacked label rows (px below chartArea.top) before a label is dropped.
  const LABEL_ROW_OFFSETS = [4, 18, 32];
  const LABEL_GAP = 4;      // px of clear space required between two labels in a row
  const MARKER_SIZE = 6;    // px, the point event's triangle head

  // Tolerant parse of an events_manual.json document: accepts the versioned
  // object, a bare array, or anything else (-> empty). Entries are filtered, never
  // rewritten, so an editor can round-trip what it read.
  function normalize(raw) {
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object' && Array.isArray(raw.events)) list = raw.events;

    const timed = [];
    const wholeStream = [];
    for (const ev of list) {
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
      if (typeof ev.tag !== 'string' || !ev.tag.trim()) continue;
      if (ev.kind === 'stream') { wholeStream.push(ev); continue; }
      if (ev.kind !== 'point' && ev.kind !== 'range') continue;
      if (!Number.isFinite(ev.ts)) continue;
      if (ev.kind === 'range' && !(Number.isFinite(ev.end_ts) && ev.end_ts > ev.ts)) continue;
      timed.push(ev);
    }
    timed.sort((a, b) => a.ts - b.ts);
    return { timed, wholeStream };
  }

  function newId() {
    return 'me_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // Case-insensitive union of two tag lists; the first list's order and the
  // first-seen casing both win.
  function mergeTags(a, b) {
    const out = [];
    const seen = new Set();
    for (const list of [a, b]) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const display = String(raw == null ? '' : raw).trim();
        const key = display.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(display);
      }
    }
    return out;
  }

  // ── Members / subs ────────────────────────────────────────────────────────
  // The streamer's goals count heads, not money: one YouTube membership, one
  // Twitch sub and one Kick sub are all worth 1, a gift of N is worth N, and
  // everything else (superchats, bits, kicks) is worth 0.

  // Leading integer of a "<count> <something>" string; anything else is one.
  function leadingCount(raw) {
    const n = parseInt(raw, 10);
    return (Number.isFinite(n) && n > 0) ? n : 1;
  }

  // Members/subs contributed by one donation event.
  // TRAP: only the gift types carry a count. A youtube `membership` row's
  // amount_raw is a MILESTONE ("Member for 12 months") and a twitch `sub` row's
  // is a TIER ("Prime", "1000"), so parsing either would turn one sub into
  // twelve or a thousand.
  function subCount(ev) {
    if (!ev || typeof ev !== 'object') return 0;
    const platform = String(ev.platform == null ? '' : ev.platform).toLowerCase();
    const type = String(ev.type == null ? '' : ev.type).toLowerCase();
    const raw = String(ev.amount_raw == null ? '' : ev.amount_raw).trim();
    if (platform === 'youtube') {
      if (type === 'membership') return 1;
      if (type === 'giftmembership') return leadingCount(raw);   // "5 gifted memberships"
      return 0;
    }
    if (platform === 'twitch') {
      if (type === 'sub') return 1;
      // A gifted sub is "<count> <tier>" ("5 1000") for a bulk gift but a bare
      // tier ("1000") for a single one -- so only a 2+ token string has a count.
      if (type === 'giftsub') return raw.split(/\s+/).length >= 2 ? leadingCount(raw) : 1;
      return 0;
    }
    if (platform === 'kick') {
      // No Kick sub rows exist in the corpus yet; this mirrors the twitch shape
      // and has never been validated against real data.
      if (type === 'sub') return 1;
      if (type === 'giftsub') return leadingCount(raw);
      return 0;
    }
    return 0;
  }

  // The goal events of a normalized document, in the order they take effect.
  // A stream-kind goal is active from the stream's start (or from forever, when
  // the caller has no start ts); ties break on created_ts, so the goal the
  // curator wrote last wins. A goal with no usable `value` can never be hit and
  // is dropped here.
  function collectGoals(manualEvents, startTs) {
    const src = (manualEvents && typeof manualEvents === 'object') ? manualEvents : {};
    const anchor = Number.isFinite(startTs) ? startTs : -Infinity;
    const goals = [];
    for (const list of [src.timed, src.wholeStream]) {
      if (!Array.isArray(list)) continue;
      for (const ev of list) {
        if (!ev || typeof ev !== 'object' || !isGoalTag(ev.tag)) continue;
        const value = Math.floor(Number(ev.value));
        if (!Number.isFinite(value) || value <= 0) continue;
        const at = (ev.kind === 'stream') ? anchor : ev.ts;
        if (at !== -Infinity && !Number.isFinite(at)) continue;
        goals.push({
          at,
          value,
          tag: ev.tag,
          created: Number.isFinite(ev.created_ts) ? ev.created_ts : 0,
        });
      }
    }
    // -Infinity - -Infinity is NaN, so compare the ts, never subtract them.
    goals.sort((a, b) => (a.at === b.at ? a.created - b.created : (a.at < b.at ? -1 : 1)));
    return goals;
  }

  // Walk the donations in time order accumulating subCount, with the goal events
  // interleaved by the ts they take effect. Each goal is marked at most once --
  // at the donation that first takes the running count to its value, or at the
  // goal event itself when the count already meets it. Returns [{ts, value, tag}].
  function computeGoalHits(donations, manualEvents, startTs) {
    const goals = collectGoals(manualEvents, startTs);
    if (goals.length === 0) return [];
    const sorted = (Array.isArray(donations) ? donations : [])
      .filter(d => d && typeof d === 'object' && Number.isFinite(d.ts))
      .slice()
      .sort((a, b) => a.ts - b.ts);

    const hits = [];
    let running = 0;
    let active = null;
    let hit = false;      // has the ACTIVE goal been marked? a goal change resets it

    function markIfMet(ts) {
      if (!active || hit || running < active.value) return;
      if (!Number.isFinite(ts)) return;   // no anchor for a whole-stream goal; the next donation retries
      hit = true;
      hits.push({ ts, value: active.value, tag: active.tag });
    }

    let gi = 0;
    for (const d of sorted) {
      while (gi < goals.length && goals[gi].at <= d.ts) {
        active = goals[gi++];
        hit = false;
        markIfMet(active.at);
      }
      running += subCount(d);
      markIfMet(d.ts);
    }
    while (gi < goals.length) {
      active = goals[gi++];
      hit = false;
      markIfMet(active.at);
    }
    return hits;
  }

  // Chart.js inline plugin. getState() -> { events, visible, selection, goalHits }:
  //   events    -- the `timed` array (kind point/range), ts in unix seconds
  //   visible   -- legend toggle
  //   selection -- null, or { x0px, x1px } for a live drag band (admin only;
  //                already in canvas pixels, so no scale conversion)
  //   goalHits  -- optional [{ts, value, tag}] from computeGoalHits
  function makePlugin(getState) {
    function readState() {
      const state = getState ? getState() : null;
      if (!state || !state.visible) return null;
      const events = Array.isArray(state.events) ? state.events : [];
      const goalHits = Array.isArray(state.goalHits) ? state.goalHits : [];
      const selection = state.selection || null;
      if (events.length === 0 && goalHits.length === 0 && !selection) return null;
      return { events, goalHits, selection };
    }

    // A goal event's label carries its threshold: "Initial Goal: 20".
    function labelText(ev) {
      return (isGoalTag(ev.tag) && Number.isFinite(ev.value)) ? `${ev.tag}: ${ev.value}` : ev.tag;
    }

    function clipToChartArea(ctx, area) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      ctx.clip();
    }

    return {
      id: 'manualEvents',

      // Range bands sit BEHIND the data lines, like the pausing band.
      beforeDatasetsDraw(chart) {
        const state = readState();
        if (!state) return;
        const xs = chart.scales.x;
        const { left, right, top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        const height = bottom - top;
        clipToChartArea(ctx, chart.chartArea);
        for (const ev of state.events) {
          if (ev.kind !== 'range') continue;
          const edge1 = xs.getPixelForValue(ev.ts * 1000);
          const edge2 = xs.getPixelForValue(ev.end_ts * 1000);
          if (edge2 < left || edge1 > right) continue;
          const x1 = Math.max(edge1, left);
          const x2 = Math.min(edge2, right);
          if (x2 <= x1) continue;
          const g = ctx.createLinearGradient(0, top, 0, bottom);
          g.addColorStop(0, `rgba(${ACCENT},0.35)`);
          g.addColorStop(1, `rgba(${ACCENT},0.08)`);
          ctx.fillStyle = g;
          ctx.fillRect(x1, top, x2 - x1, height);
          // Edges at the true range bounds -- the clip drops the off-screen one.
          ctx.fillStyle = `rgba(${ACCENT},0.55)`;
          ctx.fillRect(edge1, top, 1, height);
          ctx.fillRect(edge2 - 1, top, 1, height);
        }
        if (state.selection) {
          const x1 = Math.max(Math.min(state.selection.x0px, state.selection.x1px), left);
          const x2 = Math.min(Math.max(state.selection.x0px, state.selection.x1px), right);
          if (x2 > x1) {
            ctx.fillStyle = `rgba(${ACCENT},0.25)`;
            ctx.fillRect(x1, top, x2 - x1, height);
          }
        }
        ctx.restore();
      },

      // Point lines and every label draw ON TOP of the data.
      afterDatasetsDraw(chart) {
        const state = readState();
        if (!state) return;
        const xs = chart.scales.x;
        const { left, right, top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        clipToChartArea(ctx, chart.chartArea);

        ctx.strokeStyle = `rgba(${ACCENT},0.85)`;
        ctx.fillStyle = `rgba(${ACCENT},0.85)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        for (const ev of state.events) {
          if (ev.kind !== 'point') continue;
          const x = xs.getPixelForValue(ev.ts * 1000);
          if (x < left || x > right) continue;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - MARKER_SIZE / 2, top);
          ctx.lineTo(x + MARKER_SIZE / 2, top);
          ctx.lineTo(x, top + MARKER_SIZE);
          ctx.closePath();
          ctx.fill();
        }
        ctx.setLineDash([]);

        // Goal hits: a SOLID line in the goal accent, so it never reads as one of
        // the dashed manual-event marks.
        ctx.strokeStyle = `rgba(${GOAL_ACCENT},0.9)`;
        ctx.fillStyle = `rgba(${GOAL_ACCENT},0.9)`;
        ctx.lineWidth = 2;
        for (const hit of state.goalHits) {
          const x = xs.getPixelForValue(hit.ts * 1000);
          if (x < left || x > right) continue;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - MARKER_SIZE / 2, top);
          ctx.lineTo(x + MARKER_SIZE / 2, top);
          ctx.lineTo(x, top + MARKER_SIZE);
          ctx.closePath();
          ctx.fill();
        }

        // Labels, left to right, greedily stacked into the first row that has
        // horizontal space; an event that collides in all rows loses its label
        // (its line/band is already drawn). Goal-hit labels share the same rows.
        ctx.font = LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const rows = LABEL_ROW_OFFSETS.map(() => []);
        function placeLabel(text, x, width, color) {
          const rowIndex = rows.findIndex(
            row => row.every(placed => x + width + LABEL_GAP <= placed.x || x >= placed.x + placed.width + LABEL_GAP)
          );
          if (rowIndex === -1) return;
          rows[rowIndex].push({ x, width });
          ctx.fillStyle = color;
          ctx.fillText(text, x, top + LABEL_ROW_OFFSETS[rowIndex]);
        }
        for (const ev of state.events) {
          const text = labelText(ev);
          const width = ctx.measureText(text).width;
          let x = null;
          if (ev.kind === 'point') {
            const at = xs.getPixelForValue(ev.ts * 1000);
            if (at < left || at > right) continue;
            x = (at + 2 + width > right) ? at - 2 - width : at + 2;
          } else if (ev.kind === 'range') {
            const x1 = Math.max(xs.getPixelForValue(ev.ts * 1000), left);
            const x2 = Math.min(xs.getPixelForValue(ev.end_ts * 1000), right);
            if (x2 - x1 < width) continue;
            x = (x1 + x2) / 2 - width / 2;
          } else {
            continue;
          }
          placeLabel(text, x, width, `rgba(${ACCENT},0.95)`);
        }
        for (const hit of state.goalHits) {
          const at = xs.getPixelForValue(hit.ts * 1000);
          if (at < left || at > right) continue;
          const text = `Goal hit (${hit.value})`;
          const width = ctx.measureText(text).width;
          const x = (at + 2 + width > right) ? at - 2 - width : at + 2;
          placeLabel(text, x, width, `rgba(${GOAL_ACCENT},0.95)`);
        }
        ctx.restore();
      },
    };
  }

  global.ManualEvents = {
    SEED_TAGS, GOAL_TAGS, isGoalTag,
    normalize, newId, mergeTags,
    subCount, computeGoalHits,
    makePlugin,
  };
})(window);
