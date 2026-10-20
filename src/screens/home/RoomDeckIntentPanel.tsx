import { useTranslation } from 'react-i18next';
import { IconLoader2, IconSparkles } from '@tabler/icons-react';
import { VoicePromptButton } from '@/shared/ui/VoicePromptButton';

interface Props {
  prompt: string;
  loading: boolean;
  message: string;
  onPromptChange: (value: string) => void;
  onBuild: () => void;
}

export function RoomDeckIntentPanel({ prompt, loading, message, onPromptChange, onBuild }: Props) {
  const { i18n } = useTranslation();
  const ru = i18n.language.startsWith('ru');

  return (
    <section className="rounded-2xl border border-brand-accent/30 bg-brand-surface p-4 space-y-3">
      <div className="flex items-center gap-2 text-brand-accent">
        <IconSparkles size={18} />
        <h3 className="text-sm font-bold text-white">{ru ? 'Колода по запросу' : 'Deck from a prompt'}</h3>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); onBuild(); }} className="space-y-2">
        <textarea
          aria-label={ru ? 'Запрос ИИ для колоды комнаты' : 'AI room deck request'}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder={ru ? 'Например: вратари АПЛ, легенды Барселоны, стадионы Италии' : 'For example: Premier League goalkeepers, Barcelona legends, stadiums in Italy'}
          className="w-full resize-y rounded-xl border border-brand-border bg-brand-bg px-3 py-3 text-sm text-white placeholder:text-brand-muted focus:outline-none focus:border-brand-accent"
        />
        <VoicePromptButton value={prompt} language={i18n.language} disabled={loading} onChange={onPromptChange} />
        <button
          type="submit"
          disabled={prompt.trim().length < 3 || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 py-3 text-sm font-bold text-brand-bg disabled:opacity-40"
        >
          {loading ? <IconLoader2 size={17} className="animate-spin" /> : <IconSparkles size={17} />}
          {ru ? 'Определить запрос и собрать колоду' : 'Understand request and build deck'}
        </button>
      </form>
      {message && <p role="status" aria-live="polite" className="text-xs text-brand-muted">{message}</p>}
    </section>
  );
}
