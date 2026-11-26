// Media & player interaction (backlog #7): team chemistry, the squad's morale with 1:1 talks
// (praise / criticise / promise), open promises, and the recent media log. Press conferences
// themselves arrive in the Inbox as items with options; this screen is the manager-initiated side.
// Match effect stays behind CLUB_FLAGS.moraleInMatch (default OFF) — this moves TRACKED morale.
import { useState } from 'react';
import { useT } from '../../i18n/index.tsx';
import { useCareer, talkToPlayer, promisePlayer } from '../../career/session.ts';
import { mediaView } from '../../career/media.ts';
import { GenTag } from '../SquadScreen.tsx';
import { Flag } from '../../ui.tsx';
import { Help } from '../../help/Help.tsx';
import type { InteractKind, PromiseKind } from '../../career/world.ts';
import '../club/club.css';

const PROMISE_KINDS: PromiseKind[] = ['playTime', 'winMatch', 'trophy'];

function meterClass(v: number): string {
  return v >= 60 ? 'good' : v <= 35 ? 'over' : '';
}

export function MediaScreen() {
  const t = useT();
  const cs = useCareer();
  const c = cs.career;
  const [flash, setFlash] = useState<string | null>(null);
  const [promiseFor, setPromiseFor] = useState<string | null>(null);
  const [promiseKind, setPromiseKind] = useState<PromiseKind>('playTime');
  if (!c) return <div className="pad">{t('club.noClub')}</div>;
  const v = mediaView(c);

  const talk = (playerId: string, kind: InteractKind, handle: string) => {
    const res = talkToPlayer(playerId, kind);
    if (res && typeof res === 'object') {
      const dir = res.morale > 0 ? '▲' : res.morale < 0 ? '▼' : '–';
      setFlash(t('media.flash.talk', { player: handle, kind: t(`media.interact.${kind}`), dir, n: Math.abs(Math.round(res.morale * 100)) }));
    } else if (res === 'cooldown') setFlash(t('media.flash.cooldown', { player: handle }));
  };
  const makePromise = (playerId: string, handle: string) => {
    const res = promisePlayer(playerId, promiseKind);
    setPromiseFor(null);
    if (res && typeof res === 'object') setFlash(t('media.flash.promised', { player: handle, kind: t(`media.promise.${promiseKind}`) }));
    else if (res === 'alreadyOpen') setFlash(t('media.flash.alreadyPromised', { player: handle }));
  };

  return (
    <div className="pad club" data-testid="media-screen">
      <h2>{t('media.title')} <Help topic="media" /></h2>

      <div className="fin-cards">
        <div className="fin-card" data-testid="media-chemistry" data-value={v.chemistry}>
          <div className="muted small">{t('media.chemistry')}</div>
          <div className="fin-value">{v.chemistry}%</div>
          <div className="wage-bar"><div className={`wage-fill ${meterClass(v.chemistry)}`} style={{ width: `${v.chemistry}%` }} /></div>
          <div className="muted small">{t('media.chemistryHint')}</div>
        </div>
        <div className="fin-card">
          <div className="muted small">{t('media.openPromises')}</div>
          <div className="fin-value">{v.promises.length}</div>
          <div className="muted small">{t('media.promisesHint')}</div>
        </div>
      </div>

      <div className="attr-grouplabel">{t('media.squad')}</div>
      <p className="small muted">{t('media.squadHint')}</p>
      <table className="assign-table" data-testid="media-squad">
        <thead><tr>
          <th>{t('col.handle')}</th><th>{t('col.role')}</th><th>{t('col.morale')}</th><th>{t('media.actions')}</th>
        </tr></thead>
        <tbody>
          {v.squad.map((r) => (
            <tr key={r.player.playerId} data-testid={`media-row-${r.player.playerId}`}>
              <td><b>{r.player.handle}</b> <Flag cc={r.player.country} />{r.player.generated && <GenTag />}</td>
              <td className="muted">{r.player.role ?? '—'}</td>
              <td style={{ minWidth: 90 }}>
                <span className="small" data-testid={`media-morale-${r.player.playerId}`}>{r.morale}%</span>
                <div className="wage-bar" style={{ marginTop: 2 }}><div className={`wage-fill ${meterClass(r.morale)}`} style={{ width: `${r.morale}%` }} /></div>
              </td>
              <td>
                <button className="club-btn" disabled={!r.canTalk} data-testid={`media-praise-${r.player.playerId}`}
                  onClick={() => talk(r.player.playerId, 'praise', r.player.handle ?? r.player.playerId)}>{t('media.interact.praise')}</button>{' '}
                <button className="club-btn" disabled={!r.canTalk} data-testid={`media-criticise-${r.player.playerId}`}
                  onClick={() => talk(r.player.playerId, 'criticise', r.player.handle ?? r.player.playerId)}>{t('media.interact.criticise')}</button>{' '}
                {r.promise ? (
                  <span className="muted small" data-testid={`media-haspromise-${r.player.playerId}`}>· {t('media.promised', { kind: t(`media.promise.${r.promise.kind}`) })}</span>
                ) : promiseFor === r.player.playerId ? (
                  <>
                    <select value={promiseKind} onChange={(e) => setPromiseKind(e.target.value as PromiseKind)} data-testid={`media-promise-kind-${r.player.playerId}`}>
                      {PROMISE_KINDS.map((k) => <option key={k} value={k}>{t(`media.promise.${k}`)}</option>)}
                    </select>{' '}
                    <button className="club-btn" data-testid={`media-promise-confirm-${r.player.playerId}`} onClick={() => makePromise(r.player.playerId, r.player.handle ?? r.player.playerId)}>{t('media.promiseConfirm')}</button>
                  </>
                ) : (
                  <button className="club-btn" data-testid={`media-promise-${r.player.playerId}`} onClick={() => { setPromiseFor(r.player.playerId); setPromiseKind('playTime'); }}>{t('media.promiseBtn')}</button>
                )}
                {!r.canTalk && r.cooldown > 0 && <span className="muted small"> · {t('media.cooldown', { n: r.cooldown })}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {flash && <div className="offer-status st-completed" data-testid="media-flash">{flash}</div>}

      {v.promises.length > 0 && (
        <>
          <div className="attr-grouplabel">{t('media.openPromises')}</div>
          <div className="small" data-testid="media-promises">
            {v.promises.map(({ promise, handle }) => (
              <div key={promise.id} className="muted">{handle} — {t(`media.promise.${promise.kind}`)} · {t('media.promiseDue', { date: promise.due })}</div>
            ))}
          </div>
        </>
      )}

      {v.log.length > 0 && (
        <>
          <div className="attr-grouplabel">{t('media.log')}</div>
          <div className="small" data-testid="media-log">
            {v.log.slice(0, 12).map((e, i) => {
              const who = e.playerId ? c.world.players[e.playerId]?.handle ?? e.playerId : t('media.wholeSquad');
              const dir = e.morale > 0 ? '▲' : e.morale < 0 ? '▼' : '–';
              return <div key={i} className="muted">{e.date} · {t(`media.ev.${e.kind}`)} · {who} {e.morale !== 0 ? `${dir}${Math.abs(Math.round(e.morale * 100))}` : ''}</div>;
            })}
          </div>
        </>
      )}
      <p className="small muted mt">{t('media.note')}</p>
    </div>
  );
}
