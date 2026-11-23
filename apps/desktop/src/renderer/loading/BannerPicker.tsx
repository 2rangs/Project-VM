// Choose the loading banner (Settings → 정보). Each tile previews the banner fully built; the
// selected one replays its 1 → 5 build-up. The choice is stored in localStorage and used by every
// LoadingScreen.
import { useT } from '../i18n/index.tsx';
import { BANNERS, LOCAL_PREFIX, LoadingBanner, StreakBanner, setBannerSound, setLoadingBanner, useBannerSound, useLoadingBanner, useLocalBanners } from './StreakBanner.tsx';
import './loading.css';

export function BannerPicker() {
  const t = useT();
  const current = useLoadingBanner();
  const local = useLocalBanners();
  const sound = useBannerSound();
  const hasSounds = local.some((p) => p.sounds && Object.keys(p.sounds).length > 0);
  return (
    <div className="pvl-picker" data-testid="banner-picker">
      <div className="pvl-picker-head"><b>{t('load.banner.title')}</b><span>{t('load.banner.hint')}</span></div>
      <div className="pvl-picker-grid" role="radiogroup" aria-label={t('load.banner.title')}>
        <button role="radio" aria-checked={current === 'vct'} className={current === 'vct' ? 'on' : ''} onClick={() => setLoadingBanner('vct')} data-testid="banner-vct">
          <LoadingBanner variant="vct" stage={5} size={84} />
          <span>VCT</span>
        </button>
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
      {hasSounds && (
        <div className="pvl-sound" data-testid="banner-sound">
          <label><input type="checkbox" checked={sound.on} onChange={(e) => setBannerSound({ on: e.target.checked })} data-testid="banner-sound-on" />{t('load.banner.sound')}</label>
          <label className={sound.on ? '' : 'off'}>{t('load.banner.volume')}
            <input type="range" min={0} max={1} step={0.05} value={sound.volume} disabled={!sound.on} onChange={(e) => setBannerSound({ volume: Number(e.target.value) })} data-testid="banner-sound-volume" />
            <b>{Math.round(sound.volume * 100)}%</b>
          </label>
        </div>
      )}
      <p className="pvl-picker-note">{local.length > 0 ? t('load.banner.localFound', { n: local.length }) : t('load.banner.localHint')}</p>
    </div>
  );
}
