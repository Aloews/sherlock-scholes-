// Звук синтезируется в коде: ни одного файла не отгружается, ни байта трафика.
// Выключатель — settingsStore.soundEnabled (сохраняется), общий с тумблером на
// главной.
//
// ⚠️ ТРАФИК ЗДЕСЬ НИ ПРИ ЧЁМ, И ЭТО ПРОВЕРЯЕТСЯ ТЕСТОМ. Владелец предположил,
// что звуки «много грузят и съедают трафика», и предложил их убрать. Грузить
// нечего: в `public/` нет ни одного mp3/wav/ogg, каждый звук — несколько
// осцилляторов Web Audio, собранных на лету. Убирать их ради трафика значило
// бы лечить болезнь, которой нет.
//
// ⚠️ ЧТО ДЕЙСТВИТЕЛЬНО РАЗДРАЖАЛО — ИЗМЕРИМО, И ЭТО ИСПРАВЛЕНО:
//
//   1. `tick` бил КАЖДУЮ СЕКУНДУ последние десять секунд раунда квадратной
//      волной на 1500 Гц. Квадрат — это нечётные гармоники до самого верха, а
//      2–5 кГц — полоса, где человеческий слух чувствительнее всего. Десять
//      одинаковых уколов подряд в самое чувствительное место, каждый раунд.
//      Теперь это мягкий синус с обертоном, и он РАСТЁТ: на десятой секунде
//      почти неслышен, на первой — отчётлив. Тревога появляется постепенно,
//      как ей и положено, а не долбит ровным уровнем.
//
//   2. `skip` и свистки стояли на 2000–2300 Гц — ровно на пике слуховой
//      чувствительности. Опущены и укорочены; свисток остался свистком,
//      потому что трель узнаётся по РИСУНКУ, а не по высоте.
//
//   3. Атака у всех была 5 мс — это щелчок. Стало 18 мс: тот же звук без
//      укола в начале.
//
//   4. Появился общий низкочастотный фильтр на выходе. Он срезает то, что
//      делает синтез «дешёвым» и резким, и стоит ОДИН на всё: не забудешь
//      применить к новому звуку.
//
// Мастер-уровень снижен с 0.15 до 0.11: это обратная связь на нажатие, а не
// музыка.

import { useSettingsStore } from '@/shared/store/settingsStore';

export type SoundName =
  | 'tick' | 'correct' | 'skip' | 'gong' | 'swipe'
  | 'whistle_start' | 'whistle_end' | 'kick' | 'applause' | 'fanfare';

const MASTER = 0.11;

/** Потолок общего фильтра. Выше него в синтезе живёт только резкость. */
const TONE_CUTOFF_HZ = 3200;

let ctx: AudioContext | null = null;
/** Куда подключаются ВСЕ звуки. Не destination: см. пункт 4 в шапке. */
let bus: BiquadFilterNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Мобильные браузеры создают контекст приостановленным до жеста; все наши
  // звуки идут из обработчиков нажатия, так что возобновлять здесь можно.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Общая шина: мягкий срез верха + мастер-громкость. Создаётся один раз. */
function getBus(ac: AudioContext): AudioNode {
  if (!bus || bus.context !== ac) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = TONE_CUTOFF_HZ;
    // Q чуть ниже единицы: без горба на срезе, иначе фильтр сам зазвенит.
    lp.Q.value = 0.7;
    lp.connect(ac.destination);
    bus = lp;
  }
  return bus;
}

interface ToneOpts {
  freq: number;
  at?: number;            // секунд от «сейчас»
  dur?: number;
  type?: OscillatorType;
  gain?: number;          // 0..1, домножается на MASTER
  glideTo?: number;       // куда съезжает высота
  trillHz?: number;       // частота трели — «горошина» судейского свистка
  trillDepth?: number;
  /** Атака в секундах. Меньше 12 мс слышно как щелчок. */
  attack?: number;
}

function tone(
  ac: AudioContext,
  { freq, at = 0, dur = 0.1, type = 'sine', gain = 1, glideTo,
    trillHz, trillDepth, attack = 0.018 }: ToneOpts,
): void {
  const t0  = ac.currentTime + at;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  }
  if (trillHz && trillDepth) {
    const lfo = ac.createOscillator();
    const lfoAmp = ac.createGain();
    lfo.frequency.setValueAtTime(trillHz, t0);
    lfoAmp.gain.setValueAtTime(trillDepth, t0);
    lfo.connect(lfoAmp).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.02);
  }
  // ⚠️ АТАКА НЕ КОРОЧЕ ДЛИТЕЛЬНОСТИ. У совсем коротких звуков (tick — 40 мс)
  // фиксированные 18 мс съели бы половину, и вместо щелчка вышел бы «вздох».
  const a = Math.min(attack, dur * 0.4);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain * MASTER, t0 + a);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(getBus(ac));
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Судейский свисток: трель — это РИСУНОК, а не высота, поэтому опустить его
// с 2000 до 1450 Гц можно без потери узнаваемости, а слуху заметно легче.
function whistle(
  ac: AudioContext,
  opts: { at?: number; dur?: number; freq?: number; gain?: number; glideTo?: number },
): void {
  tone(ac, {
    freq: opts.freq ?? 1450,
    at: opts.at,
    dur: opts.dur ?? 0.12,
    gain: opts.gain ?? 0.4,
    glideTo: opts.glideTo,
    trillHz: 34,
    trillDepth: 55,
    attack: 0.012,
  });
}

interface NoiseOpts {
  at?: number;
  dur?: number;
  freq?: number;          // центр полосы (Гц)
  glideTo?: number;
  q?: number;
  gain?: number;
}

function noise(
  ac: AudioContext,
  { at = 0, dur = 0.15, freq = 1000, glideTo, q = 1, gain = 1 }: NoiseOpts,
): void {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0  = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq, t0);
  if (glideTo !== undefined) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
  }
  bp.Q.value = q;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain * MASTER, t0 + Math.min(0.02, dur * 0.4));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(amp).connect(getBus(ac));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export interface PlayOpts {
  /**
   * 0..1 — насколько звук должен быть заметен. Сегодня этим пользуется
   * только обратный отсчёт: см. `tick`.
   */
  intensity?: number;
}

/**
 * Обратный отсчёт, который НАРАСТАЕТ.
 *
 * ⚠️ ЭТО И ЕСТЬ ГЛАВНАЯ ПРАВКА. Десять одинаковых уколов подряд — это не
 * информация, а шум: первый и десятый звучали одинаково, хотя означали разное.
 * Теперь на десятой секунде тик едва слышен, к первой — отчётлив, и высота
 * растёт вместе с громкостью. Игрок слышит, сколько осталось, не глядя на
 * экран, и при этом ему не сверлят ухо десять секунд.
 */
function tick(ac: AudioContext, intensity: number): void {
  const k = Math.max(0, Math.min(1, intensity));
  // 620 → 880 Гц: на октаву ниже прежних 1500 и далеко от пика слуха.
  const freq = 620 + 260 * k;
  tone(ac, {
    freq,
    dur: 0.045,
    type: 'sine',
    gain: 0.18 + 0.42 * k,
    attack: 0.006,
  });
  // Обертон появляется только к концу отсчёта — он и делает последние тики
  // «тревожными», не поднимая громкость.
  if (k > 0.55) {
    tone(ac, { freq: freq * 2, dur: 0.03, type: 'sine', gain: 0.12 * k, attack: 0.004 });
  }
}

const SOUNDS: Record<SoundName, (ac: AudioContext, opts: PlayOpts) => void> = {
  tick: (ac, o) => tick(ac, o.intensity ?? 1),

  // «Угадали» — САМЫЙ ЧАСТЫЙ ЗВУК В ИГРЕ: в быстром раунде он звучит два
  // десятка раз. Поэтому он короткий и тёплый, а не победный: длинный
  // радостный звук, повторённый двадцать раз, превращается в барабан.
  // Трибуна стала тише и уже по полосе — она теперь намёк, а не рёв.
  correct: (ac) => {
    tone(ac, { freq: 523.25, dur: 0.1,  type: 'triangle', gain: 0.7, attack: 0.012 });  // C5
    tone(ac, { freq: 783.99, at: 0.07, dur: 0.14, type: 'triangle', gain: 0.6, attack: 0.012 }); // G5
    noise(ac, { dur: 0.16, freq: 700, q: 0.7, gain: 0.22 });
  },

  // «Пропустить» — короткий писк судьи. Опущен с 2000 до 1400 Гц и тише:
  // его жмут почти так же часто, как «угадали».
  skip: (ac) => whistle(ac, { freq: 1400, dur: 0.1, gain: 0.32 }),

  // «Передать ход» — глухой удар по мячу.
  swipe: (ac) => tone(ac, { freq: 150, glideTo: 90, dur: 0.09, gain: 0.9, attack: 0.008 }),

  // Время вышло. Звучит раз в раунд, поэтому может быть весомым.
  gong: (ac) => {
    tone(ac, { freq: 196, dur: 0.75, gain: 0.85, attack: 0.01 });
    tone(ac, { freq: 294, dur: 0.5,  gain: 0.3,  attack: 0.01 });
    tone(ac, { freq: 130.81, dur: 0.9, gain: 0.5, attack: 0.02 });  // низ, чтобы не звенело
  },

  // Начало раунда — двойной свисток.
  whistle_start: (ac) => {
    whistle(ac, { freq: 1500, dur: 0.08, gain: 0.42 });
    whistle(ac, { freq: 1500, at: 0.14, dur: 0.1, gain: 0.42 });
  },

  // Конец раунда — один длинный падающий.
  whistle_end: (ac) => whistle(ac, { freq: 1600, glideTo: 1250, dur: 0.28, gain: 0.42 }),

  kick: (ac) => tone(ac, { freq: 150, glideTo: 50, dur: 0.12, gain: 0.9, attack: 0.006 }),

  applause: (ac) => {
    noise(ac, { dur: 0.11, freq: 1400, q: 0.7, gain: 0.3 });
    noise(ac, { at: 0.08, dur: 0.11, freq: 1700, q: 0.7, gain: 0.26 });
    noise(ac, { at: 0.16, dur: 0.15, freq: 1250, q: 0.7, gain: 0.22 });
  },

  // Конец игры — звучит ОДИН раз за партию, и только здесь уместна музыка.
  fanfare: (ac) => {
    whistle(ac, { freq: 1500, dur: 0.4, gain: 0.4 });
    tone(ac, { freq: 523.25, at: 0.46, dur: 0.14, type: 'triangle', gain: 0.75 });  // C5
    tone(ac, { freq: 659.25, at: 0.6,  dur: 0.14, type: 'triangle', gain: 0.75 });  // E5
    tone(ac, { freq: 783.99, at: 0.74, dur: 0.4,  type: 'triangle', gain: 0.85 });  // G5
    tone(ac, { freq: 392.00, at: 0.74, dur: 0.45, type: 'sine',     gain: 0.4  });  // G4 снизу
  },
};

// Для кнопки «без звука» в игре — обе опираются на settingsStore, поэтому
// кнопка в игре и тумблер на главной всегда согласованы.
export function isMuted(): boolean {
  return !useSettingsStore.getState().soundEnabled;
}

export function toggleMute(): void {
  const { soundEnabled, setSoundEnabled } = useSettingsStore.getState();
  setSoundEnabled(!soundEnabled);
}

export function playSound(name: SoundName, opts: PlayOpts = {}): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const ac = getContext();
  if (!ac) return;
  try {
    SOUNDS[name](ac, opts);
  } catch {
    // Web Audio недоступен или планировщик отказал — молчим.
  }
}

/**
 * Насколько заметным должен быть тик за `remaining` секунд до конца.
 *
 * Вынесено из экрана и наружу НАРОЧНО: это правило («тревога нарастает»), а
 * не деталь верстки, и проверяется тестом без Web Audio.
 */
export const TICK_FROM = 10;

export function tickIntensity(remaining: number, from: number = TICK_FROM): number {
  if (remaining <= 0 || remaining > from) return 0;
  // remaining = from → почти неслышно; remaining = 1 → полная заметность.
  return (from - remaining + 1) / from;
}
