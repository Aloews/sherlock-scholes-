// ============================================================================
// livekit-token — issues a LiveKit access token for the in-game voice channel.
//
// The client asks "may I talk?" and gets back a token. It never says WHICH
// channel it wants — the channel is derived here from the database, because
// naming it client-side would let a player type the opposing team's channel
// and listen to the explainer. Same reason tg-pay never trusts a client-
// supplied payer id.
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
// SECURITY
//   • LIVEKIT_API_SECRET never leaves this function. The browser receives a
//     short-lived signed token, never the secret.
//   • The token is scoped to exactly one room, with roomCreate/roomList and
//     every admin grant withheld.
//   • It expires in 4 hours — longer than a game, short enough that a leaked
//     token is not a standing invitation.
//   • Signed with Web Crypto (HS256). No dependency, nothing to keep patched.
//
// SECRETS (supabase secrets set …, NOT in the repo):
//   LIVEKIT_API_KEY, LIVEKIT_API_SECRET
// ============================================================================

const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
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
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return json({ error: "voice_not_configured" }, 503);
  }

  const payload = await req.json().catch(() => null) as
    | { initData?: string; roomId?: string }
    | null;
  const initData = payload?.initData;
  const roomId = payload?.roomId;
  if (!initData || !roomId) return json({ error: "bad_request" }, 400);

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

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: LIVEKIT_API_KEY,
    sub: String(telegramId),
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

  return json({ token, channel, ttl: TOKEN_TTL_SECONDS });
});
