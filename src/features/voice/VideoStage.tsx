import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useVoice } from './VoiceProvider';
import { useGameStore } from '@/shared/store/gameStore';
import type { VideoFeed } from './providers/types';
import type { VoiceLevel } from './voiceQuality';

/**
 * The pictures, when there are any.
 *
 * RENDERS NOTHING WHEN NOBODY HAS A CAMERA ON, which is the common case and
 * has to stay free: no strip, no empty frames, no reserved height that pushes
 * the game down the screen for a feature most rounds never use.
 *
 * THE <video> ELEMENTS ARE NOT REACT'S. Each one is built by the adapter — it
 * knows the codec, the autoplay flags a mobile browser insists on, and when
 * the track behind it dies — and this component only decides where it sits.
 * Rendering `<video>` in JSX and attaching a MediaStream to it would move all
 * of that knowledge here, per vendor, and would let a re-render replace the
 * element under a live track. So: append, never clone, never set `src`.
 *
 * Small on purpose. This is a game about explaining a card; the picture is a
 * face beside it, not the thing being looked at. Tiles are 96px and the strip
 * scrolls sideways rather than growing.
 */
export function VideoStage({ className }: { className?: string }) {
  const { feeds, selfFeed, cameraOn, level } = useVoice();

  if (feeds.length === 0 && selfFeed === null) return null;

  return (
    <div className={clsx('flex gap-2 overflow-x-auto px-4 py-2', className)}>
      {feeds.map((feed) => (
        <Tile key={`${feed.identity}-remote`} feed={feed} />
      ))}
      {/* Ours last, and mirrored: a self-view that is not mirrored looks like
          somebody else, because it is the only picture of yourself you have
          never seen in a mirror. */}
      {selfFeed && <Tile feed={selfFeed} mirrored self />}
      {/* Asked for, not arriving: the ladder is holding the camera closed. Said
          out loud, because a camera button that is lit over an empty strip
          otherwise reads as the feature being broken. */}
      {cameraOn && selfFeed === null && <WeakLinkNote level={level} />}
    </div>
  );
}

function WeakLinkNote({ level }: { level: VoiceLevel }) {
  const { t } = useTranslation();
  return (
    <p className="shrink-0 self-center text-brand-muted text-[10.5px] max-w-[10rem]">
      {t('voice.video_held', { level: t(`voice.level_${level}`) })}
    </p>
  );
}

interface TileProps {
  feed: VideoFeed;
  mirrored?: boolean;
  self?: boolean;
}

function Tile({ feed, mirrored = false, self = false }: TileProps) {
  const { t } = useTranslation();
  const { speaking } = useVoice();
  const hostRef = useRef<HTMLDivElement>(null);

  // The name behind the identity. LiveKit identities are the telegram id as a
  // string — the same number `room_players.player_id` holds — so this is a
  // lookup, not a guess. A player the store has not loaded yet gets no caption
  // rather than a placeholder that would later change into a name.
  const name = useGameStore((s) => s.roomPlayers.find(
    (rp) => String(rp.player_id) === feed.identity,
  )?.player?.first_name ?? null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const element = feed.element;
    // Written as inline style rather than a class, because the element does not
    // come from JSX: Tailwind would have to be told about a node it cannot see
    // in the source, and a child-selector variant would then be the only thing
    // holding the layout of a live video.
    element.style.cssText =
      `width:100%;height:100%;object-fit:cover;display:block;${
        mirrored ? 'transform:scaleX(-1);' : ''}`;
    host.appendChild(element);
    // Taking it out again on unmount, not destroying it: the track is still
    // live and the adapter may hand the same element back on the next render.
    return () => { element.remove(); };
  }, [feed, mirrored]);

  const talking = speaking.includes(feed.identity);

  return (
    <div className="shrink-0 relative">
      <div
        ref={hostRef}
        // The speaking ring is the same accent treatment the avatars use, so
        // "who is talking" reads the same whether or not there is a picture.
        className={clsx(
          'w-24 h-24 rounded-xl overflow-hidden bg-brand-bg border transition-colors',
          talking ? 'border-brand-accent' : 'border-brand-border',
        )}
      />
      <span className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[9.5px] text-white truncate bg-black/45 rounded-b-xl">
        {self ? t('voice.you') : name ?? ''}
      </span>
    </div>
  );
}
