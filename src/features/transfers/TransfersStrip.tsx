import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconArrowRight, IconArrowsExchange, IconChevronDown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { fetchRecentTransfers, type Transfer } from './transfersApi';
import { shortDateFormat } from '@/shared/lib/dateFormat';

/**
 * Переходы за последние недели — отдельным блоком НАД лентой заголовков.
 *
 * ПОЧЕМУ НЕ ВНУТРИ ЛЕНТЫ. `news_items` — это RSS: заголовок, издание, ссылка
 * наружу. У перехода нет ни ссылки, ни издания, зато есть игрок, два клуба и
 * дата — то есть другая карточка и другое действие по нажатию (открыть досье,
 * а не уйти из приложения). Подмешать его в ленту значило бы либо выдумать
 * ссылку, либо завести в ленте строку, которая ведёт себя иначе всех прочих.
 *
 * ⚠️ СПИСОК СВЁРНУТ, ПОКА ЕГО НЕ ОТКРЫЛИ. Двенадцать переходов — это
 * двенадцать карточек с гербами НАД лентой новостей: раздел, ради которого
 * экран открывали, оказывался ниже сгиба. Число рядом с заголовком стоит
 * ИМЕННО поэтому — кнопка обязана говорить, что внутри, до того как её нажмут,
 * иначе это не свёрнутый список, а спрятанный.
 *
 * ⚠️ ПУСТО — ЭТО НОРМА, И БЛОК ТОГДА ИСЧЕЗАЕТ ЦЕЛИКОМ. Настоящие даты
 * переходов есть только у игроков, собранных из Викиданных; вне трансферного
 * окна и до сбора состава показывать нечего. Заголовок «Переходы» над пустотой
 * читался бы как поломка, поэтому его в этом случае нет вовсе. Отказ RPC —
 * наоборот, показывается с кодом: «не загрузилось» и «ничего нет» это разные
 * вещи, и путать их здесь уже приходилось.
 */
export function TransfersStrip({ days = 45, limit = 12 }: { days?: number; limit?: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState<Transfer[]>>(LOADING);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchRecentTransfers(i18n.language, days, limit).then((r) => {
      if (alive) setState(r);
    });
    return () => { alive = false; };
  }, [i18n.language, days, limit]);

  const dateFmt = useMemo(() => shortDateFormat(i18n.language), [i18n.language]);

  if (state.status === 'loading') return null;

  if (state.status === 'error') {
    return (
      <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 text-center space-y-1 mb-3">
        <p className="text-brand-muted text-sm">{t('transfers.failed')}</p>
        <p className="text-brand-muted/50 text-[10px] font-mono">{state.code}</p>
      </div>
    );
  }

  if (state.data.length === 0) return null;

  return (
    <section className={open ? 'mb-4' : 'mb-3'}>
      {/* Заголовок стал кнопкой. Стрелка поворачивается, `aria-expanded`
          говорит то же самое тем, кто её не видит. */}
      <button
        type="button"
        onClick={() => { hapticImpact('light'); setOpen((v) => !v); }}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-1 text-left
                   active:opacity-70 transition-opacity"
      >
        <IconArrowsExchange size={16} stroke={2} className="text-brand-accent shrink-0" />
        <span className="ds-display text-white text-sm font-black flex-1">
          {t('transfers.title')}
        </span>
        <span className="text-brand-muted text-xs tabular-nums">{state.data.length}</span>
        <IconChevronDown
          size={14}
          stroke={2}
          className={`text-brand-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ⚠️ `hidden`, А НЕ РАЗМОНТИРОВАНИЕ. Список уже загружен — снимать его
          с DOM значило бы терять прокрутку и проигрывать анимацию заново на
          каждое второе нажатие. */}
      <div className="space-y-2 mt-2" hidden={!open}>
        {state.data.map((tr) => (
          <button
            key={tr.card_id + tr.to_key}
            type="button"
            onClick={() => {
              hapticImpact('light');
              navigate(`/collection?card=${tr.card_id}`);
            }}
            className="w-full ds-panel bg-brand-surface border border-brand-border rounded-2xl
                       p-3 text-left hover:border-brand-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {tr.to_crest && (
                <img
                  src={tr.to_crest}
                  alt=""
                  loading="lazy"
                  className="w-8 h-8 shrink-0 object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{tr.name}</p>
                {/* «Перешёл ИЗ» и «пришёл В» — разные утверждения. Прежний клуб
                    известен не всегда, и дорисовывать его нечем: строка без
                    стрелки честнее выдуманного источника перехода. */}
                <p className="text-brand-muted text-xs mt-0.5 flex items-center gap-1 min-w-0">
                  {tr.from_club && (
                    <>
                      <span className="truncate">{tr.from_club}</span>
                      <IconArrowRight size={12} stroke={2} className="shrink-0" />
                    </>
                  )}
                  <span className="truncate text-white/70">{tr.to_club ?? tr.to_key}</span>
                </p>
              </div>

              <div className="shrink-0 text-right">
                {tr.level != null && (
                  <span className="text-brand-accent text-sm font-black tabular-nums">
                    {tr.level}
                  </span>
                )}
                <p className="text-brand-muted/60 text-[10px] tabular-nums">
                  {dateFmt.format(new Date(tr.moved_at))}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
