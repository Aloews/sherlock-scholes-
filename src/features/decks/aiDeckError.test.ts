import { describe, expect, it } from 'vitest';
import { aiDeckErrorMessage, edgeFunctionErrorCode } from './aiDeckError';

describe('AI deck errors', () => {
  it('extracts structured errors from Supabase function responses', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: 'telegram_auth_invalid' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    await expect(edgeFunctionErrorCode(error)).resolves.toBe('telegram_auth_invalid');
  });

  it('explains expired Telegram sessions instead of reporting a generic AI failure', () => {
    expect(aiDeckErrorMessage('telegram_auth_invalid', true)).toContain('Telegram');
    expect(aiDeckErrorMessage('telegram_auth_invalid', true)).toContain('заново открой');
  });

  it('keeps provider and catalog errors actionable without exposing internal details', () => {
    expect(aiDeckErrorMessage('catalog_unavailable', true)).toContain('временно недоступен');
    expect(aiDeckErrorMessage('player_lookup_unavailable', true)).toContain('временно недоступен');
    expect(aiDeckErrorMessage('deck_build_failed', true)).toContain('Попробуй ещё раз');
  });
});
