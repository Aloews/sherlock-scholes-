import { provenanceAttrs } from '@/shared/lib/provenance';

/**
 * Эмблема клуба с местом под неё.
 *
 * ⚠️ Эмблемы приходят от ESPN, TheSportsDB и Transfermarkt — то есть это
 * тоже собранный чужой материал, и метка источника стоит здесь по той же
 * причине, по которой размер задан здесь: вторая копия разошлась бы.
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
      {...provenanceAttrs({ url: src })}
    />
  );
}
