import { clsx } from 'clsx';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';

/**
 * The card's own photo, ghosted beside its name — a hint for the explainer
 * that costs no layout space. In-game only: the Collection cell draws its
 * photo full-bleed and does not come through here.
 *
 * Two things about the geometry are load-bearing, and both have been got
 * wrong once already:
 *
 * • **The box is square.** `photoFitClass` rounds a portrait into a circle,
 *   and `rounded-full` on a box that is not square gives an ellipse — which
 *   crops the face on its long axis. A percentage-sized box (62% × 62% of a
 *   card whose proportions differ per design and per screen) is never square,
 *   and that is exactly what cut the faces.
 *
 * • **It sits on the right, vertically centred.** Not in the bottom-right
 *   corner, where the card's own `overflow-hidden` clipped it into a sliver;
 *   not dead centre, where it sits behind the name and has to be faded so far
 *   down to keep the name readable that it stops being recognisable.
 */
export function CardWatermark({ src, category, className }: {
  src: string;
  category: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'absolute inset-y-0 right-0 pr-3 flex items-center',
        'pointer-events-none select-none',
        className,
      )}
      aria-hidden
    >
      {/* A fixed square, not a percentage of the card. `aspect-square` with a
          percentage height was tried and does not survive here — the image is
          a replaced element in a flex line, and it came out a tall rectangle,
          which is the exact failure this is fixing. 128px is the size the
          quick-game card used before the watermark was centred. */}
      <PlayerPhoto
        src={src}
        category={category}
        shape="free"
        className="w-32 h-32 opacity-[0.13]"
      />
    </div>
  );
}
