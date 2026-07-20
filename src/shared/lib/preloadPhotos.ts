// Warm the browser image cache for upcoming card photos so the watermark is
// already decoded when its card slides in — without this the <img> starts
// downloading only on mount and pops in a beat after the card.
const preloaded = new Set<string>();

export function preloadPhotos(urls: Array<string | null | undefined>): void {
  for (const url of urls) {
    if (!url || preloaded.has(url)) continue;
    preloaded.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}
