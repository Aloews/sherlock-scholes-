import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoom } from '@/features/room/useRoom';
import { useAuthStore } from '@/shared/store/authStore';
import { useGameStore } from '@/shared/store/gameStore';
import { useTranslation } from 'react-i18next';
import { useMainButton } from '@/shared/lib/useMainButton';
import { useKeyboardOpen } from '@/shared/lib/useKeyboardOpen';
import { getInviteCode } from '@/shared/lib/telegram';
import { normalizeCode } from './invite';

interface Options {
  /** Показана ли форма кода. От этого зависят MainButton и автовход. */
  formOpen: boolean;
  /** Пора показать «входим…» — без поля ввода и без клавиатуры. */
  onJoining: () => void;
  /** Не вышло: вернуть форму, код и ошибка в ней уже стоят. */
  onFallBackToForm: () => void;
}

/**
 * Всё про вход в комнату — в одном месте.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ХУК, А НЕ ЧАСТЬ ЭКРАНА. Способов войти четыре: набрать
 * код, открыть ссылку-приглашение, нажать приглашение друга, нажать кнопку
 * Telegram над клавиатурой. Все четыре обязаны вести себя одинаково — и когда
 * они лежали вперемешку с разметкой главного экрана, отличить «эта строчка про
 * вход» от «эта строчка про меню игр» можно было только чтением всего файла.
 *
 * Здесь же собраны три ошибки, каждая из которых стоила расследования, и
 * каждая — про ПОРЯДОК, а не про разметку:
 *
 *   1. Ссылка-приглашение не работала, потому что попытка тратилась до того,
 *      как приходила авторизация.
 *   2. Автовход по последнему символу защёлкивался булевым флагом, который
 *      либо срабатывал на каждый рендер, либо не срабатывал больше никогда.
 *   3. Кнопка «Войти» на телефоне оказывалась под клавиатурой.
 *
 * Разбирая экран, эти три легко было растащить обратно по разным местам.
 */
export function useRoomJoin({ formOpen, onJoining, onFallBackToForm }: Options) {
  const { t } = useTranslation();
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { joinRoom } = useRoom();

  const [code, setCode] = useState('');

  // Что набранное вообще означает. null, пока это не целый код — всё ниже
  // спрашивает у него, а не меряет длину строки, чтобы «достаточно длинное» и
  // «настоящий код» не разъехались.
  const typedCode = normalizeCode(code);

  /**
   * Единственная дверь в комнату.
   *
   * Набранный код, ссылка, приглашение друга — все приходят сюда. Один путь
   * означает один набор сообщений об ошибке и один экран, на который
   * возвращаются; вторая дверь — это та, которая протухает.
   */
  const enter = useCallback(async (roomCode: string) => {
    const valid = normalizeCode(roomCode);
    if (!valid) return;
    // По той же причине, что и в эффекте про start_param ниже: joinRoom
    // отказывает игроку-null сразу, и попытка до авторизации тратится на
    // гарантированный отказ.
    if (!player) return;
    setCode(valid);
    onJoining();
    await joinRoom(valid);
    // При успехе joinRoom уводит в лобби, значит остались здесь — не вышло.
    // Возвращаем форму: код и ошибка в ней уже стоят.
    if (!useGameStore.getState().room) onFallBackToForm();
  }, [player, joinRoom, onJoining, onFallBackToForm]);

  /** Войти по тому, что набрано в поле. */
  const submit = useCallback(async () => {
    if (!typedCode) return;
    await joinRoom(typedCode);
  }, [typedCode, joinRoom]);

  // ПОСЛЕДНИЙ СИМВОЛ И ЕСТЬ КНОПКА. Шесть символов — это весь код, решать
  // после них нечего, а просить нажатие значит просить игрока найти кнопку,
  // на которой сидит клавиатура (docs/LOBBY_AND_VOICE_FIXES.md §2).
  //
  // Защёлка — по коду, который пробовали последним, а не булевым флагом: после
  // отказа поле сохраняет содержимое, чтобы его поправили, и простой признак
  // «уже пробовали» либо срабатывал бы на каждом рендере, либо не срабатывал
  // больше никогда.
  const autoJoined = useRef<string | null>(null);
  useEffect(() => {
    if (!formOpen || !typedCode || loading) return;
    // Ещё не авторизованы: joinRoom откажет мгновенно, и защёлка ниже
    // запомнила бы этот отказ как «этот код уже пробовали».
    if (!player) return;
    if (autoJoined.current === typedCode) return;
    autoJoined.current = typedCode;
    void joinRoom(typedCode);
  }, [formOpen, typedCode, loading, joinRoom, player]);

  // Пришли по ссылке-приглашению (t.me/…?startapp=CODE): Telegram отдаёт
  // полезную нагрузку в start_param, и это единственное место, которое её
  // читает — без этой половины ссылка открывает приложение, а код уходит в
  // никуда. Вход непроверённый, поэтому сверяется как код комнаты.
  const startParamHandled = useRef(false);
  useEffect(() => {
    if (startParamHandled.current) return;
    const invited = normalizeCode(getInviteCode());
    if (!invited) return;

    // ДОЖДАТЬСЯ ИГРОКА И ТОЛЬКО ПОТОМ ЗАБИРАТЬ ПАРАМЕТР. Именно из-за этого
    // ссылки-приглашения не работали.
    //
    // Авторизация асинхронна, поэтому `player` пуст первый рендер или два
    // после запуска — а joinRoom отвечает игроку-null мгновенным `errors.auth`
    // вместо входа. Защёлка стояла ДО этой попытки, так что единственная
    // попытка приглашения была той, которой гарантирован отказ: приглашённый
    // оказывался на форме кода с ошибкой авторизации, держа в руках ссылку,
    // которая работала прекрасно.
    //
    // Идентичность joinRoom меняется, когда игрок приходит (он в замыкании),
    // поэтому эффект перезапустится сам — ему нужно было лишь перестать
    // тратить единственную попытку, пока входить некому.
    if (!player) return;

    startParamHandled.current = true;
    setCode(invited);
    // НЕ форма кода: она забирает фокус, и приглашённому, которому нечего
    // набирать, всё равно бросили бы клавиатуру поверх уже заполненного поля.
    onJoining();

    let cancelled = false;
    void (async () => {
      await joinRoom(invited);
      if (cancelled) return;
      if (!useGameStore.getState().room) onFallBackToForm();
    })();
    return () => { cancelled = true; };
    // `player` здесь для того, чтобы эффект перезапустился ровно в момент
    // авторизации. Без него проверка выше была бы вечным отказом, а не
    // ожиданием — тот же баг в другой форме.
  }, [joinRoom, player, onJoining, onFallBackToForm]);

  // Telegram рисует MainButton НАД экранной клавиатурой — ровно там, где
  // внутристраничной кнопки «Войти» нет: на телефоне клавиатура накрывает её,
  // едва поле получает фокус (docs/LOBBY_AND_VOICE_FIXES.md §2).
  useMainButton({
    visible: formOpen,
    text: t('home.join_room'),
    active: typedCode !== null && !loading,
    onClick: () => { void submit(); },
  });

  // MainButton поднимается над клавиатурой, но само поле под ней остаться
  // может: форма забирает фокус, и на невысоком экране клавиатура выезжает
  // поверх того, во что печатают. Telegram сообщает об этом (viewportHeight
  // падает, viewportStableHeight — нет); возвращаем поле в середину
  // оставшегося.
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboardOpen = useKeyboardOpen();
  useEffect(() => {
    if (!formOpen || !keyboardOpen) return;
    inputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [formOpen, keyboardOpen]);

  return { code, setCode, typedCode, inputRef, submit, enter, loading, error };
}
