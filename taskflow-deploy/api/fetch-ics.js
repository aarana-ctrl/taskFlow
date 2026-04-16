/* TaskFlow — ICS fetcher & parser (Vercel serverless).
 * Accepts { url } via GET ?url=... or POST JSON body.
 * Fetches the iCal feed server-side (bypasses browser CORS)
 * and returns a normalized { events: [...] } JSON payload.
 */
const https = require('https');
const http  = require('http');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  var url = (req.query && req.query.url) || (req.body && req.body.url);
  if (!url) { res.status(400).json({ error: 'Missing url parameter' }); return; }

  // Accept webcal:// too — swap to https
  if (/^webcal:\/\//i.test(url)) url = url.replace(/^webcal:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(url)) { res.status(400).json({ error: 'URL must be http(s) or webcal' }); return; }

  try {
    var text = await fetchText(url, 6);
    var events = parseICS(text);
    res.status(200).json({ events: events, count: events.length });
  } catch (e) {
    res.status(502).json({ error: 'Fetch failed: ' + (e.message || String(e)) });
  }
};

function fetchText(url, maxRedirects) {
  return new Promise(function (resolve, reject) {
    function go(u, left) {
      var lib = u.indexOf('https') === 0 ? https : http;
      var req = lib.get(u, {
        headers: {
          'User-Agent': 'TaskFlow/1.0 (+https://taskflow.app)',
          'Accept': 'text/calendar, text/plain, */*',
        },
        timeout: 15000,
      }, function (r) {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && left > 0) {
          var next = r.headers.location;
          if (next.indexOf('http') !== 0) {
            var base = new URL(u);
            next = base.origin + (next[0] === '/' ? next : '/' + next);
          }
          r.resume();
          return go(next, left - 1);
        }
        if (r.statusCode && r.statusCode >= 400) {
          reject(new Error('HTTP ' + r.statusCode));
          r.resume();
          return;
        }
        var data = '';
        r.setEncoding('utf8');
        r.on('data', function (c) { data += c; });
        r.on('end', function () { resolve(data); });
      });
      req.on('timeout', function () { req.destroy(new Error('Request timed out')); });
      req.on('error', reject);
    }
    go(url, maxRedirects);
  });
}

function parseICS(text) {
  if (!text) return [];
  // Unfold RFC 5545 continuation lines (any CRLF followed by SP or TAB)
  var unfolded = text.replace(/\r?\n[ \t]/g, '');
  var lines = unfolded.split(/\r?\n/);
  var events = [];
  var ev = null;
  var inAlarm = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { ev = {}; inAlarm = false; continue; }
    if (line === 'END:VEVENT')   { if (ev) events.push(ev); ev = null; continue; }
    if (line === 'BEGIN:VALARM') { inAlarm = true; continue; }
    if (line === 'END:VALARM')   { inAlarm = false; continue; }
    if (!ev || inAlarm) continue;
    var idx = line.indexOf(':');
    if (idx < 0) continue;
    var keyPart = line.substring(0, idx);
    var value   = line.substring(idx + 1);
    var segs = keyPart.split(';');
    var key  = segs[0].toUpperCase();
    var params = {};
    for (var p = 1; p < segs.length; p++) {
      var eq = segs[p].indexOf('=');
      if (eq > 0) params[segs[p].substring(0, eq).toUpperCase()] = segs[p].substring(eq + 1);
    }
    if (key === 'SUMMARY')          ev.summary = decodeIcsText(value);
    else if (key === 'DESCRIPTION') ev.description = decodeIcsText(value);
    else if (key === 'LOCATION')    ev.location = decodeIcsText(value);
    else if (key === 'UID')         ev.uid = value;
    else if (key === 'URL')         ev.url = value;
    else if (key === 'RRULE')       ev.rrule = value;
    else if (key === 'DTSTART')     ev._start = { value: value, params: params };
    else if (key === 'DTEND')       ev._end   = { value: value, params: params };
  }
  return events.map(function (e) {
    var s = parseIcsDate(e._start);
    return {
      uid: e.uid || '',
      summary: (e.summary || '').trim(),
      description: (e.description || '').trim(),
      location: (e.location || '').trim(),
      url: e.url || '',
      date: s ? s.date : null,  // YYYY-MM-DD
      time: s ? s.time : null,  // HH:MM (null for all-day)
      rrule: e.rrule || null,
    };
  }).filter(function (e) { return e.summary && e.date; });
}

function decodeIcsText(s) {
  return String(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcsDate(dt) {
  if (!dt) return null;
  var v = dt.value;
  // All-day: YYYYMMDD
  var mDate = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (mDate) return { date: mDate[1] + '-' + mDate[2] + '-' + mDate[3], time: null };

  // Datetime: YYYYMMDDTHHMMSS[Z]
  var mDt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (mDt) {
    var y  = mDt[1], mo = mDt[2], d = mDt[3], h = mDt[4], mi = mDt[5], z = mDt[7];
    if (z === 'Z') {
      // UTC — convert to client's *assumed* local (America/Los_Angeles style approx).
      // We return UTC-adjusted to America/Los_Angeles (-8 / -7 DST) since most UW users are Pacific.
      // Client can re-adjust if needed — this is "best effort" for a static feed.
      try {
        var utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +mDt[6]));
        // Format in Los Angeles timezone
        var fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(utc);
        var o = {};
        fmt.forEach(function (pt) { if (pt.type !== 'literal') o[pt.type] = pt.value; });
        return {
          date: o.year + '-' + o.month + '-' + o.day,
          time: (o.hour === '24' ? '00' : o.hour) + ':' + o.minute,
        };
      } catch (e) {
        return { date: y + '-' + mo + '-' + d, time: h + ':' + mi };
      }
    }
    // Floating or TZID-bound local time — treat as given
    return { date: y + '-' + mo + '-' + d, time: h + ':' + mi };
  }
  return null;
}
