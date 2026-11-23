// Start menu: what the app opens on — no engine runs until the manager picks something.
// New career · Continue (latest save) · Load (save slots) · Settings · Quick Match (sandbox:
// the old match / dev tools) · Quit.
import { useEffect, useState } from 'react';
import { bridge, runtime } from '../../platform.ts';
import { useLang } from '../../i18n/index.tsx';
import type { SaveSlot, SaveSlotInfo } from '../../../shared/career.ts';
import { loadCareer, setSimMode, useCareer } from '../../career/session.ts';
import { LoadingScreen } from '../../loading/Loading.tsx';

export function StartMenu({ onNewCareer, onQuickMatch }: { onNewCareer: () => void; onQuickMatch: () => void }) {
  const { t, lang, setLang } = useLang();
  const cs = useCareer();
  const [slots, setSlots] = useState<SaveSlotInfo[] | null>(null);
  const [panel, setPanel] = useState<'main' | 'load' | 'settings'>('main');
  const refresh = () => { bridge.saveList().then(setSlots).catch(() => setSlots([])); };
  useEffect(refresh, []);

  const latest = (slots ?? []).filter((s) => s.meta).sort((a, b) => (b.meta!.savedAt < a.meta!.savedAt ? -1 : 1))[0] ?? null;
  const open = async (slot: SaveSlot) => { await loadCareer(slot); };
  const remove = async (slot: SaveSlot) => {
    if (!window.confirm(t('start.load.deleteConfirm', { slot: t(`start.slot.${slot}`) }))) return;
    await bridge.saveDelete(slot); refresh();
  };

  if (cs.busy?.kind === 'load') return <LoadingScreen cover="window" testId="career-progress" title={t('start.loading')} />;

  return (
    <div className="start" data-testid="start-menu">
      <div className="start-brand">
        <div className="start-logo">PROJECT <b>V</b></div>
        <div className="muted">{t('start.tagline')}</div>
      </div>

      {panel === 'main' && (
        <div className="start-menu">
          <button className="start-btn primary" onClick={onNewCareer} data-testid="start-new-career">{t('start.new')}</button>
          <button className="start-btn" disabled={!latest} onClick={() => latest && void open(latest.slot)} data-testid="start-continue">
            {t('start.continue')}
            {latest?.meta && <span className="start-sub">{latest.meta.teamName} · {latest.meta.date} · {latest.meta.manager}</span>}
          </button>
          <button className="start-btn" onClick={() => { refresh(); setPanel('load'); }} data-testid="start-load">{t('start.load')}</button>
          <button className="start-btn" onClick={() => setPanel('settings')} data-testid="start-settings">{t('start.settings')}</button>
          <button className="start-btn ghost" onClick={onQuickMatch} data-testid="start-quick-match">
            {t('start.quick')}<span className="start-sub">{t('start.quick.sub')}</span>
          </button>
          <button className="start-btn ghost" onClick={() => void bridge.quit()} data-testid="start-quit">{t('start.quit')}</button>
          {cs.error && <div className="err small" data-testid="start-error">⚠ {cs.error}</div>}
        </div>
      )}

      {panel === 'load' && (
        <div className="start-menu wide" data-testid="start-load-panel">
          <h3>{t('start.load')}</h3>
          {(slots ?? []).map((s) => (
            <div key={s.slot} className="start-slot" data-testid={`slot-${s.slot}`}>
              <div>
                <b>{t(`start.slot.${s.slot}`)}</b>
                {s.meta ? <div className="small">{s.meta.teamName} · {s.meta.manager} · {s.meta.date} <span className="muted">({t('start.load.saved', { at: s.meta.savedAt.slice(0, 16).replace('T', ' ') })})</span></div>
                  : <div className="small muted">{t('start.load.empty')}</div>}
              </div>
              {s.meta && <button className="md-run" onClick={() => void open(s.slot)} data-testid={`slot-load-${s.slot}`}>{t('start.load.open')}</button>}
              {s.meta && <button className="ord-cancel" onClick={() => void remove(s.slot)} data-testid={`slot-delete-${s.slot}`}>{t('start.load.delete')}</button>}
            </div>
          ))}
          <button className="ord-cancel" onClick={() => setPanel('main')} data-testid="start-back">{t('start.back')}</button>
        </div>
      )}

      {panel === 'settings' && (
        <div className="start-menu wide" data-testid="start-settings-panel">
          <h3>{t('start.settings')}</h3>
          <div className="start-setting">
            <b>{t('about.lang')}</b>
            <div className="md-modetoggle">
              <button className={lang === 'ko' ? 'on' : ''} onClick={() => setLang('ko')} data-testid="lang-ko">{t('about.langKo')}</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} data-testid="lang-en">{t('about.langEn')}</button>
            </div>
          </div>
          <div className="start-setting">
            <b>{t('start.sim')}</b>
            <div className="md-modetoggle">
              <button className={cs.simMode === 'engine' ? 'on' : ''} onClick={() => setSimMode('engine')} disabled={runtime !== 'electron'} data-testid="sim-engine">{t('start.sim.engine')}</button>
              <button className={cs.simMode === 'quick' ? 'on' : ''} onClick={() => setSimMode('quick')} data-testid="sim-quick">{t('start.sim.quick')}</button>
            </div>
            <span className="small muted">{t('start.sim.hint')}</span>
          </div>
          <button className="ord-cancel" onClick={() => setPanel('main')} data-testid="start-back">{t('start.back')}</button>
        </div>
      )}
      <div className="start-foot small muted">{runtime === 'electron' ? t('app.electron') : t('app.browser')}</div>
    </div>
  );
}
