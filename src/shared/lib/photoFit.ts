import type { CardCategory } from '@/shared/types/database';

// How a card's photo should sit in its frame depends on what the photo IS.
//
// A person's card carries a headshot: the face is in the upper third, the
// frame is tight, and letterboxing one looks like a mistake. Filling the box
// and cropping from the top keeps the face big and never cuts it off.
//
// Every other category carries something that a crop destroys. Club crests and
// trophies are drawn with their own padding, so `object-cover` eats their edges
// — the shield loses its border, the cup loses its handles. Stadium, derby and
// era photos are wider than any box we put them in, so a fill crops the sides
// off the very thing the card is about.
//
// So: portraits fill, everything else is shown whole.

const PORTRAIT_CATEGORIES: readonly CardCategory[] = [
  'player', 'woman', 'coach', 'referee', 'commentator',
];

// Takes a plain string, not a CardCategory: the admin screen edits a card as
// free-form input, where the category is whatever is in the select. An
// unrecognised value is not a portrait, so it is shown whole — the safe side,
// since that is the branch that never destroys the image.
export function isPortraitCategory(category: string): boolean {
  return (PORTRAIT_CATEGORIES as readonly string[]).includes(category);
}

// For a photo that fills a free-form box — the ghosted card watermark.
// Portraits keep the circular mask they were designed with; a crest is shown
// whole and square, because the mask would clip the corners it needs.
export function photoFitClass(category: string): string {
  return isPortraitCategory(category)
    ? 'object-cover object-top rounded-full'
    : 'object-contain';
}

// For a photo inside a circular frame — the summary thumbnails and the admin
// rows, where the rarity ring is a circle and has to stay one. Non-portraits
// are inset so a square crest fits the circle's inscribed square instead of
// losing its corners to the mask.
export function photoFitCircleClass(category: string): string {
  return isPortraitCategory(category)
    ? 'object-cover object-top'
    : 'object-contain p-1';
}
