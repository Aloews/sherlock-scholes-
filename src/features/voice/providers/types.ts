// What the game needs from a voice service — and nothing more.
//
// The app does one thing with voice: put two people in a channel and let them
// hear each other. That is a small enough job that it does not have to be
// spelled in any one vendor's vocabulary, and spelling it in LiveKit's is how
// a swap turns into a rewrite. So the vendor lives behind this interface, one
// adapter per service, and `useVoiceChat` never imports an SDK.
//
// The interface is deliberately the SHAPE OF THE PROBLEM, not the intersection
// of three SDKs: a session you can mute, a link you can measure, playback you
// can start, and remote audio that ends up somewhere the browser will play it.
// An adapter that cannot do one of these says so by throwing at connect time,
// not by pretending.
//
// VIDEO IS DECLARED, NOT DISCOVERED. `VoiceTransport.video` says whether an
// adapter carries pictures at all, and the UI reads it before it offers a
// camera button. The alternative — an optional `setCameraEnabled?.()` that the
// caller invokes with `?.` — is precisely the pretending this file forbids: a
// tap that resolves successfully and turns nothing on.

import type { LinkStats } from '../voiceQuality';

/** Services the app knows how to talk to. */
export type VoiceProviderId = 'livekit' | 'daily' | 'agora';

/**
 * Everything that can arrive and be understood.
 *
 * This is the PARSING set, and it still contains Daily deliberately. Rooms
 * created before Daily was withdrawn carry `voice_provider = 'daily'` in the
 * database, and `rooms.voice_provider` still accepts it; dropping the value
 * from the type would turn those rows into unparseable state rather than into
 * a room that quietly moves to a working service. `providerOrder` already
 * handles a preferred service that is not on offer — it returns the ladder
 * without it.
 */
export const VOICE_PROVIDER_IDS: readonly VoiceProviderId[] = ['livekit', 'daily', 'agora'];

/**
 * What this build will actually try, and show.
 *
 * DAILY IS WITHDRAWN. The account behind it has no payment method, so every
 * connection attempt fails with `account-missing-payment-method` — a rung of
 * the failover ladder that cannot hold weight, and a row in the service check
 * that reports a fault the player can do nothing about. Offering a service
 * that is known not to work costs a real attempt on every failover and reads
 * as the app being broken.
 *
 * Kept as a separate list rather than deleted from the one above, because
 * withdrawing a service and forgetting how to read it are different acts.
 * Restoring it is one entry here, once the account is paid.
 */
export const OFFERED_VOICE_PROVIDER_IDS: readonly VoiceProviderId[] = ['livekit', 'agora'];

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return typeof value === 'string' && (VOICE_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * A live session. Everything the UI can do to a connected channel.
 *
 * Every method must tolerate being called after the link has already dropped —
 * teardown races are the normal case, not the exception, and an adapter that
 * throws on a late `disconnect()` turns a lost connection into a crash.
 */
/**
 * One remote picture, ready to be put on screen.
 *
 * The ELEMENT travels, not a stream or a track id. Every SDK here builds its
 * own `<video>` — it knows the codec, the mirroring, the muted/playsinline
 * flags a mobile browser insists on — and handing React a MediaStream to
 * re-attach means writing that knowledge a second time, in the component,
 * per vendor. So the adapter owns the element and the component owns where it
 * goes: append it, never clone it, never set its `src`.
 */
export interface VideoFeed {
  /** Whose picture. The same identity string `onSpeakers` reports. */
  readonly identity: string;
  /** Owned by the adapter, already playing. Move it into the layout as-is. */
  readonly element: HTMLVideoElement;
}

export interface VoiceSession {
  /** Open or close the local microphone. */
  setMicrophoneEnabled(on: boolean): Promise<void>;

  /**
   * Open or close the local camera.
   *
   * Returns the local self-view when it comes on, null when it goes off. The
   * self-view is returned rather than pushed through `onVideoChanged` because
   * it is not a remote feed: it is never subscribed, it is mirrored, and a
   * layout that treats it as one more tile is a layout that shows you to
   * yourself in the middle of the grid.
   *
   * Adapters that declare `video: false` THROW here. Silently resolving would
   * leave the player looking at a lit camera button and a dead camera.
   */
  setCameraEnabled(on: boolean): Promise<VideoFeed | null>;

  /**
   * Ask the browser to start playing the remote audio.
   *
   * Must be safe to call from a click handler and must REPORT rather than
   * assume: a blocked autoplay is the difference between "connected" and
   * "connected and audible", and it is invisible unless it is asked about.
   */
  startAudio(): Promise<void>;

  /** False when the browser is refusing to play what has already arrived. */
  canPlaybackAudio(): boolean;

  /** RTT and loss for the quality ladder, or null when the service cannot say. */
  linkStats(): Promise<LinkStats | null>;

  /** Leave. Must remove every element the adapter put in the sink. */
  disconnect(): Promise<void>;
}

/**
 * What the server hands back for one channel, on one service.
 *
 * Provider-shaped on purpose. The three services disagree about what a client
 * needs to join — LiveKit wants an address and a signed token, Daily wants a
 * room URL the server created, Agora wants an app id and the exact uid the
 * token was minted for — and flattening that into a lowest common denominator
 * would mean the client reconstructing it, which is the client deciding. The
 * server decides; this carries the decision.
 */
export interface VoiceCredentials {
  provider: VoiceProviderId;
  /** Opaque here. Only the adapter knows its shape. */
  token: string;
  /** The channel the server chose. Never named by the client — that is the rule that keeps teams apart. */
  channel: string;
  /** Service address. LiveKit: `wss://…`. Daily: the room URL. Agora: unused. */
  url?: string;
  /** Who the token says we are. Agora must join as exactly this uid or the token is void. */
  identity?: string;
  /** Agora's app id. Public, but it travels with the token so one place decides which project. */
  appId?: string;
}

export interface VoiceConnectOptions {
  credentials: VoiceCredentials;
  /**
   * Where remote <audio> elements go.
   *
   * Owned by the caller and already in the document. The adapter appends and
   * removes; it must never assume the node is empty, and must leave it empty
   * when it disconnects.
   */
  sink: HTMLElement;
  /** Identities currently speaking. Called with the full set, not a delta. */
  onSpeakers(identities: string[]): void;
  /**
   * Remote pictures currently arriving. Full set, not a delta.
   *
   * Never called by an adapter with `video: false` — such an adapter has no
   * pictures to report, and an empty array on connect would be indistinguishable
   * from a camera nobody has switched on yet.
   */
  onVideoChanged(feeds: VideoFeed[]): void;
  /** The browser started or stopped allowing playback. */
  onPlaybackChanged(playing: boolean): void;
  /** The link dropped on its own. Not called for a local disconnect(). */
  onDisconnected(): void;
}

export interface VoiceTransport {
  readonly id: VoiceProviderId;
  /**
   * Whether this adapter carries pictures.
   *
   * Required, not optional: an adapter that gains video must be a line changed
   * here, and an adapter that never will must say so out loud. Read by the UI
   * to decide whether a camera button exists at all — see VoiceControl.
   */
  readonly video: boolean;
  connect(options: VoiceConnectOptions): Promise<VoiceSession>;
}
