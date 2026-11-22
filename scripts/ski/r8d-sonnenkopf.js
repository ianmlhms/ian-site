/* R8d: driver body: Sonnenkopf (Arlberg) reachable like the rest: the valley lift is discovered from the start (map / lift list),
 * a fast travel waits in its boarding zone; returns what the checks need. Load with resort=arlberg. */
const S = window.__ski;
const l = S.modes.lifts.list.find((q) => q.name === 'Sonnenkopfbahn');
if (!l) return { error: 'no Sonnenkopfbahn' };
const ex = S.explore || null;
const out = { id: l.id, kind: l.kind, bottom: [Math.round(l.bottom.x), Math.round(l.bottom.z)] };
out.discovered = ex ? !!ex.liftOpen(l) : 'no explore handle';
out.sonnenkopfPistes = S.pistes ? S.pistes.list.filter((p) => Math.hypot(p.top.x - l.bottom.x, p.top.z - l.bottom.z) < 4000).length : 'n/a';
await S.goFree(l.id);
for (let i = 0; i < 100 && !(S.modes.liftAt && S.modes.liftAt.id === l.id); i++) await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => setTimeout(r, 4000));
out.waitingAt = S.modes.liftAt ? S.modes.liftAt.name : null;
return out;
