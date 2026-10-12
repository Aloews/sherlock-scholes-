// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { HomeJoinForm } from './HomeJoinForm';
import { normalizeCode } from '@/features/lobby/invite';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn() }));
vi.mock('./OpenRoomsPanel', () => ({ OpenRoomsPanel: () => <div data-testid="open-rooms" /> }));

function Harness() {
  const [code, setCode] = useState('');
  return <HomeJoinForm code={code} onCode={setCode} typedCode={normalizeCode(code)}
    inputRef={{ current: null }} loading={false} onSubmit={vi.fn()} onJoinRoom={vi.fn()}
    playerId={1} onBack={vi.fn()} />;
}

afterEach(() => cleanup());

describe('HomeJoinForm room-code input', () => {
  it('retains all six characters while typing instead of collapsing to the last character', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('home.room_code_placeholder') as HTMLInputElement;
    for (const value of ['A', 'AB', 'AB1', 'AB12', 'AB12C', 'AB12CD']) {
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
    }
    expect(screen.getByRole('button', { name: 'home.join_room' })).toHaveProperty('disabled', false);
  });

  it('does not enable joining before the full six-character code is present', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('home.room_code_placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'AB12C' } });
    expect(input.value).toBe('AB12C');
    expect(screen.getByRole('button', { name: 'home.join_room' })).toHaveProperty('disabled', true);
  });

  it('accepts a pasted invite link and retains the six-character code', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('home.room_code_placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://t.me/sherlock_scholes_bot?start=AB12CD' } });
    expect(input.value).toBe('AB12CD');
    expect(screen.getByRole('button', { name: 'home.join_room' })).toHaveProperty('disabled', false);
  });
});
