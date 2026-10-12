// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CategoryPickerDialog } from './CategoryPickerDialog';
import { ALL_CATEGORIES } from '@/shared/types/database';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'ru' } }),
}));

afterEach(() => cleanup());

describe('CategoryPickerDialog', () => {
  it('supports reset, select all, and applying the all-categories sentinel', () => {
    const onApply = vi.fn();
    render(
      <CategoryPickerDialog
        selectedCategories={['player']}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect((screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать все' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('returns the selected subset in canonical category order', () => {
    const onApply = vi.fn();
    render(
      <CategoryPickerDialog
        selectedCategories={['player', 'club']}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Игроки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(onApply).toHaveBeenCalledWith(['club']);
    expect(ALL_CATEGORIES).toContain('club');
  });
});
