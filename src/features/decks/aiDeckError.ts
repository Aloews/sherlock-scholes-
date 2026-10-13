export async function edgeFunctionErrorCode(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return '';
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown; code?: unknown };
      if (typeof payload.error === 'string') return payload.error;
      if (context.status === 401) return 'telegram_auth_invalid';
      if (typeof payload.code === 'string' && payload.code !== '401') return payload.code;
      if (context.status === 429) return 'rate_limited';
    } catch {
      return '';
    }
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

export function aiDeckErrorMessage(code: string, russian: boolean): string {
  if (['auth', 'telegram_auth_required', 'telegram_auth_invalid'].includes(code)) {
    return russian
      ? 'Не удалось подтвердить данные Telegram. Закрой и заново открой приложение через Telegram.'
      : 'Could not verify Telegram data. Close and reopen the app through Telegram.';
  }
  if (code === 'player_not_found') {
    return russian
      ? 'Не удалось подтвердить профиль. Перезапусти приложение через Telegram.'
      : 'Could not verify your profile. Reopen the app through Telegram.';
  }
  if (code === 'rate_limited') {
    return russian
      ? 'Слишком много запросов подряд. Подожди немного и попробуй снова.'
      : 'Too many requests in a row. Wait a moment and try again.';
  }
  if (code === 'not_enough_cards') {
    return russian
      ? 'Не найдено достаточно подходящих карточек. Уточни тему, клуб или период.'
      : 'Not enough matching cards were found. Refine the topic, club, or era.';
  }
  if (['catalog_unavailable', 'quota_unavailable', 'server_not_configured', 'telegram_auth_unavailable'].includes(code)) {
    return russian
      ? 'Каталог или сервис подбора временно недоступен. Попробуй снова чуть позже.'
      : 'The deck catalog or builder is temporarily unavailable. Try again shortly.';
  }
  return russian
    ? 'Не удалось обработать запрос. Попробуй ещё раз чуть позже.'
    : 'The request could not be processed. Try again shortly.';
}
