// Choose the loading banner (Settings → 정보). Each tile previews the banner fully built; the
// selected one replays its 1 → 5 build-up. The choice is stored in localStorage and used by every
// LoadingScreen.
import { useT } from '../i18n/index.tsx';
import { BANNERS, LOCAL_PREFIX, LoadingBanner, StreakBanner, setLoadingBanner, useLoadingBanner, useLocalBanners } from './StreakBanner.tsx';
import './loading.css';

export function BannerPicker() {
  const t = useT();
  const current = useLoadingBanner();
  const local = useLocalBanners();
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
        {local.map((p) => {
          const id = `${LOCAL_PREFIX}${p.id}`;
          return (
            <button key={id} role="radio" aria-checked={current === id} className={current === id ? 'on' : ''} onClick={() => setLoadingBanner(id)} data-testid={`banner-local-${p.id}`}>
              <LoadingBanner variant={id} stage={current === id ? 'loop' : 5} size={84} />
              <span>{p.id}</span>
            </button>
          );
        })}
      </div>
      <p className="pvl-picker-note">{local.length > 0 ? t('load.banner.localFound', { n: local.length }) : t('load.banner.localHint')}</p>
    </div>
  );
}
