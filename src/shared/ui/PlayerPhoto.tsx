import { clsx } from 'clsx';
import { photoFitClass, photoFitCircleClass } from '@/shared/lib/photoFit';

/**
 * The one place that decides how a card's photo sits in its frame.
 *
 * Every screen that shows a card photo reads the same `cards.photo_url` —
 * there has never been a second database for it (see the shared/lib/photoFit.ts
 * header). What kept drifting was the markup: each screen wrote its own
 * `<img className="...">` and had to remember to reach for `photoFitClass`/
 * `photoFitCircleClass` itself. `RatingsScreen` and `FamousScreen` both
 * shipped with a bare `object-cover` instead — same bug, two places, because
 * there was no single component whose absence would be conspicuous.
 *
 * This does not own sizing (callers pass a size via `className`, same as
 * before), the "no photo" fallback (callers still guard with `photo_url &&`,
 * since empty states differ per screen), or error handling beyond exposing
 * `onError` — those stay screen-specific on purpose. It only owns the one
 * thing that kept breaking: which crop rule applies.
 */
interface PlayerPhotoProps {
  src: string;
  /** Defaults to 'player': every current caller renders a footballer. */
  category?: string;
  /**
   * 'framed' (default) — the photo sits inside a frame the CALLER already
   * shapes (a circular avatar via its own `rounded-full`, or, as in
   * FamousScreen's square tile, no rounding at all). No mask is added here;
   * only the crop rule (`photoFitCircleClass`).
   *
   * 'free' — the photo fills a free-form box and has to shape itself: a
   * portrait gets its own circular mask baked in (`photoFitClass`), because
   * nothing else will. Ghosted watermarks and full-bleed collection cells.
   */
  shape?: 'framed' | 'free';
  alt?: string;
  loading?: 'lazy' | 'eager';
  className?: string;
  onError?: () => void;
  /** For a decorative photo sitting behind other text, same as the collection cell. */
  'aria-hidden'?: boolean;
}

export function PlayerPhoto({
  src,
  category = 'player',
  shape = 'framed',
  alt = '',
  loading = 'lazy',
  className,
  onError,
  'aria-hidden': ariaHidden,
}: PlayerPhotoProps) {
  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={onError}
      aria-hidden={ariaHidden}
      className={clsx(
        shape === 'free' ? photoFitClass(category) : photoFitCircleClass(category),
        className,
      )}
    />
  );
}
