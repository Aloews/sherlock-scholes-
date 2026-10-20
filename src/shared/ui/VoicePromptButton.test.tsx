// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'ru' } }),
}));

import { VoicePromptButton } from './VoicePromptButton';

afterEach(() => {
  cleanup();
  delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('VoicePromptButton', () => {
  it('reports when browser speech recognition is unavailable', () => {
    render(<VoicePromptButton value="" language="ru" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    expect(screen.getByRole('alert').textContent).toContain('не поддерживается');
  });

  it('appends recognized speech to the existing prompt in Russian mode', () => {
    let recognition: any;
    class MockRecognition {
      lang = '';
      interimResults = true;
      continuous = true;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() { recognition = this; }
    }
    (window as any).SpeechRecognition = MockRecognition;
    const onChange = vi.fn();
    render(<VoicePromptButton value="любительская команда" language="ru" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));

    expect(recognition.lang).toBe('ru-RU');
    expect(recognition.interimResults).toBe(false);
    expect(recognition.continuous).toBe(false);
    expect(recognition.start).toHaveBeenCalledTimes(1);
    recognition.onresult({ results: [[{ transcript: 'SMB из лиги City Football' }]] });
    expect(onChange).toHaveBeenCalledWith('любительская команда SMB из лиги City Football');
  });

  it('uses English recognition when the app language is English', () => {
    let recognition: any;
    class MockRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      constructor() { recognition = this; }
    }
    (window as any).webkitSpeechRecognition = MockRecognition;
    render(<VoicePromptButton value="" language="en" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Голосовой ввод' }));
    expect(recognition.lang).toBe('en-US');
  });
});
