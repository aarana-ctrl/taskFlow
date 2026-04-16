/* TaskFlow — Gradescope login + assignment scraper (Vercel serverless).
 * POST { email, password } → returns { courses: [...], assignments: [...] }
 * Credentials are used only to authenticate and are NEVER stored or logged.
 */
const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'POST only' }); return; }

  var email    = req.body && req.body.email;
  var password = req.body && req.body.password;
  if (!email || !password) { res.status(400).json({ error: 'Missing email or password' }); return; }

  try {
    // 1. Fetch login page → extract CSRF token + initial cookies
    var loginPage = await get('https://www.gradescope.com/login', {}, []);
    var csrf = extractMeta(loginPage.body, 'csrf-token')
            || extractInput(loginPage.body, 'authenticity_token');
    if (!csrf) { res.status(502).json({ error: 'Could not fetch Gradescope login page — the site may be temporarily down.' }); return; }
    var cookies = parseCookies(loginPage.headers['set-cookie']);

    // 2. POST credentials
    var body = buildForm({
      'utf8': '✓',
      'authenticity_token': csrf,
      'session[email]': email,
      'session[password]': password,
      'session[remember_me]': '0',
      'commit': 'Log In',
    });
    var loginRes = await post('https://www.gradescope.com/login', body, cookies);
    cookies = mergeCookies(cookies, parseCookies(loginRes.headers['set-cookie']));

    // 3. Check if login succeeded — redirect to /account or dashboard on success
    var dest = loginRes.headers['location'] || '';
    if (loginRes.statusCode === 200 && loginRes.body.toLowerCase().includes('invalid email or password')) {
      res.status(401).json({ error: 'Invalid email or password' }); return;
    }
    if (loginRes.statusCode !== 302 && loginRes.statusCode !== 301) {
      // Some setups redirect with 200 and embed a redirect. Try anyway.
    }

    // 4. Fetch account page (course list)
    var accountUrl = 'https://www.gradescope.com/account';
    if (dest && dest !== '/login') {
      accountUrl = dest.startsWith('http') ? dest : 'https://www.gradescope.com' + dest;
    }
    var account = await get(accountUrl, cookies, []);
    cookies = mergeCookies(cookies, parseCookies(account.headers['set-cookie']));

    if (account.body.includes('Log In') && !account.body.includes('Log Out')) {
      res.status(401).json({ error: 'Login failed — please check your credentials.' }); return;
    }

    // 5. Extract courses
    var courses = extractCourses(account.body);

    // 6. Fetch assignments for each course (parallel, capped at 8)
    var toFetch = courses.slice(0, 8);
    var assignmentGroups = await Promise.all(toFetch.map(function(course) {
      return fetchCourseAssignments(course, cookies);
    }));

    var assignments = [];
    assignmentGroups.forEach(function(group) { assignments = assignments.concat(group); });

    res.status(200).json({ courses: courses, assignments: assignments });
  } catch (e) {
    res.status(502).json({ error: 'Gradescope sync failed: ' + (e.message || String(e)) });
  }
};

/* ── HTTP helpers ─────────────────────────────────────────── */
function get(url, cookies, _unused) {
  return request('GET', url, null, cookies);
}
function post(url, body, cookies) {
  return request('POST', url, body, cookies);
}

function request(method, url, body, cookies, redirects) {
  if (redirects === undefined) redirects = 6;
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var cookieStr = Object.entries(cookies||{}).map(function(e){return e[0]+'='+e[1];}).join('; ');
    var opts = {
      method: method,
      hostname: u.hostname,
      path: u.pathname + (u.search||''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.gradescope.com/',
        'Cookie': cookieStr,
      },
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    var req = https.request(opts, function(r) {
      if ((r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 303) && r.headers['location'] && redirects > 0) {
        var loc = r.headers['location'];
        if (!loc.startsWith('http')) loc = 'https://www.gradescope.com' + loc;
        var newCookies = mergeCookies(cookies, parseCookies(r.headers['set-cookie']));
        r.resume();
        // Follow redirect as GET
        return resolve(request('GET', loc, null, newCookies, redirects - 1));
      }
      var data = '';
      r.setEncoding('utf8');
      r.on('data', function(c){ data += c; });
      r.on('end', function(){ resolve({ statusCode: r.statusCode, headers: r.headers, body: data }); });
    });
    req.on('timeout', function(){ req.destroy(new Error('Timeout')); });
    req.on('error', reject);
    req.setTimeout(20000);
    if (body) req.write(body);
    req.end();
  });
}

function buildForm(obj) {
  return Object.entries(obj).map(function(e) {
    return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]);
  }).join('&');
}

function parseCookies(raw) {
  var out = {};
  if (!raw) return out;
  var arr = Array.isArray(raw) ? raw : [raw];
  arr.forEach(function(c) {
    var part = c.split(';')[0];
    var eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0,eq).trim()] = part.slice(eq+1).trim();
  });
  return out;
}
function mergeCookies(a, b) {
  return Object.assign({}, a, b);
}

/* ── HTML extraction helpers ──────────────────────────────── */
function extractMeta(html, name) {
  var m = html.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]*content=["\']([^"\']+)["\']', 'i'))
       || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*name=["\']' + name + '["\']', 'i'));
  return m ? decodeHTML(m[1]) : null;
}
function extractInput(html, name) {
  var m = html.match(new RegExp('<input[^>]+name=["\']' + escapeReg(name) + '["\'][^>]*value=["\']([^"\']*)["\']', 'i'))
       || html.match(new RegExp('<input[^>]+value=["\']([^"\']*)["\'][^>]*name=["\']' + escapeReg(name) + '["\']', 'i'));
  return m ? decodeHTML(m[1]) : null;
}
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
}
function decodeHTML(s) {
  return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,function(_,n){return String.fromCharCode(+n);});
}
function stripTags(s) {
  return s.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
}

function extractCourses(html) {
  var courses = [];
  // Gradescope renders courses in blocks like:
  // <a href="/courses/12345">Course name</a>
  // or inside cards with class "courseBox" or "course-card"
  var courseRegex = /<a[^>]+href="\/courses\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var seen = {};
  var m;
  while ((m = courseRegex.exec(html)) !== null) {
    var id = m[1];
    var name = stripTags(m[2]).trim();
    if (!id || !name || seen[id] || name.length < 2) continue;
    seen[id] = true;
    courses.push({ id: id, name: name });
  }
  return courses;
}

async function fetchCourseAssignments(course, cookies) {
  var url = 'https://www.gradescope.com/courses/' + course.id + '/assignments';
  var result = await get(url, cookies, []).catch(function(){ return {body:''}; });
  return parseAssignments(result.body, course);
}

function parseAssignments(html, course) {
  var assignments = [];
  // Gradescope's assignment table: rows with <a> links and date cells
  // The assignment table has class "table" or rows like:
  // <tr> <td><a href="/courses/X/assignments/Y">Name</a></td> ... <td>Jan 1, 2026 11:59 PM</td> ...
  var rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var m;
  while ((m = rowRegex.exec(html)) !== null) {
    var row = m[1];
    // Extract assignment link + name
    var linkM = row.match(/<a[^>]+href="\/courses\/\d+\/assignments\/(\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) continue;
    var assignId = linkM[1];
    var name = stripTags(linkM[2]).trim();
    if (!name) continue;

    // Extract the due date — look for date patterns in the row
    var dateStr = extractDateFromRow(row);
    if (!dateStr) continue; // skip if no due date visible

    var parsed = parseGradescopeDate(dateStr);
    if (!parsed) continue;

    // Skip already submitted / graded (optional heuristic)
    if (row.toLowerCase().includes('class="submittedBadge"') || row.includes('Submitted')) continue;

    // Build task-compatible object
    var tag = guessTag(course.name);
    assignments.push({
      uid: 'gs-' + course.id + '-' + assignId,
      summary: name,
      description: 'Course: ' + course.name,
      date: parsed.date,
      time: parsed.time,
      rrule: null,
      courseId: course.id,
      courseName: course.name,
      tag: tag,
    });
  }
  return assignments;
}

function extractDateFromRow(row) {
  // Look for patterns like "Jan 25 2026 11:59 PM" or "2026-01-25" or Unix timestamps in data attrs
  var m;
  // Preferred: data-due-at or datetime= attribute
  m = row.match(/datetime="([^"]+)"/i) || row.match(/data-due-at="([^"]+)"/i);
  if (m) return m[1];

  // Fallback: text like "Jan 25, 2026" or "January 25 at 11:59 PM"
  m = row.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}[^<]{0,20}/i);
  if (m) return m[0].replace(/<[^>]*>/g,'').trim();

  // ISO-ish
  m = row.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  if (m) return m[0];

  return null;
}

var MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function parseGradescopeDate(str) {
  if (!str) return null;
  // ISO datetime
  var iso = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) {
    var d = new Date(str);
    if (!isNaN(d)) {
      // Convert UTC to Pacific
      try {
        var fmt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
        var o={};
        fmt.forEach(function(p){if(p.type!=='literal')o[p.type]=p.value;});
        return {date:o.year+'-'+o.month+'-'+o.day, time:(o.hour==='24'?'00':o.hour)+':'+o.minute};
      } catch(e){}
    }
  }
  // "Jan 25, 2026 11:59 PM"
  var m2 = str.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (m2) {
    var mon = MONTHS[m2[1].toLowerCase().slice(0,3)];
    if (mon === undefined) return null;
    var yr = +m2[3], day2 = +m2[2];
    var hh = m2[4] ? +m2[4] : null;
    var mm = m2[5] ? +m2[5] : null;
    var ampm = (m2[6]||'').toUpperCase();
    if (hh !== null && ampm === 'PM' && hh < 12) hh += 12;
    if (hh !== null && ampm === 'AM' && hh === 12) hh = 0;
    var dateStr = yr+'-'+String(mon+1).padStart(2,'0')+'-'+String(day2).padStart(2,'0');
    var timeStr = hh !== null ? String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0') : null;
    return {date:dateStr, time:timeStr};
  }
  return null;
}

function guessTag(courseName) {
  if (!courseName) return null;
  // e.g. "CS 341: Algorithm Design" → "CS 341"
  var m = courseName.match(/\b([A-Z]{2,6})[\s\-]?(\d{2,4}[A-Z]?)\b/);
  if (m) return (m[1]+' '+m[2]).toUpperCase();
  // Return first 12 chars if nothing
  return courseName.slice(0,12).trim();
}
