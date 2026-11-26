// First-career guided tour (backlog #9): a short, skippable step-by-step overlay that explains the
// manager loop and where each job lives. It appears once, on the first career Home, and is
// remembered in localStorage so it never nags again (and can be replayed from Settings/help later).
// Steps are i18n (tutorial.<id>.title / .body) and name the screens rather than anchoring to DOM
// nodes, so it stays robust as screens change.
import { useState } from 'react';
import { useT } from '../i18n/index.tsx';
import './help.css';

const STEPS = ['welcome', 'continue', 'inbox', 'squad', 'scouting', 'media', 'board', 'done'] as const;
export type TutorialStep = typeof STEPS[number];

const DONE_KEY = 'pv-tutorial-done';

export function tutorialSeen(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; }
}
export function markTutorialSeen(): void {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* no storage */ }
}
/** Replay the tour (help menu / settings). */
export function resetTutorial(): void {
  try { localStorage.removeItem(DONE_KEY); } catch { /* no storage */ }
}

export function Tutorial({ onClose, goto }: { onClose: () => void; goto?: (route: string) => void }) {
  const t = useT();
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const close = () => { markTutorialSeen(); onClose(); };
  // Steps that name a screen jump there as the manager reads about it.
  const ROUTE: Partial<Record<TutorialStep, string>> = { inbox: 'inbox', squad: 'squad', scouting: 'scouting', media: 'media', board: 'board' };

  return (
    <div className="tut-scrim" data-testid="tutorial" role="dialog" aria-modal="true">
      <div className="tut-card">
        <div className="tut-steps">{STEPS.map((s, k) => <span key={s} className={k === i ? 'on' : k < i ? 'done' : ''} />)}</div>
        <h3 data-testid="tutorial-title">{t(`tutorial.${step}.title`)}</h3>
        <p className="tut-body">{t(`tutorial.${step}.body`)}</p>
        <div className="tut-actions">
          <button className="ord-cancel" onClick={close} data-testid="tutorial-skip">{t('tutorial.skip')}</button>
          <span className="tut-count">{i + 1} / {STEPS.length}</span>
          {i > 0 && <button className="ord-cancel" onClick={() => setI(i - 1)} data-testid="tutorial-prev">{t('tutorial.prev')}</button>}
          {last ? (
            <button className="md-run" onClick={close} data-testid="tutorial-done">{t('tutorial.finish')}</button>
          ) : (
            <button className="md-run" data-testid="tutorial-next" onClick={() => { const next = STEPS[i + 1]!; const r = ROUTE[next]; if (r) goto?.(r); setI(i + 1); }}>{t('tutorial.next')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
