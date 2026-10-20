import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';

interface SpeechResult {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechError {
  error?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: ((event: SpeechError) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

interface Props {
  value: string;
  language: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function VoicePromptButton({ value, language, disabled = false, onChange }: Props) {
  const { i18n } = useTranslation();
  const ru = i18n.language.startsWith('ru');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError(ru
        ? 'Голосовой ввод не поддерживается этим браузером. Используй клавиатуру.'
        : 'Voice input is not supported by this browser. Use the keyboard.');
      return;
    }

    setError('');
    const recognition = new Recognition();
    recognition.lang = language.toLowerCase().startsWith('ru') ? 'ru-RU' : 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) onChange([value.trim(), transcript].filter(Boolean).join(value.trim() ? ' ' : ''));
    };
    recognition.onerror = () => {
      setError(ru
        ? 'Не удалось распознать речь. Проверь разрешение на микрофон и попробуй ещё раз.'
        : 'Speech recognition failed. Check microphone permission and try again.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError(ru ? 'Не удалось включить микрофон.' : 'Could not start the microphone.');
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggleListening}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={listening ? (ru ? 'Остановить голосовой ввод' : 'Stop voice input') : (ru ? 'Голосовой ввод' : 'Voice input')}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          listening
            ? 'border-red-400/50 bg-red-400/10 text-red-300'
            : 'border-brand-border bg-brand-bg text-white hover:border-brand-accent/50'
        }`}
      >
        {listening ? <IconMicrophoneOff size={16} /> : <IconMicrophone size={16} />}
        {listening ? (ru ? 'Слушаю…' : 'Listening…') : (ru ? 'Голосовой ввод' : 'Voice input')}
      </button>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
