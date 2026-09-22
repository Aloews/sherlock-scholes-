import { useEffect, useState } from 'react';
import { fetchRightsGaps, type RightsGap } from './rightsApi';

/**
 * ЧТО У НАС НЕ В ПОРЯДКЕ С ПРАВАМИ — одним списком, владельцу.
 *
 * ⚠️ ТРИ БЕДЫ ЗДЕСЬ РАЗНЫЕ, И МЕРЫ У НИХ РАЗНЫЕ. Сваливать их в одно
 * «проблемы с правами» бессмысленно:
 *
 *   источник не опознан — появился сборщик, не внесённый в `content_origin`.
 *                         Чинится строкой в миграции, и чинить надо: про эти
 *                         записи мы не можем сказать вообще ничего.
 *   нет подписи         — лицензия требует назвать автора у каждого файла, а
 *                         мы не спросили. Чинится прогоном
 *                         `docs/cards_photo_credits.py`.
 *   нет лицензии        — показываем, не имея разрешения. Скриптом не
 *                         чинится вовсе: решает человек — договориться,
 *                         заменить источник или убрать.
 *
 * Панель ничего не исправляет и не предлагает кнопку «исправить». Кнопка,
 * которая «решает вопрос с правами», была бы враньём.
 */
export function RightsPanel({ password }: { password: string }) {
  const [rows, setRows] = useState<RightsGap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchRightsGaps(password).then((s) => {
      if (!alive) return;
      if (s.status === 'ok') setRows(s.data);
      else if (s.status === 'error') setError(s.code);
    });
    return () => { alive = false; };
  }, [password]);

  const groups = ['источник не опознан', 'нет подписи', 'нет лицензии'];

  return (
    <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="ds-display text-sm font-bold text-white">Права на контент</p>
        <p className="text-[11px] text-brand-muted mt-0.5">
          Где условие источника не выполнено. Полный список источников — на экране
          «Источники и права» в профиле.
        </p>
      </div>

      {error && <p className="text-xs text-brand-muted">Не удалось прочитать ревизию ({error}).</p>}
      {!error && rows === null && (
        <div className="h-16 rounded-xl bg-brand-border/30 animate-pulse" aria-hidden="true" />
      )}
      {rows?.length === 0 && (
        <p className="text-xs text-brand-accent">
          Ни одной невыполненной обязанности: источники опознаны, подписи стоят.
        </p>
      )}

      {rows && rows.length > 0 && groups.map((g) => {
        const part = rows.filter((r) => r.problem === g);
        if (part.length === 0) return null;
        const total = part.reduce((a, r) => a + Number(r.records || 0), 0);
        return (
          <div key={g}>
            <p className="text-[11px] font-semibold text-white">
              {g} — {total.toLocaleString('ru-RU')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {part.map((r) => (
                <li key={`${r.area}:${r.source_key}`} className="text-[11px] text-brand-muted">
                  {r.area} · {r.source_key} · {Number(r.records).toLocaleString('ru-RU')}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
