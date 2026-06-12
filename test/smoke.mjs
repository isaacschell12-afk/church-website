/* HTTP smoke tests — run against a live server (local dev or CI).
   No dependencies: plain Node 20+ fetch.

   Usage: node test/smoke.mjs [base-url]   (default http://localhost:3000) */

const BASE = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function get(path, opts = {}) {
  return fetch(BASE + path, { redirect: 'manual', ...opts });
}

// ── Public pages render with expected content ───────────────────────────────
const PAGES = [
  ['/', '<title>'],
  ['/about', 'About'],
  ['/beliefs', 'Believe'],
  ['/visit', 'Visit'],
  ['/sunday-school', 'Sunday School'],
  ['/ministries', 'Ministries'],
  ['/sermons', 'Sermons'],
  ['/events', 'Events'],
  ['/give', 'Give'],
  ['/contact', 'Contact'],
];

console.log(`smoke tests against ${BASE}\n`);

for (const [path, marker] of PAGES) {
  const res = await get(path);
  const body = await res.text();
  check(`GET ${path} → 200`, res.status === 200, `got ${res.status}`);
  check(`GET ${path} contains "${marker}"`, body.includes(marker));
}

// ── Health, 404, security headers ───────────────────────────────────────────
{
  const res = await get('/health');
  const json = await res.json().catch(() => ({}));
  check('GET /health → ok', res.status === 200 && json.status === 'ok');
}
{
  const res = await get('/no-such-page-zzz');
  check('GET /no-such-page-zzz → 404', res.status === 404, `got ${res.status}`);
}
{
  const res = await get('/');
  check(
    'CSP header present',
    String(res.headers.get('content-security-policy') || '').includes("default-src 'self'")
  );
  check(
    'gzip/br compression active',
    ['gzip', 'br', 'deflate'].includes(res.headers.get('content-encoding'))
  );
}
{
  const res = await get('/css/main.css');
  check(
    'versioned static assets cached immutable',
    String(res.headers.get('cache-control') || '').includes('immutable'),
    `got ${res.headers.get('cache-control')}`
  );
}

// ── SEO + feeds ──────────────────────────────────────────────────────────────
{
  const res = await get('/robots.txt');
  const body = await res.text();
  check('robots.txt has sitemap line', res.status === 200 && body.includes('Sitemap:'));
}
{
  const res = await get('/sitemap.xml');
  const body = await res.text();
  check('sitemap.xml lists /sermons', res.status === 200 && body.includes('/sermons'));
}
{
  const res = await get('/sermons/feed.xml');
  const body = await res.text();
  check(
    'sermons RSS feed valid shell',
    res.status === 200 && body.includes('<rss') && body.includes('<channel>')
  );
}
{
  const res = await get('/events.ics');
  const body = await res.text();
  check(
    'events iCal feed valid shell',
    res.status === 200 && body.startsWith('BEGIN:VCALENDAR') && body.trimEnd().endsWith('END:VCALENDAR')
  );
}
{
  const res = await get('/site.webmanifest');
  const json = await res.json().catch(() => ({}));
  check('web manifest has icons', res.status === 200 && Array.isArray(json.icons) && json.icons.length >= 2);
}

// ── Admin auth flow ──────────────────────────────────────────────────────────
function cookieJar(res) {
  return (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0])
    .join('; ');
}

{
  const res = await get('/admin');
  check(
    'GET /admin unauthenticated → redirect to login',
    res.status >= 300 && res.status < 400 && String(res.headers.get('location')).includes('/admin/login')
  );
}
{
  // Fetch the login page for the CSRF cookie + token, then log in.
  const loginPage = await get('/admin/login');
  const loginBody = await loginPage.text();
  check('login page is noindexed', loginBody.includes('noindex'));

  const csrfCookies = cookieJar(loginPage);
  const tokenMatch = loginBody.match(/name="csrf-token" content="([^"]+)"/);
  check('login page exposes CSRF token', Boolean(tokenMatch && csrfCookies));

  const user = process.env.SMOKE_ADMIN_USER || process.env.DEFAULT_ADMIN_USER || 'admin';
  const pass = process.env.SMOKE_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '';
  const login = await get('/admin/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: csrfCookies,
    },
    body: new URLSearchParams({
      _csrf: tokenMatch ? tokenMatch[1] : '',
      username: user,
      password: pass,
    }),
  });
  const authed = login.status === 302 && String(login.headers.get('location')) === '/admin';
  check('POST /admin/login with valid credentials → /admin', authed, `got ${login.status} → ${login.headers.get('location')}`);

  if (authed) {
    const session = [csrfCookies, cookieJar(login)].filter(Boolean).join('; ');
    const dash = await get('/admin', { headers: { cookie: session } });
    const dashBody = await dash.text();
    check('dashboard renders for signed-in admin', dash.status === 200 && dashBody.includes('Dashboard'));

    const account = await get('/admin/account', { headers: { cookie: session } });
    const accountBody = await account.text();
    check(
      'account page renders change-password form',
      account.status === 200 && accountBody.includes('Change Password')
    );

    const search = await get('/admin/sermons?q=zzz_no_such_sermon', { headers: { cookie: session } });
    const searchBody = await search.text();
    check(
      'admin sermon search renders empty state',
      search.status === 200 && searchBody.includes('No sermons match')
    );

    // A fresh database has only the seeded admin; their own row hides the
    // role/reset controls (self-guard), so assert the guard markers instead.
    const users = await get('/admin/users', { headers: { cookie: session } });
    const usersBody = await users.text();
    check(
      'users page renders with self-guard markers',
      users.status === 200 && usersBody.includes('(you)') && usersBody.includes('Add New User')
    );
  }
}
{
  // Wrong password must NOT log in (and must not reveal which field was wrong).
  const loginPage = await get('/admin/login');
  const body = await loginPage.text();
  const tokenMatch = body.match(/name="csrf-token" content="([^"]+)"/);
  const res = await get('/admin/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieJar(loginPage),
    },
    body: new URLSearchParams({
      _csrf: tokenMatch ? tokenMatch[1] : '',
      username: 'admin',
      password: 'definitely-not-the-password',
    }),
  });
  check(
    'wrong password rejected',
    res.status === 302 && String(res.headers.get('location')).includes('error'),
    `got ${res.status} → ${res.headers.get('location')}`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
