// ── Curator VOD link overrides ─────────────────────────────────────────────────
// A curator can replace a stream's Original (source) and Archive links from
// admin.html. Those links normally derive from pipeline ids in metadata.json, and
// dents/tts/chat read copies of the ids out of precomputed aggregates, so the
// replacements live in one separate file that every page reads directly.
//
// data/vod_overrides.json -- curator-owned. The pipeline never reads or writes it,
// so a re-push or an aggregate rebuild cannot touch it, and it has no rebuild
// script: this file is the only copy.
//   { "version": 1,
//     "streams": { "<stream_id>": { "source_url": "https://...",
//                                   "archive_url": "https://..." } } }
//
// An override outranks every pipeline value. The pipeline ids stay in place, so
// removing an override restores the original link.

(function (global) {
  const FILE = 'data/vod_overrides.json';

  let streams = {};
  let pending = null;

  // The normalized https URL, or null. Every value passes through here on read as
  // well as on save, because pages place these strings into href attributes. URL
  // serialization percent-encodes the double quotes those attributes depend on.
  function clean(raw) {
    if (typeof raw !== 'string') return null;
    let url;
    try { url = new URL(raw.trim()); } catch { return null; }
    return url.protocol === 'https:' ? url.href : null;
  }

  function setDoc(doc) {
    const map = doc && doc.streams;
    streams = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  }

  // Fetched once per page. A missing file (the normal state before the first
  // override) or a failed fetch leaves the map empty: the pipeline links still
  // work, so this never rejects.
  function load(rawBase) {
    if (!pending) {
      pending = fetch(`${rawBase}/${FILE}`)
        .then(r => (r.ok ? r.json() : null))
        .then(setDoc)
        .catch(() => {});
    }
    return pending;
  }

  function sourceUrl(id) {
    const entry = streams[id];
    return entry ? clean(entry.source_url) : null;
  }

  function archiveUrl(id) {
    const entry = streams[id];
    return entry ? clean(entry.archive_url) : null;
  }

  // Stamp the overrides onto one stream's metadata, for the link builders that
  // receive the metadata object without its id.
  function apply(id, meta) {
    if (!meta) return meta;
    meta.source_url_override = sourceUrl(id);
    meta.archive_url_override = archiveUrl(id);
    return meta;
  }

  function applyAll(map) {
    for (const id of Object.keys(map || {})) apply(id, map[id]);
    return map;
  }

  // The override URL opened `tSec` seconds in, for the hosts with a known time
  // parameter. Any other host gets the plain URL, which opens at the start.
  function deepLink(raw, tSec) {
    const href = clean(raw);
    if (!href) return null;
    const url = new URL(href);
    const t = Math.max(0, Math.floor(Number(tSec) || 0));
    const host = url.hostname.replace(/^(www|m)\./, '');

    if (host === 'youtu.be' || host === 'youtube.com') {
      url.searchParams.set('t', String(t));
    } else if (host === 'twitch.tv') {
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
      url.searchParams.set('t', `${h}h${m}m${s}s`);
    } else if (host === 'rumble.com') {
      url.searchParams.set('start', String(t));
    } else if (host === 'archive.org') {
      // The player honors ?start=, and the /details/ landing page does not.
      url.pathname = url.pathname.replace(/^\/details\//, '/embed/');
      url.searchParams.set('start', String(t));
    }
    return url.href;
  }

  global.VodOverrides = {
    FILE, clean, setDoc, load, sourceUrl, archiveUrl, apply, applyAll, deepLink,
  };
})(typeof window !== 'undefined' ? window : globalThis);
