// Per-screen help (backlog #9): a small "?" button next to a screen title that reveals a short
// explanation of what the screen is for and how to read it. Text is i18n (help.<topic>.title /
// help.<topic>.body), so it localises with the UI. Dense manager screens are the competition's
// most common complaint; this is the cheap, always-available answer.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.tsx';
import './help.css';

export function Help({ topic }: { topic: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const title = t(`help.${topic}.title`);
  const body = t(`help.${topic}.body`);
  return (
    <span className="help" ref={ref}>
      <button className="help-btn" aria-label={t('help.aria')} data-testid={`help-${topic}`} onClick={() => setOpen((o) => !o)}>?</button>
      {open && (
        <span className="help-pop" role="tooltip" data-testid={`help-pop-${topic}`}>
          <b className="help-title">{title}</b>
          <span className="help-body">{body}</span>
        </span>
      )}
    </span>
  );
}
