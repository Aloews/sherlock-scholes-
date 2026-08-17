import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import {
  readInputMessage,
  readSnapshot,
  type InputMessage,
  type Snapshot,
} from './net';

/**
 * Канал сетевой арены поверх Supabase Realtime broadcast.
 *
 * ПОЧЕМУ BROADCAST, А НЕ ТАБЛИЦА. Соседний `useLobby` слушает
 * `postgres_changes`, и для лобби это верно: там события редкие и обязаны
 * пережить перезаход. Здесь наоборот — двадцать посылок в секунду, каждая
 * протухает через пятьдесят миллисекунд. Писать их в таблицу значит просить
 * Postgres хранить то, что никому не нужно уже к следующему кадру.
 *
 * ПРИСУТСТВИЕ ОТДЕЛЬНО ОТ ДАННЫХ. Игроку надо знать, что соперник ушёл, а
 * молчание в канале об этом не говорит: оно одинаково выглядит и как «вышел»,
 * и как «моргнула сеть». Presence отвечает на это прямо.
 */

export type NetRole = 'host' | 'guest';

export type NetStatus =
  /** Подключаемся к каналу. */
  | 'connecting'
  /** В канале, но соперника ещё нет. */
  | 'waiting'
  /** Оба на месте. */
  | 'playing'
  /** Соперник ушёл — не «пауза», а конец: играть не с кем. */
  | 'left'
  /** Канал не открылся. */
  | 'error';

export interface ArenaNet {
  status: NetStatus;
  /** Гость → хосту. */
  sendInput(message: InputMessage): void;
  /** Хост → гостю. */
  sendSnapshot(snapshot: Snapshot): void;
}

interface Options {
  /** Код комнаты. Пустой — сеть не поднимается вовсе. */
  code: string | null;
  role: NetRole;
  /** Пришёл ввод гостя. Зовётся только у хоста. */
  onInput?: (message: InputMessage) => void;
  /** Пришёл снимок хоста. Зовётся только у гостя. */
  onSnapshot?: (snapshot: Snapshot) => void;
}

export function useArenaNet({ code, role, onInput, onSnapshot }: Options): ArenaNet {
  const [status, setStatus] = useState<NetStatus>('connecting');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Обработчики держим в ref: они пересоздаются на каждый рендер, а канал
  // должен подниматься ОДИН раз за код. Иначе каждая перерисовка рвала бы
  // соединение и заново здоровалась — двадцать раз в секунду.
  const onInputRef = useRef(onInput);
  const onSnapshotRef = useRef(onSnapshot);
  onInputRef.current = onInput;
  onSnapshotRef.current = onSnapshot;

  useEffect(() => {
    if (!code) return;

    const channel = supabase.channel(`arena-${code}`, {
      config: {
        // Своё эхо не нужно никому: хост не слушает снимки, гость не слушает
        // ввод, и лишний круг только грузит канал.
        broadcast: { self: false },
        presence: { key: role },
      },
    });

    channel
      .on('broadcast', { event: 'input' }, ({ payload }) => {
        if (role !== 'host') return;
        const message = readInputMessage(payload);
        if (message) onInputRef.current?.(message);
      })
      .on('broadcast', { event: 'snapshot' }, ({ payload }) => {
        if (role !== 'guest') return;
        const snapshot = readSnapshot(payload);
        if (snapshot) onSnapshotRef.current?.(snapshot);
      })
      .on('presence', { event: 'sync' }, () => {
        const others = Object.keys(channel.presenceState()).filter((k) => k !== role);
        setStatus((prev) => {
          if (others.length > 0) return 'playing';
          // Ушёл — это «left», но только если он УЖЕ был. Иначе первый sync
          // сразу после входа объявлял бы уход соперника, который ещё не
          // приходил.
          return prev === 'playing' ? 'left' : 'waiting';
        });
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          // ⚠️ `error` ОБЯЗАН СБРАСЫВАТЬСЯ ЗДЕСЬ, и раньше не сбрасывался.
          // Условие было `prev === 'connecting'`, а после обрыва prev равен
          // `error`: supabase-js сам переподнимает канал и снова зовёт этот
          // колбэк с SUBSCRIBED, но статус оставался `error` — канал живой, а
          // экран показывает «ошибка связи». Presence обычно поправлял это
          // следующим sync'ом, но «обычно» здесь недостаточно: sync приходит
          // не мгновенно, и игрок успевает прочитать надпись о поломке,
          // которой нет.
          //
          // `playing` не трогаем: соперник уже был в канале, и объявлять
          // ожидание из-за собственного переподключения значило бы гасить
          // поле у того, у кого связь как раз в порядке.
          setStatus((prev) => (prev === 'playing' ? prev : 'waiting'));
          void channel.track({ role, at: Date.now() });
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          setStatus('error');
        }
      });

    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [code, role]);

  const sendInput = useCallback((message: InputMessage) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'input', payload: message });
  }, []);

  const sendSnapshot = useCallback((snapshot: Snapshot) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'snapshot', payload: snapshot });
  }, []);

  return { status, sendInput, sendSnapshot };
}
