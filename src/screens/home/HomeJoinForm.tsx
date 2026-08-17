import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { hapticImpact } from '@/shared/lib/telegram';
import { sanitizeCodeInput, CODE_LENGTH } from '@/features/lobby/invite';

interface Props {
  code: string;
  onCode: (value: string) => void;
  /** Набранное, если это уже целый код. null — кнопка неактивна. */
  typedCode: string | null;
  inputRef: Ref<HTMLInputElement>;
  loading: boolean;
  onSubmit: () => void;
  onBack: () => void;
}

/**
 * Поле кода комнаты.
 *
 * ⚠️ ПОЛЕ ЗДЕСЬ, А ЛОГИКА ВХОДА — В `useRoomJoin`, и это не разделение ради
 * разделения. Автовход по последнему символу, кнопка Telegram над клавиатурой
 * и подкрутка прокрутки, когда клавиатура накрыла поле, — всё это про вход, а
 * не про разметку, и каждое из них уже однажды сломалось. Здесь остаётся
 * только то, что видно.
 */
export function HomeJoinForm({
  code, onCode, typedCode, inputRef, loading, onSubmit, onBack,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-4 animate-slide-up">
      <div className="space-y-2">
        <label className="text-brand-muted text-sm font-medium">
          {t('home.room_code_label')}
        </label>
        <input
          ref={inputRef}
          type="text"
          maxLength={CODE_LENGTH}
          value={code}
          // Очищается, а не приводится к верхнему регистру: поле обязано
          // держать ровно то, что может держать код, чтобы управляемое
          // значение никогда не расходилось с тем, что выдала клавиатура.
          // См. sanitizeCodeInput.
          onChange={(e) => onCode(sanitizeCodeInput(e.target.value))}
          // Клавиша действия на самой клавиатуре отправляет форму, чтобы
          // игроку не пришлось тянуться к кнопке, спрятанной за этой же
          // клавиатурой.
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
          enterKeyHint="go"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('home.room_code_placeholder')}
          className="w-full h-14 bg-brand-surface border border-brand-border rounded-2xl px-4 text-white text-2xl font-black tracking-[0.5em] text-center uppercase placeholder-brand-muted/50 focus:outline-none focus:border-brand-accent transition-colors"
          autoFocus
        />
      </div>
      <Button fullWidth size="lg" loading={loading} disabled={typedCode === null} onClick={onSubmit}>
        {t('home.join_room')}
      </Button>
      <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); onBack(); }}>
        {t('home.back')}
      </Button>
    </div>
  );
}
