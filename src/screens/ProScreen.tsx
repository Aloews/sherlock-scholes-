import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft, IconStar, IconCheck, IconCrown, IconLock,
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { useProStore } from '@/shared/store/proStore';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { hapticImpact } from '@/shared/lib/telegram';
import { PRO_PRICE_STARS, PRO_FRAMES, FRAME_COLOR } from '@/shared/lib/pro';

// Pro upsell + (for owners) cosmetics. The "buy" button is a STUB — real
// Telegram Stars payment is a separate step. is_pro here comes from the
// server-validated proStore, never the client.
export function ProScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isPro = useProStore((s) => s.isPro);
  const { proFrame, setProFrame } = useSettingsStore();
  const [showSoon, setShowSoon] = useState(false);

  const benefits = [
    t('pro.benefit_legends'),
    t('pro.benefit_all'),
    t('pro.benefit_cosmetics'),
    t('pro.benefit_forever'),
  ];

  const handleBuy = () => {
    hapticImpact('medium');
    setShowSoon(true); // payment not wired yet
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 pt-8">
        <button
          onClick={() => { hapticImpact('light'); navigate(-1); }}
          aria-label={t('pro.back')}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface border border-brand-border text-brand-muted hover:text-white transition-colors"
        >
          <IconArrowLeft size={18} stroke={2} />
        </button>
        <span className="text-white font-bold">{t('pro.title')}</span>
      </div>

      <div className="flex-1 px-6 pb-8 flex flex-col items-center">
        {/* Hero */}
        <div className="mt-2 mb-6 flex flex-col items-center text-center gap-2">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(255,210,74,0.12)' }}
          >
            <IconCrown size={36} stroke={1.5} color="#FFD24A" />
          </div>
          <h1 className="text-white text-2xl font-black">{t('pro.title')}</h1>
          <p className="text-brand-muted text-sm">{t('pro.subtitle')}</p>
        </div>

        {/* Benefits */}
        <div className="w-full max-w-sm bg-brand-surface rounded-2xl border border-brand-border p-4 space-y-3">
          <p className="text-brand-muted text-xs uppercase tracking-wider">
            {t('pro.benefits_title')}
          </p>
          {benefits.map((b) => (
            <div key={b} className="flex items-start gap-3">
              <span className="mt-0.5 text-brand-accent flex-shrink-0">
                <IconCheck size={18} stroke={2.5} />
              </span>
              <span className="text-white text-sm">{b}</span>
            </div>
          ))}
        </div>

        {/* Owned state vs purchase */}
        {isPro ? (
          <div className="w-full max-w-sm mt-5 bg-brand-accent/10 border border-brand-accent/30 rounded-2xl p-4 text-center">
            <p className="text-white font-bold">{t('pro.owned_title')}</p>
            <p className="text-brand-muted text-sm mt-1">{t('pro.owned_desc')}</p>
          </div>
        ) : (
          <div className="w-full max-w-sm mt-5 space-y-3">
            <div className="flex items-center justify-center gap-2 text-white">
              <IconStar size={22} stroke={2} color="#FFD24A" fill="#FFD24A" />
              <span className="text-2xl font-black">{PRO_PRICE_STARS}</span>
              <span className="text-brand-muted text-sm">Telegram Stars</span>
            </div>
            <p className="text-brand-muted/60 text-xs text-center">{t('pro.price_note')}</p>
            <Button fullWidth size="lg" onClick={handleBuy}>
              {t('pro.buy', { stars: PRO_PRICE_STARS })}
            </Button>
            {showSoon && (
              <div className="bg-brand-surface border border-brand-border rounded-2xl p-3 text-center animate-fade-in">
                <p className="text-brand-muted text-sm">{t('pro.soon')}</p>
              </div>
            )}
          </div>
        )}

        {/* Cosmetics — avatar frame (Pro only) */}
        <div className="w-full max-w-sm mt-6">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-brand-muted text-xs uppercase tracking-wider">
              {t('pro.cosmetics_title')}
            </p>
            {!isPro && <IconLock size={13} stroke={2} className="text-brand-muted" />}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PRO_FRAMES.map((frame) => {
              const color = FRAME_COLOR[frame];
              const selected = proFrame === frame;
              return (
                <button
                  key={frame}
                  disabled={!isPro}
                  onClick={() => { hapticImpact('light'); setProFrame(frame); }}
                  className={`rounded-xl py-3 px-2 text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    selected ? 'border-brand-accent text-white' : 'border-brand-border text-brand-muted'
                  }`}
                >
                  <span
                    className="block w-6 h-6 rounded-full mx-auto mb-1.5 bg-brand-border"
                    style={color ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
                  />
                  {t(`pro.frame_${frame}`)}
                </button>
              );
            })}
          </div>
          {!isPro && (
            <p className="text-brand-muted/60 text-xs mt-2">{t('pro.cosmetics_locked')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
