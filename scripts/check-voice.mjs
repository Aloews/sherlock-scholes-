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
 *                       503 means the LiveKit secrets are missing; anything
 *                       else means the request is not arriving at all.
 *   3. identity         POST with unsigned initData must be 401 unauthorized —
 *                       proof the HMAC check is live and a forged session
 *                       cannot get a token.
 *
 * What it deliberately does NOT check: whether a real Telegram client supplies
 * initData. That cannot be faked from outside by design, which is the whole
 * reason the remaining unknown needs a device. The app now names that case on
 * screen ("Откройте игру внутри Telegram" — voice.reason_no_init_data).
 *
 * Read-only: it never obtains a usable token and changes nothing.
 *
 *   node scripts/check-voice.mjs
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_ prefixed) in the env.
 * Exit code 0 when every check passes, 1 otherwise.
 */

const url =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY not set (VITE_ prefixes also accepted)');
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, '')}/functions/v1/livekit-token`;

// Exactly what supabase-js puts on the wire for functions.invoke(). Verified
// against @supabase/supabase-js 2.106.2 by capturing the request; if the
// client starts sending more, this list is what has to grow with it.
const CLIENT_HEADERS = ['authorization', 'apikey', 'content-type', 'x-client-info'];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
}

async function main() {
  console.log(`\ncheck-voice — ${endpoint}\n`);

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

  // ─── 2. reachable ────────────────────────────────────────
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

  try {
    const res = await post({});
    const text = await res.text();
    if (res.status === 400) {
      record('reachable', true, '400 bad_request — the function is deployed and its secrets are set.');
    } else if (res.status === 503) {
      record('reachable', false, '503 voice_not_configured — LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set on the function.');
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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length === 0) {
    console.log(
      'The server half is sound. If voice still fails in the app, the cause is\n' +
      'on the device: initData or the microphone permission. The lobby now names\n' +
      'which one — read the line under "Голосовой чат".\n');
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`check-voice crashed: ${err.stack || err.message}`);
  process.exit(1);
});
