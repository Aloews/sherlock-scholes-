import { useEffect, useRef } from 'react';
import { touchPresence } from './presenceApi';
import { getRawInitData } from '@/shared/lib/telegram';

/**
 * Как часто отмечаться живым.
 *
 * ⚠️ СВЯЗАНО С `presence_window()` НА СЕРВЕРЕ (пять минут). Удар раз в минуту
 * значит, что пропуск двух-трёх подряд — метро, блокировка экрана — ещё не
 * выкидывает из списка. Растянуть период до пяти минут значило бы, что один
 * пропущенный удар делает человека невидимым; сократить до секунд — платить
 * запросом за каждое движение. Менять только вместе с окном.
 */
const BEAT_MS = 60_000;

/**
 * Отмечаться живым, пока приложение ОТКРЫТО И ВИДНО.
 *
 * ⚠️ ВИДИМОСТЬ ВКЛАДКИ — НЕ ПРИДИРКА, А СУТЬ. Телефон с приложением в фоне
 * продолжал бы стучаться и держал бы человека в списке «онлайн» часами: его
 * позвали бы смотреть матч, а он давно занят другим. Приглашение в пустоту
 * хуже пустого списка, потому что пустой честен.
 *
 * Поэтому таймер живёт только при `visibilityState === 'visible'`, а на
 * возвращении к приложению бьёт СРАЗУ, не дожидаясь минуты: иначе вернувшийся
 * ещё минуту оставался бы невидимым.
 */
export function usePresence(enabled = true): void {
  // initData не меняется за жизнь страницы, но читаем через ref, чтобы эффект
  // не перезапускался из-за новой строки.
  const initData = useRef(getRawInitData());

  useEffect(() => {
    if (!enabled || !initData.current) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const beat = () => { void touchPresence(initData.current); };

    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, BEAT_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start(); else stop();
    };

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [enabled]);
}
