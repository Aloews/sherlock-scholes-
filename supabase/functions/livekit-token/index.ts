// ============================================================================
// livekit-token — issues an access token for the in-game voice channel.
//
// THE NAME IS HISTORICAL. This function issues tokens for whichever voice
// service is configured — LiveKit, Daily or Agora — not only LiveKit. It keeps
// the name because deployed frontends call it by that name, and renaming a
// live entry point is the mistake `pick_random_cards` already taught this
// project once (CLAUDE.md). Rename it when there is a deploy window for both
// halves at the same time, not before.
//
// The client asks "may I talk?" and gets back a credential. It never says
// WHICH channel it wants — the channel is derived here from the database,
// because naming it client-side would let a player type the opposing team's
// channel and listen to the explainer. Same reason tg-pay never trusts a
// client-supplied payer id.
//
// WHO IS ASKING is established the way tg-pay establishes it: the Mini App
// initData is validated SERVER-SIDE by the get_user_status RPC, which checks
// the HMAC against the bot token in Vault. A forged telegram_id cannot get a
// token, and a real player cannot get a token for a room they are not in.
//
// CHANNEL RULE
//   team mode — one channel per TEAM. Opponents must not hear the explainer;
//               that is the whole game.
//   1v1  mode — one channel for the ROOM. The two players are explaining to
//               each other, so they have to hear each other.
//
// WHICH SERVICE is the server's choice, not the caller's: VOICE_PROVIDER (a
// secret) selects the issuer, and the answer names the provider it signed for
// so a frontend built against a different one fails loudly instead of joining
// nothing. The client's `provider` field is a HINT ONLY — it is echoed back in
// the mismatch, never acted on. Letting a caller pick the issuer would let it
// pick which set of secrets to exercise.
//
// SECURITY
//   • No API secret ever leaves this function. The browser receives a
//     short-lived credential, never the signing material.
//   • The credential is scoped to exactly one channel, with every admin
//     grant withheld.
//   • It expires in 4 hours — longer than a game, short enough that a leaked
//     token is not a standing invitation.
//
// SECRETS (supabase secrets set …, NOT in the repo) — see README.md:
//   VOICE_PROVIDER                       livekit | daily | agora  (default livekit)
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET  for livekit
//   DAILY_API_KEY, DAILY_DOMAIN          for daily
//   AGORA_APP_ID, AGORA_APP_CERTIFICATE  for agora
// ============================================================================

type ProviderId = "livekit" | "daily" | "agora";

const VOICE_PROVIDER = (Deno.env.get("VOICE_PROVIDER") || "livekit") as ProviderId;

const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY") ?? "";
const DAILY_DOMAIN = Deno.env.get("DAILY_DOMAIN") ?? "";
const AGORA_APP_ID = Deno.env.get("AGORA_APP_ID") ?? "";
const AGORA_APP_CERTIFICATE = Deno.env.get("AGORA_APP_CERTIFICATE") ?? "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TOKEN_TTL_SECONDS = 4 * 60 * 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Supabase REST helpers (service role — bypasses RLS on purpose) ─────────
async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(args),
  });
}

/**
 * A read that says whether it actually happened.
 *
 * The previous version returned [] for BOTH "no such row" and "the request
 * failed", so a blip on the way to PostgREST came back to the player as a
 * confident `not_in_room` — the wrong answer, with a 403 that reads like a
 * verdict on them. A lookup that did not complete is a server fault and must
 * say so.
 */
async function select(path: string): Promise<{ ok: boolean; rows: unknown[] }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    if (!r.ok) {
      console.error(`select failed: ${r.status} for ${path.split("?")[0]}`);
      return { ok: false, rows: [] };
    }
    return { ok: true, rows: (await r.json().catch(() => [])) as unknown[] };
  } catch (err) {
    console.error(`select threw for ${path.split("?")[0]}: ${err}`);
    return { ok: false, rows: [] };
  }
}

// get_user_status raises 28000 on a bad signature -> non-2xx here.
async function validateInitData(initData: string): Promise<number | null> {
  const r = await rpc("get_user_status", { p_init_data: initData });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return typeof data?.telegram_id === "number" ? data.telegram_id : null;
}

// ─── JWT (HS256) via Web Crypto ─────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson(payload);
  const data = `${head}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(LIVEKIT_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

// ─── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Unconfigured deployment: answer honestly instead of signing with "".
  // The client treats this as "voice is off" and hides its button.
  const missing = missingSecrets(VOICE_PROVIDER);
  if (missing.length > 0) {
    console.error(`voice_not_configured: ${VOICE_PROVIDER} needs ${missing.join(", ")}`);
    return json({ error: "voice_not_configured", provider: VOICE_PROVIDER, missing }, 503);
  }

  const payload = await req.json().catch(() => null) as
    | { initData?: string; roomId?: string; provider?: string }
    | null;
  const initData = payload?.initData;
  const roomId = payload?.roomId;
  // `provider` rides along on the refusal so the deployment can be ASKED which
  // service it signs for without holding a valid session. Everything past this
  // point needs initData, and check-voice cannot forge that — so without this
  // the check had no answer to read and reported a correctly-deployed function
  // as an old one. The name is not a secret: it is already in the bundle as
  // VITE_VOICE_PROVIDER.
  if (!initData || !roomId) return json({ error: "bad_request", provider: VOICE_PROVIDER }, 400);

  const telegramId = await validateInitData(initData);
  if (telegramId === null) return json({ error: "unauthorized" }, 401);

  // Membership decides everything: the caller must actually be in this room.
  const membershipRead = await select(
    `room_players?room_id=eq.${encodeURIComponent(roomId)}` +
    `&player_id=eq.${telegramId}&select=team_id&limit=1`,
  );
  if (!membershipRead.ok) return json({ error: "lookup_failed" }, 503);
  const membership = membershipRead.rows as { team_id: string | null }[];
  if (membership.length === 0) {
    // Named, because "not_in_room" was indistinguishable from four other
    // refusals on the player's screen and this pair is what has to be checked
    // against the table when it happens.
    console.warn(`not_in_room: room=${roomId} player=${telegramId}`);
    return json({ error: "not_in_room" }, 403);
  }

  const roomsRead = await select(
    `rooms?id=eq.${encodeURIComponent(roomId)}&select=mode,status&limit=1`,
  );
  if (!roomsRead.ok) return json({ error: "lookup_failed" }, 503);
  const rooms = roomsRead.rows as { mode: string; status: string }[];
  if (rooms.length === 0) return json({ error: "no_such_room" }, 404);
  if (rooms[0].status === "finished") return json({ error: "room_finished" }, 409);

  const teamId = membership[0].team_id;

  // The channel name. In team mode a player with no team yet (still picking in
  // the lobby) gets no token — there is no channel they belong to, and putting
  // them in the room-wide one would leak both teams' talk.
  let channel: string;
  if (rooms[0].mode === "1v1") {
    channel = `ss_${roomId}`;
  } else if (teamId) {
    channel = `ss_${roomId}_${teamId}`;
  } else {
    return json({ error: "no_team_yet" }, 409);
  }

  // The caller's `provider` is a hint used for one thing only: telling it
  // plainly that its build and this deployment disagree. It never selects the
  // issuer — that would let a caller choose which secrets to exercise.
  if (payload?.provider && payload.provider !== VOICE_PROVIDER) {
    console.warn(`provider_mismatch: client=${payload.provider} server=${VOICE_PROVIDER}`);
    return json({ error: "provider_mismatch", provider: VOICE_PROVIDER }, 409);
  }

  try {
    return json(await issue(VOICE_PROVIDER, channel, String(telegramId)));
  } catch (err) {
    // A provider that would not mint is a server fault, not a verdict on the
    // player: `not_in_room` and friends are already ruled out by here.
    console.error(`issue failed for ${VOICE_PROVIDER}: ${err}`);
    return json({ error: "issue_failed", provider: VOICE_PROVIDER }, 503);
  }
});

// ─── Issuers ────────────────────────────────────────────────────────────────

interface Credential {
  provider: ProviderId;
  token: string;
  channel: string;
  url?: string;
  identity?: string;
  appId?: string;
  ttl: number;
}

function missingSecrets(provider: ProviderId): string[] {
  const need: Record<ProviderId, [string, string][]> = {
    livekit: [["LIVEKIT_API_KEY", LIVEKIT_API_KEY], ["LIVEKIT_API_SECRET", LIVEKIT_API_SECRET]],
    daily: [["DAILY_API_KEY", DAILY_API_KEY], ["DAILY_DOMAIN", DAILY_DOMAIN]],
    agora: [["AGORA_APP_ID", AGORA_APP_ID], ["AGORA_APP_CERTIFICATE", AGORA_APP_CERTIFICATE]],
  };
  return (need[provider] ?? []).filter(([, value]) => !value).map(([name]) => name);
}

function issue(provider: ProviderId, channel: string, identity: string): Promise<Credential> {
  switch (provider) {
    case "daily": return issueDaily(channel, identity);
    case "agora": return issueAgora(channel, identity);
    default: return issueLiveKit(channel, identity);
  }
}

/**
 * A channel name every service will accept.
 *
 * The canonical name is `ss_<roomId>` or `ss_<roomId>_<teamId>` — up to 76
 * characters of UUID. LiveKit does not care; Daily caps room names at 41 and
 * Agora at 64, so the team-mode name is too long for both and would fail at
 * the far end with an error about the name, not about the length.
 *
 * Hashing rather than truncating: the same canonical name must always produce
 * the same short one (both players compute nothing — the server does — but a
 * reconnect must land in the same room), and truncated UUIDs collide in ways
 * that are hard to reason about. 80 bits of SHA-256 is not.
 */
async function shortChannel(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ss${hex.slice(0, 20)}`;
}

async function issueLiveKit(channel: string, identity: string): Promise<Credential> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: LIVEKIT_API_KEY,
    sub: identity,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    // LiveKit reads permissions from this grant. Publish and subscribe only:
    // no roomCreate, no roomAdmin, no roomList, no ingress/egress.
    video: {
      room: channel,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      // Audio only. Even if the client asked for a camera track, the server
      // refuses it — video is a separate decision, not a client's to make.
      canPublishSources: ["microphone"],
    },
  });
  // No `url`: LiveKit's address is public and the frontend has it as
  // VITE_LIVEKIT_URL. The other two are per-deployment and travel with the
  // credential instead.
  return { provider: "livekit", token, channel, identity, ttl: TOKEN_TTL_SECONDS };
}

/**
 * Daily's unit is a room that has to EXIST before anyone can be let into it,
 * so this creates it (idempotently) and then mints a meeting token for it.
 *
 * `privacy: private` matters: a public Daily room can be joined by anyone who
 * learns the URL, which would undo the channel rule entirely.
 */
async function issueDaily(canonical: string, identity: string): Promise<Credential> {
  const room = await shortChannel(canonical);
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const auth = { Authorization: `Bearer ${DAILY_API_KEY}`, "Content-Type": "application/json" };

  const created = await fetch("https://api.daily.co/v1/rooms", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: room,
      privacy: "private",
      properties: { exp, start_video_off: true, enable_screenshare: false, enable_chat: false },
    }),
  });
  // 400 is what Daily answers for a room that already exists — the second
  // player through the door, and the normal case rather than a failure.
  if (!created.ok && created.status !== 400) {
    throw new Error(`daily rooms: ${created.status} ${(await created.text()).slice(0, 200)}`);
  }

  const minted = await fetch("https://api.daily.co/v1/meeting-tokens", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      properties: {
        room_name: room,
        user_id: identity,
        exp,
        // Audio only, and no room-admin rights: the same withholding the
        // LiveKit grant does above.
        start_video_off: true,
        enable_screenshare: false,
        is_owner: false,
      },
    }),
  });
  if (!minted.ok) {
    throw new Error(`daily meeting-tokens: ${minted.status} ${(await minted.text()).slice(0, 200)}`);
  }
  const body = await minted.json() as { token?: string };
  if (!body.token) throw new Error("daily meeting-tokens: no token in the answer");

  const host = DAILY_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    provider: "daily",
    token: body.token,
    channel: room,
    url: `https://${host}/${room}`,
    identity,
    ttl: TOKEN_TTL_SECONDS,
  };
}

/**
 * Agora's RTC token, built by Agora's own library.
 *
 * Hand-rolling this one was the alternative — AccessToken2 is a packed binary
 * structure with its own versioning — and getting it subtly wrong produces a
 * token that is rejected at join time with nothing to debug from. The npm
 * specifier is resolved by the Edge Runtime at deploy time.
 *
 * The uid is numeric and DERIVED FROM THE TELEGRAM ID, not chosen by the
 * caller: the token binds it, so the client has to join as exactly this or be
 * refused. It travels back as `identity` for that reason.
 */
async function issueAgora(canonical: string, identity: string): Promise<Credential> {
  const { RtcTokenBuilder, RtcRole } = await import("npm:agora-token@2.0.5");
  const channel = await shortChannel(canonical);
  // Agora uids are unsigned 32-bit. Telegram ids outgrow that, so fold rather
  // than truncate — a collision would put two players on one identity, and
  // Agora resolves that by evicting one of them.
  const uid = foldToUint32(identity);
  const expire = TOKEN_TTL_SECONDS;
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channel,
    uid,
    RtcRole.PUBLISHER,
    expire,
    expire,
  );
  return {
    provider: "agora",
    token,
    channel,
    identity: String(uid),
    appId: AGORA_APP_ID,
    ttl: TOKEN_TTL_SECONDS,
  };
}

/** FNV-1a, so the mapping is stable across deploys and processes. */
function foldToUint32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // 0 means "let the server assign one", which would defeat the binding.
  return hash === 0 ? 1 : hash;
}
