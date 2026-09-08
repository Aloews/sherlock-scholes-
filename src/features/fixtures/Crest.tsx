/**
 * Эмблема клуба с местом под неё.
 *
 * ⚠️ РАЗМЕР ЗАДАН И ПУСТОЙ СЛУЧАЙ ТОЖЕ ЗАНИМАЕТ МЕСТО. Без этого строка
 * прыгает, пока картинки грузятся по одной, а матч без эмблемы съезжает
 * относительно соседних.
 *
 * Живёт отдельным файлом, потому что её рисуют и главная (TopFixtures), и
 * список матчей (FixtureCard). Вторая копия разошлась бы с первой на первой
 * же правке размера.
 */
export function Crest({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <span className="w-6 h-6 shrink-0" />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-6 h-6 shrink-0 object-contain"
    />
  );
}
