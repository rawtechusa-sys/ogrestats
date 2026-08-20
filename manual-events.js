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

(function (global) {
  'use strict';

  const SEED_TAGS = ['Initial Goal', 'Goal Changed', 'Stream Ragequit', 'Wagequit', 'Ragequit', 'Gaming'];

  // One accent for every manual-event mark, on every theme.
  const ACCENT = '255,120,200';
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

  // Chart.js inline plugin. getState() -> { events, visible, selection }:
  //   events    -- the `timed` array (kind point/range), ts in unix seconds
  //   visible   -- legend toggle
  //   selection -- null, or { x0px, x1px } for a live drag band (admin only;
  //                already in canvas pixels, so no scale conversion)
  function makePlugin(getState) {
    function readState() {
      const state = getState ? getState() : null;
      if (!state || !state.visible) return null;
      const events = Array.isArray(state.events) ? state.events : [];
      const selection = state.selection || null;
      if (events.length === 0 && !selection) return null;
      return { events, selection };
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

        // Labels, left to right, greedily stacked into the first row that has
        // horizontal space; an event that collides in all rows loses its label
        // (its line/band is already drawn).
        ctx.font = LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(${ACCENT},0.95)`;
        const rows = LABEL_ROW_OFFSETS.map(() => []);
        for (const ev of state.events) {
          const width = ctx.measureText(ev.tag).width;
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
          const rowIndex = rows.findIndex(
            row => row.every(placed => x + width + LABEL_GAP <= placed.x || x >= placed.x + placed.width + LABEL_GAP)
          );
          if (rowIndex === -1) continue;
          rows[rowIndex].push({ x, width });
          ctx.fillText(ev.tag, x, top + LABEL_ROW_OFFSETS[rowIndex]);
        }
        ctx.restore();
      },
    };
  }

  global.ManualEvents = { SEED_TAGS, normalize, newId, mergeTags, makePlugin };
})(window);
