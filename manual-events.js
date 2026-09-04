// ── Stream chart marker overlay ────────────────────────────────────────────────
// Every timestamped mark drawn over a stream chart, and the parse rules behind
// them. Shared by the public chart (streams.html) and the hidden admin editor
// (admin.html), so this file holds everything both pages must agree on.
//
// Two sources, deliberately in one file because they share the drawing and the
// label-collision machinery:
//   - CURATOR-AUTHORED events (point / range / whole-stream tags), edited in
//     admin.html and stored per stream in events_manual.json. Magenta.
//   - PIPELINE-DERIVED moderation events (bans / timeouts / unbans), read
//     straight out of the stream's events.jsonl. Red, and nobody edits them.
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
  // Moderation is red too, so it is kept apart from goal hits by POSITION
  // rather than colour: its marker head sits on the bottom edge and its labels
  // use the bottom rows, while both top-anchored styles keep the top rows.
  const MOD_ACCENT = '255,82,82';
  const LABEL_FONT = '11px "Share Tech Mono", monospace';
  // Three stacked label rows (px below chartArea.top) before a label is dropped.
  const LABEL_ROW_OFFSETS = [4, 18, 32];
  // The mirror set for RANGE labels, which live at the foot of the chart: px
  // ABOVE chartArea.bottom, same 14px row pitch, same drop-on-collision rule.
  const LABEL_BOTTOM_ROW_OFFSETS = [6, 20, 34];
  const LABEL_GAP = 4;      // px of clear space required between two labels in a row
  const LABEL_LINE_HEIGHT = 11;   // px, matches LABEL_FONT -- sizes the label backing plate
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

  // ── Moderation events ─────────────────────────────────────────────────────
  // Rows the pipeline wrote into the stream's events.jsonl. The backend records
  // what each platform actually reports, which differs: Twitch and Kick give an
  // exact ban-vs-timeout (with a duration), while YouTube can only say a
  // moderator removed the user -- hence `removed`. `unban` rows are inferred by
  // the backend, never reported by any platform.

  const MOD_TYPE_LABELS = {
    ban:     'Ban',
    timeout: 'Timeout',
    unban:   'Unban',
    removed: 'Removed',
  };

  function modTypeLabel(type) {
    const key = String(type == null ? '' : type).trim().toLowerCase();
    return MOD_TYPE_LABELS[key] || (key ? key : 'Moderation');
  }

  // Compact duration for a timeout label: 45s / 10m / 2h / 1d.
  function modDuration(seconds) {
    const s = Math.floor(Number(seconds));
    if (!Number.isFinite(s) || s <= 0) return '';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  }

  // "Ban: someone", or "Timeout: someone (10m)" when a duration is known.
  // Type-first so a stack of labels lines up on the left.
  function modLabel(ev) {
    const dur = modDuration(ev && ev.duration);
    return `${modTypeLabel(ev && ev.type)}: ${(ev && ev.username) || ''}`
         + (dur ? ` (${dur})` : '');
  }

  // Pull the moderation rows out of a parsed events.jsonl. Filters, never
  // rewrites (mirroring normalize() above).
  //
  // A row with no username is dropped: that is a YouTube removal whose channel
  // id never appeared in chat, so there is no name to put on the marker. The
  // raw event still lives in events.jsonl.
  function normalizeModeration(events) {
    const out = [];
    for (const ev of (Array.isArray(events) ? events : [])) {
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) continue;
      if (ev.event !== 'moderation') continue;
      if (!Number.isFinite(ev.ts)) continue;
      if (typeof ev.username !== 'string' || !ev.username.trim()) continue;
      out.push(ev);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
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

  // Chart.js inline plugin. getState() -> { events, visible, selection,
  //                                         goalHits, modEvents, modVisible }:
  //   events     -- the `timed` array (kind point/range), ts in unix seconds
  //   visible    -- legend toggle for the curator events
  //   selection  -- null, or { x0px, x1px } for a live drag band (admin only;
  //                 already in canvas pixels, so no scale conversion)
  //   goalHits   -- optional [{ts, value, tag}] from computeGoalHits
  //   modEvents  -- optional moderation rows from normalizeModeration
  //   modVisible -- separate legend toggle for those (they have their own
  //                 source and their own legend item, so `visible` must not
  //                 hide them too)
  function makePlugin(getState) {
    function readState() {
      const state = getState ? getState() : null;
      if (!state) return null;
      const curatorOn = !!state.visible;
      const events = (curatorOn && Array.isArray(state.events)) ? state.events : [];
      const goalHits = (curatorOn && Array.isArray(state.goalHits)) ? state.goalHits : [];
      const selection = curatorOn ? (state.selection || null) : null;
      const modEvents = (state.modVisible !== false && Array.isArray(state.modEvents))
        ? state.modEvents : [];
      if (events.length === 0 && goalHits.length === 0 && modEvents.length === 0 && !selection) {
        return null;
      }
      return { events, goalHits, selection, modEvents };
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

        // Moderation: DOTTED, and its square head sits on the BOTTOM edge. Red
        // like the goal hits, so position and line style are what tell the two
        // apart -- see MOD_ACCENT.
        ctx.strokeStyle = `rgba(${MOD_ACCENT},0.8)`;
        ctx.fillStyle = `rgba(${MOD_ACCENT},0.9)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 3]);
        for (const ev of state.modEvents) {
          const x = xs.getPixelForValue(ev.ts * 1000);
          if (x < left || x > right) continue;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillRect(x - MARKER_SIZE / 2, bottom - MARKER_SIZE, MARKER_SIZE, MARKER_SIZE);
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - MARKER_SIZE / 2, bottom - MARKER_SIZE, MARKER_SIZE, MARKER_SIZE);
          ctx.strokeStyle = `rgba(${MOD_ACCENT},0.8)`;
          ctx.lineWidth = 2;
          ctx.setLineDash([2, 3]);
        }
        ctx.setLineDash([]);

        // Labels, left to right, greedily stacked into the first row that has
        // horizontal space; an event that collides in all rows loses its label
        // (its line/band is already drawn). POINT labels and goal-hit labels
        // share the top rows; RANGE labels get their own rows at the bottom, so
        // a wide band never eats the top space a point label needs.
        ctx.font = LABEL_FONT;
        ctx.textAlign = 'left';
        const topRows = LABEL_ROW_OFFSETS.map(() => []);
        const bottomRows = LABEL_BOTTOM_ROW_OFFSETS.map(() => []);
        // Index of the first row with clear horizontal space, or -1; claims it.
        function claimRow(rowSet, x, width) {
          const rowIndex = rowSet.findIndex(
            row => row.every(placed => x + width + LABEL_GAP <= placed.x || x >= placed.x + placed.width + LABEL_GAP)
          );
          if (rowIndex !== -1) rowSet[rowIndex].push({ x, width });
          return rowIndex;
        }
        function placeLabel(text, x, width, color) {
          const rowIndex = claimRow(topRows, x, width);
          if (rowIndex === -1) return;
          ctx.fillStyle = color;
          ctx.textBaseline = 'top';
          ctx.fillText(text, x, top + LABEL_ROW_OFFSETS[rowIndex]);
        }
        // `backing` draws a dark plate behind the text first. The bottom rows sit
        // in the busiest part of the canvas -- right on top of the viewer and
        // msg/min series near the axis -- where bare coloured text is unreadable.
        // The top rows don't need it: that end of the chart is mostly empty.
        function placeBottomLabel(text, x, width, color, backing) {
          const rowIndex = claimRow(bottomRows, x, width);
          if (rowIndex === -1) return;
          const y = bottom - LABEL_BOTTOM_ROW_OFFSETS[rowIndex];
          if (backing) {
            ctx.fillStyle = 'rgba(0,0,0,0.62)';
            ctx.fillRect(x - 3, y - LABEL_LINE_HEIGHT, width + 6, LABEL_LINE_HEIGHT + 3);
          }
          ctx.fillStyle = color;
          ctx.textBaseline = 'bottom';
          ctx.fillText(text, x, y);
        }
        for (const ev of state.events) {
          const text = labelText(ev);
          const width = ctx.measureText(text).width;
          if (ev.kind === 'point') {
            const at = xs.getPixelForValue(ev.ts * 1000);
            if (at < left || at > right) continue;
            const x = (at + 2 + width > right) ? at - 2 - width : at + 2;
            placeLabel(text, x, width, `rgba(${ACCENT},0.95)`);
          } else if (ev.kind === 'range') {
            const x1 = Math.max(xs.getPixelForValue(ev.ts * 1000), left);
            const x2 = Math.min(xs.getPixelForValue(ev.end_ts * 1000), right);
            if (x2 <= x1) continue;   // band not visible at all
            // A label wider than its band overflows it; clamp into the chart
            // area so it stays readable at the edges.
            const x = Math.min(Math.max((x1 + x2) / 2 - width / 2, left), Math.max(right - width, left));
            placeBottomLabel(text, x, width, `rgba(${ACCENT},0.95)`);
          }
        }
        for (const hit of state.goalHits) {
          const at = xs.getPixelForValue(hit.ts * 1000);
          if (at < left || at > right) continue;
          const text = `Goal hit (${hit.value})`;
          const width = ctx.measureText(text).width;
          const x = (at + 2 + width > right) ? at - 2 - width : at + 2;
          placeLabel(text, x, width, `rgba(${GOAL_ACCENT},0.95)`);
        }
        // Moderation labels claim the BOTTOM rows, beside their marker head --
        // so a run of bans can never crowd out the curator/goal labels above.
        for (const ev of state.modEvents) {
          const at = xs.getPixelForValue(ev.ts * 1000);
          if (at < left || at > right) continue;
          const text = modLabel(ev);
          const width = ctx.measureText(text).width;
          const x = (at + 4 + width > right) ? at - 4 - width : at + 4;
          placeBottomLabel(text, x, width, `rgba(${MOD_ACCENT},1)`, true);
        }
        ctx.restore();
      },
    };
  }

  global.ManualEvents = {
    SEED_TAGS, GOAL_TAGS, isGoalTag,
    normalize, newId, mergeTags,
    subCount, computeGoalHits,
    MOD_ACCENT, MOD_TYPE_LABELS,
    normalizeModeration, modLabel, modTypeLabel, modDuration,
    makePlugin,
  };
})(window);
