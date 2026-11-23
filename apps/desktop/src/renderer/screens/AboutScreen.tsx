import { RATINGS_DISCLAIMER, TEAMS_DISCLAIMER } from '../data.ts';
import { Disclaimer } from '../ui.tsx';
import { useLang } from '../i18n/index.tsx';
import { BannerPicker } from '../loading/BannerPicker.tsx'; // [loading] choose the loading banner

export function AboutScreen() {
  const { t, lang, setLang } = useLang();
  return (
    <div className="pad about">
      <h2>{t('about.title')}</h2>

      <div className="lang-switch" data-testid="lang-switch">
        <span className="muted small">{t('about.language')}:</span>
        <button className={lang === 'ko' ? 'on' : ''} onClick={() => setLang('ko')} data-testid="lang-ko">{t('about.langKo')}</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} data-testid="lang-en">{t('about.langEn')}</button>
      </div>

      <BannerPicker />

      <Disclaimer text={t('about.disclaimer')} />
      <p className="muted">{t('about.intro')}</p>
      <h3>{t('about.provenance')}</h3>
      <ul className="prov-list">
        <li>{t('about.prov.ratings')}</li>
        <li>{t('about.prov.teams')}</li>
        <li>{t('about.prov.tactics')}</li>
        <li>{t('about.prov.sim')}</li>
        <li>{t('about.prov.vrf')}</li>
      </ul>
      <details className="rawdisc">
        <summary>{t('about.rawDisc')}</summary>
        <p className="small muted">{RATINGS_DISCLAIMER}</p>
        <p className="small muted">{TEAMS_DISCLAIMER}</p>
      </details>
    </div>
  );
}
