import json,sys,glob,statistics as st,collections as C,math
files=sys.argv[1:]
M=[json.loads(l) for f in files for l in open(f)]
R=[r for m in M for r in m['rows']]
def d(xs,fmt="{:.2f}"):
    xs=[x for x in xs if x is not None]
    if not xs: return "n/a"
    q=sorted(xs); p=lambda k:q[min(len(q)-1,int(k*len(q)))]
    return f"n={len(xs)} mean={st.mean(xs):.3f} sd={st.pstdev(xs):.3f} min={q[0]:.3f} p50={p(.5):.3f} p90={p(.9):.3f} max={q[-1]:.3f}"
pr=lambda *a:print(*a)
pr("matches",len(M),"rounds",len(R),"OT",sum(m['ot'] for m in M))
atk=[r['winnerSide']=='attack' for r in R]; pr("attack win",round(sum(atk)/len(R),4))
ci=1.96*math.sqrt(.5*.5/len(R)); pr("95% CI half-width ±",round(ci,3))
for ph in ('pistol','regulation','overtime'):
    rr=[r for r in R if r['phase']==ph]; 
    if rr: pr(" phase",ph,len(rr),round(sum(r['winnerSide']=='attack' for r in rr)/len(rr),3))
pr("reasons",C.Counter(r['reason'] for r in R))
pl=[r for r in R if r['planted']]; pr("plant rate",round(len(pl)/len(R),3),"plant zones",C.Counter(r['plantZone'] for r in pl))
for z in ('a-site','b-site'):
    rr=[r for r in pl if r['plantZone']==z]
    if rr: pr(f" post-plant atk win on {z}",round(sum(r['winnerSide']=='attack' for r in rr)/len(rr),3),len(rr))
for o in ('a-site','b-site',None):
    rr=[r for r in R if r['objective']==o]
    if rr: pr(f" objective {o}: n={len(rr)} share={len(rr)/len(R):.3f} atkwin={sum(r['winnerSide']=='attack' for r in rr)/len(rr):.3f} plant={sum(r['planted'] for r in rr)/len(rr):.3f}")
pr("attack strategies",C.Counter(r['strategy'] for r in R).most_common())
pr("defense strategies",C.Counter(r['defStrategy'] for r in R).most_common())
pr("feint rounds",sum(1 for r in R if r['feint']), "atk revisions/round",d([r['atkRevisions'] for r in R]),"def revisions",d([r['defRevisions'] for r in R]))
rot=[x for r in R for x in r['defRotations'] if x[2]>0]; pr("def rotations w/ count>0",len(rot),"per round",round(len(rot)/len(R),2))
pr("round duration s",d([r['endMs']/1000 for r in R if r['endMs']]))
pr("plant time s",d([r['plantMs']/1000 for r in pl]))
pr("survivors atk",d([r['aliveEnd']['attack'] for r in R]),"\nsurvivors def",d([r['aliveEnd']['defense'] for r in R]))
pr("kills/round",d([r['killsN'] for r in R]))
fk=[r for r in R if r['firstKill']]; pr("first kill by attack",round(sum(r['firstKill']=='attack' for r in fk)/len(fk),3),"; side winning round after first kill",round(sum(r['firstKill']==r['winnerSide'] for r in fk)/len(fk),3))
pr("first kill time s",d([r['firstKillMs']/1000 for r in fk]))
cl=[r for r in R if r['clutch']]; pr("1vX situations",len(cl),"rate",round(len(cl)/len(R),3),"won by clutcher",round(sum(r['clutch']['side']==r['winnerSide'] for r in cl)/len(cl),3))
for v in range(1,6):
    rr=[r for r in cl if r['clutch']['vs']==v]
    if rr: pr(f"  1v{v}: n={len(rr)} win={sum(r['clutch']['side']==r['winnerSide'] for r in rr)/len(rr):.3f}")
# movement
pd=[v for r in R for k,v in r['dist'].items()]; pr("per-player distance/round (uu)",d(pd))
pr("attacker distance/round",d([v for r in R for k,v in r['dist'].items() if k.startswith('atk')]))
pr("defender distance/round",d([v for r in R for k,v in r['dist'].items() if k.startswith('def')]))
rat=[x for r in R for x in r['ratios']]; pr("path/straight ratio (planned, straight>500uu)",d(rat))
pr("ratio >2.0 share",round(sum(x>2 for x in rat)/len(rat),4),"ratio>3",round(sum(x>3 for x in rat)/len(rat),4))
nav=C.Counter(); [nav.update(r['nav']) for r in R]; pr("navTrace totals",dict(nav),"per round",{k:round(v/len(R),3) for k,v in nav.items()})
rr=[r for r in R if r['nav'].get('unreachable')]; pr("rounds with unreachable",len(rr)); rr=[r for r in R if r['nav'].get('blocked')]; pr("rounds with blocked",len(rr))
pr("long idle runs (>=3.5s) per round",d([r['longIdle'] for r in R]))
pr("max idle (s) attackers",d([v/10 for r in R for k,v in r['idleMax'].items() if k.startswith('atk')]))
pr("overlap (<30uu, same floor) tick-share",round(sum(r['overlapTicks'] for r in R)/sum(r['ticks']/2 for r in R),5),"rounds with any overlap",sum(r['overlapTicks']>0 for r in R))
pr("min pair distance per round",d([r['minPair'] for r in R if r['minPair']<1e9]))
k=sum(r['killsN'] for r in R); pr("deaths while moving",round(sum(r['diedMoving'] for r in R)/k,3))
ar=[r for r in R if r['firstArriveTick'] is not None]; pr("rounds where attackers reached target site",len(ar),round(len(ar)/len(R),3))
pr("first attacker on site s",d([r['firstArriveTick']/10 for r in ar]))
for z in ('a-site','b-site'): pr(f"  first on {z} s",d([r['firstArriveTick']/10 for r in ar if (r['plantZone'] or r['objective'])==z]))
pr("last-first arrival spread s",d([(r['lastArriveTick']-r['firstArriveTick'])/10 for r in ar if r['arrivedN']>=3]),"arrivedN dist",C.Counter(r['arrivedN'] for r in ar))
# stereotypy
ds=C.Counter(tuple(r['defZones15']) for r in R if r['defZones15']); tot=sum(ds.values())
H=-sum(v/tot*math.log2(v/tot) for v in ds.values()); pr("defender setups@15s distinct",len(ds),"of",tot,"entropy bits",round(H,2),"top",[(k,v) for k,v in ds.most_common(3)])
az=C.Counter(tuple(r['atkZones30']) for r in R if r['atkZones30']); tot=sum(az.values()); H=-sum(v/tot*math.log2(v/tot) for v in az.values()); pr("attacker layouts@30s distinct",len(az),"of",tot,"entropy",round(H,2),"top",az.most_common(3))
rc=C.Counter(x for r in R for x in r['routes']); pr("distinct attacker zone routes",len(rc),"top",rc.most_common(8))
# teams
tm=C.defaultdict(lambda:[0,0,0]);
for r in R:
    t=tm[r.get('atkTeam','avg')]; t[0]+=1; t[1]+= r['objective']=='a-site'; t[2]+= r['winnerSide']=='attack'
pr("per-team as attacker: n, A-share, atkwin"); [pr(" ",k,v[0],round(v[1]/v[0],2),round(v[2]/v[0],2)) for k,v in sorted(tm.items())]
# seed variance per 20-match block
blocks=C.defaultdict(list)
for m in M: blocks[(m['seed']-1)//20].extend(r['winnerSide']=='attack' for r in m['rows'])
bw=[sum(v)/len(v) for v in blocks.values()]; pr("attack win per 20-match block",[round(x,3) for x in bw],"sd",round(st.pstdev(bw),3))
pm=[sum(r['winnerSide']=='attack' for r in m['rows'])/len(m['rows']) for m in M]; pr("per-match atk win",d(pm))
pr("rounds/match",d([len(m['rows']) for m in M]),"score margin",d([abs(m['score']['A']-m['score']['B']) for m in M]))
pr("ms/match",d([m['ms'] for m in M]),"rss MB max",round(max(m['rss'] for m in M)/1e6))
pr("ability events",sum(r['abilityEvents'] for r in R))
