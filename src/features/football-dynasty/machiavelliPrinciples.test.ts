import { describe, expect, it } from 'vitest';
import { machiavelliPrinciples } from './machiavelliPrinciples';
import ru from '@/shared/i18n/locales/ru.json';
import en from '@/shared/i18n/locales/en.json';
import es from '@/shared/i18n/locales/es.json';
import pt from '@/shared/i18n/locales/pt.json';
import fr from '@/shared/i18n/locales/fr.json';
import ar from '@/shared/i18n/locales/ar.json';
import ja from '@/shared/i18n/locales/ja.json';
import ko from '@/shared/i18n/locales/ko.json';
import zh from '@/shared/i18n/locales/zh.json';

describe('Machiavellian doctrine curriculum', () => {
  const bestChoiceIds = ['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'];
  it.each([
    ['ru', machiavelliPrinciples.ru],
    ['en', machiavelliPrinciples.en],
  ])('%s has exactly 18 complete, ordered decision lessons', (_locale, lessons) => {
    expect(lessons).toHaveLength(18);
    expect(lessons.map((lesson) => lesson.id)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    for (const lesson of lessons) {
      expect(lesson.bestChoiceId).toBe(bestChoiceIds[lesson.id - 1]);
      expect(lesson.title.trim()).not.toBe('');
      expect(lesson.source.trim()).not.toBe('');
      expect(lesson.idea.trim()).not.toBe('');
      expect(lesson.scenario.trim()).not.toBe('');
      expect(lesson.takeaway.trim()).not.toBe('');
      expect(lesson.choices).toHaveLength(3);
      expect(lesson.choices.map((choice) => choice.id).sort()).toEqual(['a', 'b', 'c']);
      expect(lesson.choices.every((choice) => choice.label.trim() && choice.consequence.trim())).toBe(true);
    }
  });

  it.each([
    ['ru', ru], ['en', en], ['es', es], ['pt', pt], ['fr', fr],
    ['ar', ar], ['ja', ja], ['ko', ko], ['zh', zh],
  ] as const)('%s has every academy interface label', (_locale, dictionary) => {
    const labels = (dictionary as { machiavelli: Record<string, string> }).machiavelli;
    for (const key of [
      'eyebrow', 'title', 'subtitle', 'progress', 'principle', 'completed',
      'locked', 'loading', 'error', 'finishedTitle', 'finishedText',
      'totalScore', 'scenario', 'choose', 'yourDecision', 'score',
      'takeaway', 'submit', 'scoreMeaning', 'strongestOption',
    ]) {
      expect(labels[key]?.trim(), key).not.toBe('');
    }
  });
});
