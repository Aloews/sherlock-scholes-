#!/usr/bin/env node
/**
 * check-voice — the server half of the voice channel, checked from outside.
 *
 * WHY THIS EXISTS. Voice failed on production with one symptom — the lobby
 * said "Недоступен" — and four possible causes that nobody could tell apart
 * (docs/LOBBY_AND_VOICE_FIXES.md §3). Half of them live on the server and can
 * be checked from anywhere; the other half need a real Telegram client. This
 * script settles the first half, so a device only has to answer the rest.
 *
 * Each link was checked BY HAND once, during that investigation, and the
 * findings went stale the moment anything was redeployed. Here they are as a
 * command.
 *
 *   1. preflight        the function answers OPTIONS, and the headers it
 *                       allows cover the ones supabase-js actually sends.
 *                       A mismatch is invisible in the server log: the
 *                       browser gets its 200 and then silently drops the POST,
 *                       which is exactly the reported symptom.
 *   2. reachable        POST with an empty body must be 400 bad_request.
 *                       503 means the provider's secrets are missing — and
 *                       the answer now NAMES which ones.
 *   3. identity         POST with unsigned initData must be 401 unauthorized —
 *                       proof the HMAC check is live and a forged session
 *                       cannot get a token.
 *   4. provider         which service this deployment signs for, and whether
 *                       the frontend in this environment agrees with it.
 *
 * It also prints a VARIABLE INVENTORY: every value each provider needs, where
 * it goes, and whether this environment has it. Server secrets cannot be read
 * from outside by design, so those are reported as "server-side" and are
 * confirmed by check 2 rather than by looking.
 *
 * What it deliberately does NOT check: whether a real Telegram client supplies
 * initData. That cannot be faked from outside by design, which is the whole
 * reason the remaining unknown needs a device.
 *
 * Read-only: it never obtains a usable token and changes nothing.
 *
 *   node scripts/check-voice.mjs
 *   node scripts/check-voice.mjs --vars     # inventory only, no network
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ prefixed) in the env.
 * Exit code 0 when every check passes, 1 otherwise.
 */

const varsOnly = process.argv.includes('--vars');

const url =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// ─── What each provider needs, and where it goes ───────────────────────────
// The single source of truth for "which variables do I have to add". The
// prose lives in docs/VOICE_PROVIDERS.md; this is the part that has to stay
// true, so it is the part a command reads.
const PROVIDERS = {
  livekit: {
    label: 'LiveKit',
    client: [
      ['VITE_LIVEKIT_URL', 'wss://<project>.livekit.cloud — the server address. Public.'],
    ],
    server: [
      ['LIVEKIT_API_KEY', 'Settings → Keys in LiveKit Cloud.'],
      ['LIVEKIT_API_SECRET', 'Shown once beside the key. Signs tokens — never VITE_.'],
    ],
  },
  daily: {
    label: 'Daily.co',
    client: [
      ['VITE_VOICE_ENABLED', 'true — Daily needs no public address, so this is what turns the UI on.'],
    ],
    server: [
      ['DAILY_API_KEY', 'Dashboard → Developers. Creates rooms and mints meeting tokens.'],
      ['DAILY_DOMAIN', '<team>.daily.co — the domain your rooms live under.'],
    ],
  },
  agora: {
    label: 'Agora',
    client: [
      ['VITE_VOICE_ENABLED', "true — Agora's app id travels with the token, so nothing public is needed here."],
    ],
    server: [
      ['AGORA_APP_ID', 'Console → Project. Public, but sent by the server so one place decides.'],
      ['AGORA_APP_CERTIFICATE', 'Console → Project → Primary certificate. Signs tokens — never VITE_.'],
    ],
  },
};

const SHARED_CLIENT = [
  ['VITE_VOICE_PROVIDER', 'livekit | daily | agora. Unset means livekit, which is what production runs.'],
];

function inventory() {
  const chosen = process.env.VITE_VOICE_PROVIDER || process.env.VOICE_PROVIDER || 'livekit';
  const known = Object.hasOwn(PROVIDERS, chosen);
  console.log('\nVariables\n');
  console.log(`  This environment selects: ${chosen}${known ? '' : '   ← nobody implements that one'}\n`);

  const mark = (name) => (process.env[name] ? '  set  ' : 'MISSING');

  console.log('  Frontend (Vercel → Environment Variables; compiled into the bundle):');
  for (const [name, why] of SHARED_CLIENT) console.log(`    [${mark(name)}] ${name.padEnd(21)} ${why}`);
  for (const [id, p] of Object.entries(PROVIDERS)) {
    for (const [name, why] of p.client) {
      console.log(`    [${id === chosen ? mark(name) : '  n/a  '}] ${name.padEnd(21)} ${p.label}: ${why}`);
    }
  }

  console.log('\n  Server (supabase secrets set …; NEVER in the repo, never VITE_):');
  console.log(`    [ server ] ${'VOICE_PROVIDER'.padEnd(23)} livekit | daily | agora. The server's choice is the one that counts.`);
  for (const [id, p] of Object.entries(PROVIDERS)) {
    for (const [name, why] of p.server) {
      console.log(`    [ server ] ${name.padEnd(23)} ${p.label}: ${why}${id === chosen ? '   ← needed now' : ''}`);
    }
  }
  console.log(
    '\n  Secrets cannot be read from outside, which is the point. Check 2 below\n' +
    '  confirms them: 400 when they are set, 503 naming the gap when they are not.\n');
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
}

// Exactly what supabase-js puts on the wire for functions.invoke(). Verified
// against @supabase/supabase-js 2.106.2 by capturing the request; if the
// client starts sending more, this list is what has to grow with it.
const CLIENT_HEADERS = ['authorization', 'apikey', 'content-type', 'x-client-info'];

async function main() {
  inventory();
  if (varsOnly) return;

  if (!url || !anon) {
    console.error('SUPABASE_URL / SUPABASE_ANON_KEY not set (VITE_ prefixes also accepted)');
    process.exit(1);
  }

  // The function name is historical: it issues tokens for whichever service is
  // configured. See supabase/functions/livekit-token/index.ts.
  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/livekit-token`;
  console.log(`check-voice — ${endpoint}\n`);

  // ─── 1. preflight ────────────────────────────────────────
  try {
    const res = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.telegram.org',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': CLIENT_HEADERS.join(', '),
      },
    });
    const allowRaw = res.headers.get('access-control-allow-headers') ?? '';
    const allowed = allowRaw.toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
    const wildcard = allowed.includes('*');
    const missing = CLIENT_HEADERS.filter((h) => !wildcard && !allowed.includes(h));
    const origin = res.headers.get('access-control-allow-origin') ?? '';

    if (!res.ok) {
      record('preflight', false, `OPTIONS returned ${res.status}; the browser will not send the POST.`);
    } else if (missing.length) {
      record('preflight', false,
        `OPTIONS is ${res.status} but does not allow: ${missing.join(', ')}. ` +
        'The browser drops the POST silently — the log shows only the preflight.');
    } else if (!origin) {
      record('preflight', false, 'No Access-Control-Allow-Origin on the preflight response.');
    } else {
      record('preflight', true, `${res.status}, allows ${wildcard ? '*' : allowed.join(', ')}; origin ${origin}.`);
    }
  } catch (err) {
    record('preflight', false, `OPTIONS did not complete: ${err.message}`);
  }

  const post = async (body) => fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      apikey: anon,
      'Content-Type': 'application/json',
      'x-client-info': 'check-voice',
    },
    body: JSON.stringify(body),
  });

  /** The provider the deployment admits to, from whichever answer carries it. */
  let serverProvider = null;

  // ─── 2. reachable ────────────────────────────────────────
  try {
    const res = await post({});
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch { /* not JSON; the raw text is reported below */ }
    if (body.provider) serverProvider = body.provider;

    if (res.status === 400) {
      record('reachable', true, "400 bad_request — the function is deployed and its provider's secrets are set.");
    } else if (res.status === 503 && body.error === 'voice_not_configured') {
      const gaps = Array.isArray(body.missing) && body.missing.length ? body.missing : null;
      record('reachable', false,
        `503 voice_not_configured — ${body.provider ?? 'the server'} is missing: ` +
        `${gaps ? gaps.join(', ') : "the secrets for its provider"}.` +
        (gaps ? `\n        supabase secrets set ${gaps.map((g) => `${g}=…`).join(' ')}` : ''));
    } else {
      record('reachable', false, `expected 400, got ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    record('reachable', false, `POST did not complete: ${err.message}`);
  }

  // ─── 3. identity ─────────────────────────────────────────
  try {
    const res = await post({
      initData: 'query_id=AAA&user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef',
      roomId: '00000000-0000-0000-0000-000000000000',
    });
    const text = await res.text();
    if (res.status === 401) {
      record('identity', true, '401 unauthorized — unsigned initData is rejected, so the HMAC check is live.');
    } else {
      record('identity', false,
        `expected 401 for unsigned initData, got ${res.status}: ${text.slice(0, 200)}` +
        (res.status === 200 ? '  ← a forged session got a token.' : ''));
    }
  } catch (err) {
    record('identity', false, `POST did not complete: ${err.message}`);
  }

  // ─── 4. provider agreement ───────────────────────────────
  // A build and a deployment pointed at different services produce a valid,
  // useless credential: the adapter would hand a Daily token to LiveKit and
  // wait for a connection that cannot happen. The app reports this as
  // voice.reason_provider_mismatch; this catches it before a player does.
  try {
    const local = process.env.VITE_VOICE_PROVIDER || null;
    if (!serverProvider) {
      // Any provider name the server does not share makes it answer with its
      // own, which is all this needs.
      const res = await post({ initData: 'x', roomId: 'x', provider: '__probe__' });
      const body = await res.json().catch(() => ({}));
      serverProvider = body.provider ?? null;
    }

    if (!serverProvider) {
      record('provider', true,
        'the deployment does not name its provider — an older function, deployed before this was added. ' +
        'Nothing to disagree about; redeploy to get the check.');
    } else if (!local) {
      const agrees = serverProvider === 'livekit';
      record('provider', agrees,
        `server signs for ${serverProvider}; VITE_VOICE_PROVIDER is unset here, which means livekit.` +
        (agrees ? '' : `\n        Set VITE_VOICE_PROVIDER=${serverProvider} for the frontend and rebuild.`));
    } else if (local === serverProvider) {
      record('provider', true, `both halves are on ${serverProvider}.`);
    } else {
      record('provider', false,
        `the frontend is built for ${local}, the server signs for ${serverProvider}.\n` +
        '        The credential would be valid and unusable. Make VOICE_PROVIDER and VITE_VOICE_PROVIDER agree.');
    }
  } catch (err) {
    record('provider', false, `could not determine the server's provider: ${err.message}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length === 0) {
    console.log(
      'The server half is sound. If voice still fails in the app, the cause is\n' +
      'on the device: initData, the microphone permission, or a browser that\n' +
      'refuses to start playback. The lobby names which one — and the in-app\n' +
      'sound check (Profile → "Проверить звук") settles the last two.\n');
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`check-voice crashed: ${err.stack || err.message}`);
  process.exit(1);
});
