// Choose the loading banner (Settings → 정보). Each tile previews the banner fully built; the
// selected one replays its 1 → 5 build-up. The choice is stored in localStorage and used by every
// LoadingScreen.
import { useT } from '../i18n/index.tsx';
import { BANNERS, StreakBanner, setLoadingBanner, useLoadingBanner } from './StreakBanner.tsx';
import './loading.css';

export function BannerPicker() {
  const t = useT();
  const current = useLoadingBanner();
  return (
    <div className="pvl-picker" data-testid="banner-picker">
      <div className="pvl-picker-head"><b>{t('load.banner.title')}</b><span>{t('load.banner.hint')}</span></div>
      <div className="pvl-picker-grid" role="radiogroup" aria-label={t('load.banner.title')}>
        {BANNERS.map((id) => (
          <button key={id} role="radio" aria-checked={current === id} className={current === id ? 'on' : ''} onClick={() => setLoadingBanner(id)} data-testid={`banner-${id}`}>
            <StreakBanner variant={id} stage={current === id ? 'loop' : 5} size={84} />
            <span>{t(`load.banner.${id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
