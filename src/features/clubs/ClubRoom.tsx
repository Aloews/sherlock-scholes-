import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSend, IconTrash, IconX } from '@tabler/icons-react';
import { getRawInitData, hapticImpact, hapticError, hapticSuccess } from '@/shared/lib/telegram';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { timeFormat, shortDateFormat } from '@/shared/lib/dateFormat';
import {
  fetchClubRoom, postClubMessage, deleteClubMessage,
  type ClubPost, type PostError,
} from './clubRoomApi';

/** Новость, которую принесли обсуждать. */
export interface QuotedNews { url: string; title: string }

/**
 * Комната болельщиков клуба — та треть, которой на экране не было.
 *
 * Владелец: «добавь комнату болельщиков для команд, где можно было изучить
 * состав команды, новости и обсудить их». Состав и новости на `/club/:key`
 * уже были; разговора не было нигде.
 *
 * ⚠️ ПУСТАЯ КОМНАТА ПОКАЗЫВАЕТСЯ, И ЭТО НАМЕРЕННОЕ ИСКЛЮЧЕНИЕ ИЗ ПРАВИЛА
 * «нечего показать — раздела нет». Правило заведено про ленты: пустой раздел
 * новостей читается как поломка конвейера. Здесь наоборот — пусто ровно до
 * тех пор, пока кто-то не напишет первым, и спрятать комнату значит сделать
 * так, чтобы первым не написал никто.
 *
 * ⚠️ ВСЕ ХУКИ ДО ЕДИНСТВЕННОГО ДОСРОЧНОГО ВЫХОДА. Не стиль: хук ниже выхода
 * меняет их число между отрисовками, React снимает всё поддерево с
 * «Rendered more hooks than during the previous render», и снаружи это
 * выглядит как зависший экран. Ровно это уже случилось в ScopeFilter, и
 * `src/shared/lib/hookOrder.test.ts` заведён по тому случаю.
 */
export function ClubRoom({
  clubKey, quoted, onClearQuote,
}: {
  clubKey: string;
  /** Новость из ленты выше, если нажали «обсудить». */
  quoted?: QuotedNews | null;
  onClearQuote?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [posts, setPosts] = useState<LoadState<ClubPost[]>>(LOADING);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<PostError | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const initData = getRawInitData();

  const load = useCallback(() => {
    void fetchClubRoom(initData, clubKey).then(setPosts);
  }, [initData, clubKey]);

  useEffect(() => { setPosts(LOADING); load(); }, [load]);

  // Принесли новость — сразу ставим курсор в поле: иначе человек нажал
  // «обсудить», экран не шевельнулся, и непонятно, случилось ли что-нибудь.
  useEffect(() => { if (quoted) box.current?.focus(); }, [quoted]);

  const send = () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setProblem(null);
    hapticImpact('light');
    void postClubMessage(initData, clubKey, body, quoted)
      .then((err) => {
        if (err) { setProblem(err); hapticError(); return; }
        hapticSuccess();
        setDraft('');
        onClearQuote?.();
        load();
      })
      .finally(() => setSending(false));
  };

  const remove = (id: number) => {
    hapticImpact('light');
    void deleteClubMessage(initData, id).then((done) => { if (done) load(); });
  };

  // ⚠️ ЕДИНСТВЕННЫЙ ДОСРОЧНЫЙ ВЫХОД, И ОН НИЖЕ ВСЕХ ХУКОВ. Без подписи
  // Telegram писать нельзя и читать нечего: сервер откажет обеим функциям.
  if (!initData) return null;

  const list = posts.status === 'ok' ? [...posts.data].reverse() : [];
  const clock = timeFormat(i18n.language);
  const day = shortDateFormat(i18n.language);

  return (
    <section className="space-y-2">
      <h2 className="ds-display text-white text-base font-bold">{t('club.room')}</h2>

      {list.length === 0 && posts.status === 'ok' && (
        <p className="text-brand-muted text-[12px]">{t('club.room_empty')}</p>
      )}

      <div className="space-y-1.5">
        {list.map((p) => {
          let when = '';
          try {
            const d = new Date(p.created_at);
            // Intl бросает RangeError на непрочитанной дате и роняет ВЕСЬ
            // экран в белый лист — так уже было в FantasyScreen.
            if (!Number.isNaN(d.getTime())) {
              const today = new Date().toDateString() === d.toDateString();
              when = today ? clock.format(d) : day.format(d);
            }
          } catch { when = ''; }
          return (
            <div
              key={p.id}
              className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt=""
                    className="w-5 h-5 rounded-full object-cover shrink-0"
                    loading="lazy"
                  />
                ) : null}
                <span className="text-[11px] text-white/80 font-semibold truncate">
                  {p.author || t('club.room_anon')}
                </span>
                <span className="text-[10px] text-brand-muted/70 shrink-0">{when}</span>
                {p.mine && (
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label={t('club.room_delete')}
                    className="ml-auto text-brand-muted/70 active:opacity-60 shrink-0"
                  >
                    <IconTrash size={13} stroke={1.75} />
                  </button>
                )}
              </div>

              {p.news_title && (
                <p className="text-[10.5px] text-brand-accent/90 mt-1 line-clamp-2">
                  {p.news_title}
                </p>
              )}
              {/* `whitespace-pre-wrap` — перевод строки автора остаётся
                  переводом строки, а не склеивается в один абзац. */}
              <p className="text-[12.5px] text-white/90 mt-1 whitespace-pre-wrap break-words">
                {p.body}
              </p>
            </div>
          );
        })}
      </div>

      {quoted && (
        <div className="flex items-start gap-2 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
          <span className="flex-1 min-w-0 text-[11px] text-brand-accent/90 line-clamp-2">
            {quoted.title}
          </span>
          <button
            type="button"
            onClick={() => { hapticImpact('light'); onClearQuote?.(); }}
            aria-label={t('club.room_clear_quote')}
            className="text-brand-muted shrink-0"
          >
            <IconX size={14} stroke={1.75} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          className="flex-1 bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-white
                     text-sm resize-none focus:outline-none focus:border-brand-accent"
          rows={2}
          // Тот же предел, что у сервера. Обрезать здесь — вежливость, но
          // НЕ защита: проверка стоит в post_club_message, потому что вызов
          // можно послать и мимо этого поля.
          maxLength={500}
          value={draft}
          placeholder={t('club.room_placeholder')}
          onChange={(e) => { setDraft(e.target.value); setProblem(null); }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || draft.trim().length === 0}
          aria-label={t('club.room_send')}
          className="shrink-0 rounded-lg bg-brand-accent text-black px-3 py-2.5
                     disabled:opacity-40 active:opacity-70 transition-opacity"
        >
          <IconSend size={16} stroke={2} />
        </button>
      </div>

      {problem && (
        <p className="text-brand-danger text-[11.5px]">
          {t(`club.room_${problem}`)}
        </p>
      )}
    </section>
  );
}
