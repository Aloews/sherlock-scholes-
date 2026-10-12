import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconX } from '@tabler/icons-react';
import {
  ALL_CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABEL_EN,
  CATEGORY_LABEL_RU,
  type CardCategory,
} from '@/shared/types/database';

interface Props {
  selectedCategories: CardCategory[] | null;
  onClose: () => void;
  onApply: (categories: CardCategory[] | null) => void;
}

/** Shared category selector for quick play and online rooms. */
export function CategoryPickerDialog({ selectedCategories, onClose, onApply }: Props) {
  const { i18n } = useTranslation();
  const ru = i18n.language.toLowerCase().startsWith('ru');
  const [draft, setDraft] = useState<Set<CardCategory>>(
    () => new Set(selectedCategories ?? ALL_CATEGORIES),
  );
  const toggle = (category: CardCategory) => {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const apply = () => {
    const next = ALL_CATEGORIES.filter((category) => draft.has(category));
    onApply(next.length === ALL_CATEGORIES.length ? null : next);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-picker-title"
        className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-brand-border bg-brand-surface shadow-2xl sm:rounded-3xl"
      >
        <header className="flex items-start gap-3 border-b border-brand-border p-5">
          <div className="min-w-0 flex-1">
            <h2 id="category-picker-title" className="text-lg font-bold text-white">
              {ru ? 'Категории игры' : 'Game categories'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={ru ? 'Закрыть' : 'Close'} className="rounded-xl p-2 text-brand-muted hover:bg-brand-bg hover:text-white">
            <IconX size={18} />
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <span className="text-xs text-brand-muted">
            {ru ? `Выбрано: ${draft.size} из ${ALL_CATEGORIES.length}` : `Selected: ${draft.size} of ${ALL_CATEGORIES.length}`}
          </span>
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setDraft(new Set(ALL_CATEGORIES))} className="font-semibold text-brand-accent">
              {ru ? 'Выбрать все' : 'Select all'}
            </button>
            <button type="button" onClick={() => setDraft(new Set())} className="font-semibold text-brand-muted">
              {ru ? 'Сбросить' : 'Reset'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 overflow-y-auto p-5">
          {ALL_CATEGORIES.map((category) => {
            const selected = draft.has(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => toggle(category)}
                className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-brand-accent/60 bg-brand-accent/10 text-white'
                    : 'border-brand-border bg-brand-bg text-brand-muted hover:text-white'
                }`}
              >
                <span aria-hidden="true">{CATEGORY_EMOJI[category]}</span>
                <span className="min-w-0 flex-1 text-sm">{ru ? CATEGORY_LABEL_RU[category] : CATEGORY_LABEL_EN[category]}</span>
                {selected && <IconCheck size={15} className="shrink-0 text-brand-accent" />}
              </button>
            );
          })}
        </div>

        <footer className="flex gap-3 border-t border-brand-border p-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-brand-border px-4 py-3 text-sm font-semibold text-white">
            {ru ? 'Отмена' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={draft.size === 0}
            onClick={apply}
            className="flex-1 rounded-xl bg-brand-accent px-4 py-3 text-sm font-bold text-brand-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ru ? 'Применить' : 'Apply'}
          </button>
        </footer>
      </section>
    </div>
  );
}
