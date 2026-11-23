// Inbox: world events as messages (results, the board, staff and scouting reports, competition
// news, and whatever club-operation modules post). Items with options wait for an answer.
import { useState } from 'react';
import { useLang } from '../../i18n/index.tsx';
import { answer, readItem, useCareer } from '../../career/session.ts';
import { inboxText, optionLabel } from '../../career/view.ts';
import type { InboxItem } from '../../career/world.ts';

export function InboxScreen() {
  const { t, lang } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const items = [...c.inbox].reverse();
  const waiting = items.find((m) => m.options?.length && m.answer === undefined);
  const [sel, setSel] = useState<string | null>(waiting?.id ?? items[0]?.id ?? null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const cur: InboxItem | undefined = c.inbox.find((m) => m.id === sel);
  const shown = filter === 'unread' ? items.filter((m) => !m.read) : items;
  const pick = (m: InboxItem) => { setSel(m.id); if (!m.read && !m.options?.length) readItem(m.id); };

  return (
    <div className="inbox" data-testid="inbox">
      <div className="inbox-list">
        <div className="md-modetoggle inbox-filter">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('inbox.all')}</button>
          <button className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>{t('inbox.unread', { n: items.filter((m) => !m.read).length })}</button>
        </div>
        {shown.map((m) => {
          const tx = inboxText(t, lang, m);
          const needs = m.options?.length && m.answer === undefined;
          return (
            <button key={m.id} className={`inbox-row ${m.id === sel ? 'on' : ''} ${m.read ? '' : 'unread'}`} onClick={() => pick(m)} data-testid={`inbox-row-${m.key}`}>
              <span className="inbox-from">{t(`inbox.from.${m.from}`)}{needs ? <span className="soon-tag">{t('inbox.needsAnswer')}</span> : null}</span>
              <span className="inbox-title">{tx.title}</span>
              <span className="muted small">{m.date}</span>
            </button>
          );
        })}
      </div>
      <div className="inbox-detail">
        {cur ? (() => {
          const tx = inboxText(t, lang, cur);
          return (
            <div data-testid="inbox-detail">
              <div className="muted small">{cur.date} · {t(`inbox.from.${cur.from}`)} · {t(`inbox.cat.${cur.category}`)}</div>
              <h3>{tx.title}</h3>
              <p className="inbox-body">{tx.body}</p>
              {cur.options && cur.options.length > 0 && (
                <div className="inbox-options">
                  {cur.options.map((o) => (
                    <button key={o.id} className={cur.answer === o.id ? 'md-run' : 'ord-cancel'} disabled={cur.answer !== undefined}
                      onClick={() => answer(cur.id, o.id)} data-testid={`inbox-option-${o.id}`}>
                      {cur.answer === o.id ? '✓ ' : ''}{optionLabel(t, lang, cur, o.id)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })() : <div className="muted">{t('common.selectItem')}</div>}
      </div>
    </div>
  );
}
