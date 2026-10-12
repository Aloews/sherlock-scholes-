// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { normalizeCode } from '@/features/lobby/invite';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn() }));
vi.mock('./OpenRoomsPanel', () => ({ OpenRoomsPanel: () => <div data-testid="open-rooms" /> }));
vi.mock('@/shared/ui/Button', () => ({
  Button: ({ children, disabled, onClick, ...props }: any) =>
    <button disabled={disabled} onClick={onClick} {...props}>{children}</button>,
}));

import { HomeJoinForm } from './HomeJoinForm';

function Harness({ onSubmit = vi.fn() }: { onSubmit?: () => void }) {
  const [code, setCode] = useState('');
  return <HomeJoinForm
    code={code}
    onCode={setCode}
    typedCode={normalizeCode(code)}
    inputRef={{ current: null }}
    loading={false}
    onSubmit={onSubmit}
    onJoinRoom={vi.fn()}
    playerId={123}
    onBack={vi.fn()}
  />;
}

afterEach(() => cleanup());

describe('HomeJoinForm room-code input', () => {
  it('preserves every character while the user types a six-character code', () => {
    render(<Harness />);
    const input = screen.getByLabelText('home.room_code_label') as HTMLInputElement;
    for (const value of ['a', 'ab', 'ab1', 'ab12', 'ab12c', 'ab12cd']) {
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
    }
    expect(input.value).toHaveLength(6);
    expect(normalizeCode(input.value)).toBe('AB12CD');
    expect(screen.getByRole('button', { name: 'home.join_room' })).toHaveProperty('disabled', false);
  });

  it('normalizes a pasted invitation URL into the six-character code', () => {
    render(<Harness />);
    const input = screen.getByLabelText('home.room_code_label') as HTMLInputElement;
    fireEvent.paste(input, {
      clipboardData: { getData: () => 'https://t.me/sherlock_scholes_bot?start=ab12cd' },
    });
    expect(input.value).toBe('AB12CD');
    expect(input.value).toHaveLength(6);
  });

  it('does not allow joining with fewer than six characters', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByLabelText('home.room_code_label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab12' } });
    expect(screen.getByRole('button', { name: 'home.join_room' })).toHaveProperty('disabled', true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the complete code without dropping its final character', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByLabelText('home.room_code_label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab12cd' } });
    fireEvent.click(screen.getByRole('button', { name: 'home.join_room' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
