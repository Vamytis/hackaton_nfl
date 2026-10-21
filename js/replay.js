/* DEV 3 — Moteur Canvas, lecture, interactions terrain et démarrage. */
(() => {
'use strict';
const App = window.PassProLab;
if (!App?.core || !App?.dashboard) throw new Error('Charger data.js puis dashboard.js avant replay.js.');
const { $, esc, num, n0, flag, normId, pct, f1, gv, colIndex, toast, wilson, ord, shortName, download, DB, S, pname, COL, splitLine, streamCSV, identify, setProg, loadGames, loadPlayers, loadPlays, loadPff, relink, leagueRates, handleFiles, renderStatus, teamPlays, teamRows, gamesOf, initSelectors, fillGames, agg, groupKey, topPos, rateCell, ensureTracking } = App.core;
const { tags, setupNoteForm, renderAll, renderNotes } = App.dashboard;
/* ============ Étape 5 : rejeu ============ */
const ROLE = { 'Pass Block': { c: '#3b82f6', l: 'Bloqueurs', z: 4 }, 'Pass': { c: '#f59e0b', l: 'QB', z: 5 }, 'Pass Rush': { c: '#ef4444', l: 'Rusheurs', z: 3 }, 'Pass Route': { c: '#a3e635', l: 'Receveurs', z: 1 }, 'Coverage': { c: '#94a3b8', l: 'Couverture', z: 0 }, 'Autre': { c: '#cbd5e1', l: 'Autres', z: 0 } };
const EV = { ball_snap: 'Snap', autoevent_ballsnap: 'Snap', pass_forward: 'Passe', autoevent_passforward: 'Passe', qb_sack: 'Sack', qb_strip_sack: 'Sack+fumble', pass_arrived: 'Arrivée', pass_outcome_caught: 'Capté', pass_outcome_incomplete: 'Incomplet', pass_outcome_interception: 'Interception', pass_outcome_touchdown: 'TD', fumble: 'Fumble', handoff: 'Remise', run: 'Course', tackle: 'Plaqué', touchdown: 'TD', out_of_bounds: 'Sortie', first_contact: '1er contact', line_set: 'Alignés', man_in_motion: 'Motion', play_action: 'Play-action', shift: 'Shift', qb_slide: 'QB slide', pass_tipped: 'Déviée', qb_spike: 'Spike', penalty_flag: 'Flag', pass_shovel: 'Shovel', lateral: 'Latéral' };
const R = { tp: null, play: null, fi: 0, t: 0, snapIdx: 0, playing: false, speed: 1, raf: 0, last: 0, acc: 0, selPid: null, view: null, scale: 20, los: 60, yc: 26.67, press: null,
  opts: { mode: 'pocket', trails: true, full: false, assign: true, dist: true, vec: false, labels: 'num', roles: { 'Pass Block': true, 'Pass': true, 'Pass Rush': true, 'Pass Route': true, 'Coverage': true, 'Autre': true } } };

function showReplayMsg(m) { const el = $('#replayMsg'); el.hidden = !m; el.textContent = m || ''; $('#stageWrap').style.display = m && !R.tp ? 'none' : ''; }

async function openPlay(key) {
  const play = DB.plays.get(key); if (!play) return;
  S.selPlayKey = key; stopPlayback(); R.tp = null;
  document.querySelectorAll('#probTable tbody tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.key === key));
  $('#replayEmpty').hidden = true; $('#replayBody').hidden = false;
  renderPlayMeta(play); setupNoteForm(play);
  $('#s5').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!DB.trackFiles.length) { showReplayMsg('Aucun fichier de tracking chargé : ajoutez week' + (DB.games.get(play.g)?.week ?? 'N') + '.csv (bouton « Charger les CSV ») pour rejouer l\'action.'); return; }
  showReplayMsg('Lecture du tracking du match… (quelques secondes)');
  try {
    const trk = await ensureTracking(play.g);
    if (S.selPlayKey !== key) return;
    const tp = trk.get(play.p);
    if (!tp) { showReplayMsg('Aucune donnée de tracking pour cette action dans les fichiers chargés.'); return; }
    prepareReplay(play, tp); showReplayMsg('');
    layoutCanvas();
  } catch (e) { console.error(e); showReplayMsg('Erreur de lecture du tracking : ' + e.message); }
}
function prepareReplay(play, tp) {
  const rows = DB.pffByPlay.get(play.key) || [], byId = new Map(rows.map(r => [r.id, r]));
  for (const pl of tp.players.values()) {
    const r = byId.get(pl.id); pl.row = r || null; pl.role = r?.role && ROLE[r.role] ? r.role : 'Autre';
    pl.pos = r?.pos || DB.players.get(pl.id)?.pos || ''; if (!pl.name) pl.name = pname(pl.id);
  }
  R.tp = tp; R.play = play; R.snapIdx = Math.max(0, tp.fr.indexOf(tp.snapF)); R.fi = R.snapIdx; R.t = 0; R.acc = 0; R.selPid = null;
  const snapF = tp.fr[R.snapIdx], ball = tp.ball?.map.get(snapF);
  R.los = ball ? ball.x : (play.abs != null ? (tp.flip ? 120 - play.abs : play.abs) : 60);
  const ys = [...tp.players.values()].filter(p => p.role === 'Pass Block').map(p => p.map.get(snapF)?.y).filter(v => v != null);
  R.yc = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 26.67;
  analyzePressure();
  const sl = $('#slider'); sl.max = tp.fr.length - 1; sl.value = R.fi;
  buildEvStrip(); renderRoster(); renderLegend(); updateReadout();
}
function qbOf() { const ps = [...R.tp.players.values()]; return ps.find(p => p.role === 'Pass') || ps.find(p => p.pos === 'QB' && p.side && p.row); }
function rushersOf() { return [...R.tp.players.values()].filter(p => p.role === 'Pass Rush'); }
function analyzePressure() {
  const tp = R.tp, qb = qbOf(), rs = rushersOf(); R.press = null; if (!qb) return;
  const endEv = new Set(['pass_forward', 'autoevent_passforward', 'qb_sack', 'qb_strip_sack', 'handoff', 'run', 'fumble', 'qb_spike', 'pass_shovel']);
  let endIdx = tp.fr.length - 1; for (let i = R.snapIdx; i < tp.fr.length; i++) { if (endEv.has(tp.ev.get(tp.fr[i]))) { endIdx = i; break; } }
  let first = null, min = { d: 99, i: 0 };
  for (let i = R.snapIdx; i <= endIdx; i++) {
    const q = qb.map.get(tp.fr[i]); if (!q) continue;
    for (const r of rs) { const p = r.map.get(tp.fr[i]); if (!p) continue; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < min.d) min = { d, i }; if (first === null && d <= 2) first = i; }
  }
  R.press = { first: first === null ? null : (tp.fr[first] - tp.fr[R.snapIdx]) / 10, min: min.d < 99 ? min.d : null, minT: (tp.fr[min.i] - tp.fr[R.snapIdx]) / 10, endT: (tp.fr[endIdx] - tp.fr[R.snapIdx]) / 10 };
}
function renderPlayMeta(p) {
  const g = DB.games.get(p.g), chips = [`${g ? 'S' + g.week + ' · ' : ''}${esc(p.off)} vs ${esc(p.def)}`, `Q${p.quarter} ${esc(p.clock?.slice(0, 5))}`, `${ord(p.down)} & ${p.ytg ?? '?'}`, `Formation : ${gv(p.offenseFormation)}`, `Personnel : ${gv(p.personnelO)}`, `Couverture : ${gv(p.pff_passCoverage)}`, `Dropback : ${gv(p.dropBackType)}`, `Résultat : ${gv(p.passResult)} · ${p.playResult ?? '?'} yds`];
  $('#playMeta').innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join('');
  $('#playDesc').textContent = p.desc || '';
}
function layoutCanvas() {
  if (!R.tp) return;
  const m = R.opts.mode, los = R.los; let x0, x1, y0 = 0, y1 = 53.33;
  if (m === 'full') { x0 = 0; x1 = 120; } else if (m === 'action') { x0 = los - 14; x1 = los + 30; } else { x0 = los - 13; x1 = los + 9; y0 = R.yc - 14; y1 = R.yc + 14; }
  let w = x1 - x0; if (x0 < 0) { x0 = 0; x1 = w; } if (x1 > 120) { x1 = 120; x0 = 120 - w; }
  let h = y1 - y0; if (y0 < 0) { y0 = 0; y1 = h; } if (y1 > 53.33) { y1 = 53.33; y0 = 53.33 - h; }
  R.view = { x0, x1, y0, y1 };
  const cv = $('#cv'), wrap = $('.cwrap'), avail = Math.max(300, wrap.clientWidth), vw = x1 - x0, vh = y1 - y0, maxH = Math.min(660, window.innerHeight * 0.78);
  const sc = Math.min(avail / vw, maxH / vh), dpr = window.devicePixelRatio || 1;
  cv.style.width = vw * sc + 'px'; cv.style.height = vh * sc + 'px'; cv.width = Math.round(vw * sc * dpr); cv.height = Math.round(vh * sc * dpr); R.scale = sc; draw();
}
function posAt(p) {
  const fr = R.tp.fr, a = p.map.get(fr[R.fi]); if (!a) return null;
  if (R.t > 0 && R.fi < fr.length - 1) { const b = p.map.get(fr[R.fi + 1]); if (b) return { x: a.x + (b.x - a.x) * R.t, y: a.y + (b.y - a.y) * R.t, s: a.s, a: a.a, o: a.o, dir: a.dir }; }
  return a;
}
function drawField(ctx, X, Y, v, sc) {
  const W = (v.x1 - v.x0) * sc, H = (v.y1 - v.y0) * sc;
  ctx.fillStyle = '#1d6a3a'; ctx.fillRect(0, 0, W, H);
  for (let x = 10; x < 110; x += 5) if (((x - 10) / 5) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(X(x), 0, 5 * sc, H); }
  ctx.fillStyle = 'rgba(8,20,40,.55)'; ctx.fillRect(X(0), 0, 10 * sc, H); ctx.fillRect(X(110), 0, 10 * sc, H);
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  for (let x = 10; x <= 110; x += 5) { if (x < v.x0 - 1 || x > v.x1 + 1) continue; ctx.lineWidth = x % 10 === 0 ? 1.6 : .8; ctx.beginPath(); ctx.moveTo(X(x), 0); ctx.lineTo(X(x), H); ctx.stroke(); }
  ctx.lineWidth = .8;
  for (let x = Math.max(10, Math.ceil(v.x0)); x <= Math.min(110, v.x1); x++) for (const yy of [0, 23.58, 29.75, 52.73]) { ctx.beginPath(); ctx.moveTo(X(x), Y(yy + .6)); ctx.lineTo(X(x), Y(yy)); ctx.stroke(); }
  ctx.lineWidth = 2.2; for (const yy of [0, 53.33]) { ctx.beginPath(); ctx.moveTo(0, Y(yy)); ctx.lineTo(W, Y(yy)); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = `bold ${Math.max(11, 1.8 * sc)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let x = 20; x <= 100; x += 10) { if (x < v.x0 || x > v.x1) continue; const t = x <= 60 ? x - 10 : 110 - x; for (const yy of [9, 44.3]) if (yy > v.y0 && yy < v.y1) ctx.fillText(String(t), X(x), Y(yy)); }
}
function draw() {
  if (!R.tp || !R.view) return;
  const cv = $('#cv'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1, v = R.view, sc = R.scale, tp = R.tp, play = R.play;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = x => (x - v.x0) * sc, Y = y => (v.y1 - y) * sc;
  drawField(ctx, X, Y, v, sc);
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#60a5fa'; ctx.beginPath(); ctx.moveTo(X(R.los), 0); ctx.lineTo(X(R.los), (v.y1 - v.y0) * sc); ctx.stroke();
  if (play.ytg != null) { ctx.strokeStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(X(R.los + play.ytg), 0); ctx.lineTo(X(R.los + play.ytg), (v.y1 - v.y0) * sc); ctx.stroke(); }
  const vis = [...tp.players.values()].filter(p => R.opts.roles[p.role] !== false).sort((a, b) => ROLE[a.role].z - ROLE[b.role].z);
  const cur = new Map(); for (const p of vis) { const q = posAt(p); if (q) cur.set(p.id, q); }
  // trajectoires
  const from = R.fi < R.snapIdx ? 0 : R.snapIdx;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of vis) {
    const col = ROLE[p.role].c, sel = R.selPid === p.id;
    if (R.opts.full || sel) { ctx.beginPath(); let st = false; for (const f of tp.fr) { const q = p.map.get(f); if (!q) continue; if (!st) { ctx.moveTo(X(q.x), Y(q.y)); st = true; } else ctx.lineTo(X(q.x), Y(q.y)); } ctx.strokeStyle = col; ctx.globalAlpha = .22; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    if (R.opts.trails || sel) {
      ctx.beginPath(); let st = false;
      for (let i = from; i <= R.fi; i++) { const q = p.map.get(tp.fr[i]); if (!q) continue; if (!st) { ctx.moveTo(X(q.x), Y(q.y)); st = true; } else ctx.lineTo(X(q.x), Y(q.y)); }
      const c = cur.get(p.id); if (c && st) ctx.lineTo(X(c.x), Y(c.y));
      ctx.strokeStyle = col; ctx.globalAlpha = sel ? 1 : (p.role === 'Coverage' || p.role === 'Pass Route' ? .35 : .65); ctx.lineWidth = sel ? 4 : 2.4; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // duels de blocage
  if (R.opts.assign) for (const p of vis) {
    const r = p.row; if (!r || r.role !== 'Pass Block' || !r.blocked) continue;
    const a = cur.get(p.id), d = tp.players.get(r.blocked), b = d && posAt(d); if (!a || !b) continue;
    ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.strokeStyle = (r.beaten || r.press) ? '#f87171' : '#34d399'; ctx.stroke(); ctx.setLineDash([]);
  }
  // distance QB-rusher
  const qb = qbOf();
  if (R.opts.dist && qb) { const q = posAt(qb); let best = null; for (const r of rushersOf()) { const p = posAt(r); if (!p || !q) continue; const d = Math.hypot(p.x - q.x, p.y - q.y); if (!best || d < best.d) best = { d, p }; }
    if (best && q) { ctx.beginPath(); ctx.moveTo(X(q.x), Y(q.y)); ctx.lineTo(X(best.p.x), Y(best.p.y)); ctx.setLineDash([2, 3]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      const mx = (q.x + best.p.x) / 2, my = (q.y + best.p.y) / 2; ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(f1(best.d) + ' yd', X(mx) + 6, Y(my) - 2); } }
  // joueurs
  const rad = Math.max(8, .8 * sc);
  for (const p of vis) {
    const q = cur.get(p.id); if (!q) continue; const cx = X(q.x), cy = Y(q.y), col = ROLE[p.role].c, r = p.row;
    if (R.opts.vec && q.dir != null && q.s > .3) { const L = q.s * .5, a = q.dir * Math.PI / 180; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(q.x + Math.sin(a) * L), Y(q.y + Math.cos(a) * L)); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    const faded = p.role === 'Coverage' || p.role === 'Pass Route';
    ctx.globalAlpha = faded ? .6 : 1;
    if (r && r.role === 'Pass Block' && (r.sackA || r.hitA || r.hurryA)) { ctx.beginPath(); ctx.arc(cx, cy, rad + 5, 0, 7); ctx.lineWidth = 3.5; ctx.strokeStyle = r.sackA ? '#ff2d55' : r.hitA ? '#fb923c' : '#fde047'; ctx.stroke(); }
    if (r && r.role === 'Pass Rush' && (r.sack || r.hit || r.hurry)) { ctx.lineWidth = 3; ctx.strokeStyle = r.sack ? '#ff2d55' : r.hit ? '#fb923c' : '#fde047'; ctx.strokeRect(cx - rad - 4, cy - rad - 4, 2 * rad + 8, 2 * rad + 8); }
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = R.selPid === p.id ? 3 : 1.5; ctx.strokeStyle = R.selPid === p.id ? '#fff' : 'rgba(0,0,0,.6)'; ctx.stroke();
    ctx.fillStyle = (p.role === 'Pass Route' || p.role === 'Pass') ? '#111' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lab = R.opts.labels === 'pos' ? p.pos : p.jersey; ctx.font = `bold ${Math.round(rad * (lab && lab.length > 2 ? .72 : 1))}px system-ui`; ctx.fillText(lab || '', cx, cy + 1);
    if (R.opts.labels === 'name') { ctx.font = '11px system-ui'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3; ctx.strokeText(shortName(p.name), cx, cy + rad + 10); ctx.fillText(shortName(p.name), cx, cy + rad + 10); }
    ctx.globalAlpha = 1;
    if (r && r.role === 'Pass Block' && (r.sackA || r.hitA || r.hurryA)) { const txt = r.sackA ? 'SACK' : r.hitA ? 'HIT' : 'HURRY'; ctx.font = 'bold 10px system-ui'; const w = ctx.measureText(txt).width + 8; ctx.fillStyle = r.sackA ? '#ff2d55' : r.hitA ? '#fb923c' : '#fde047'; ctx.fillRect(cx - w / 2, cy - rad - 22, w, 14); ctx.fillStyle = r.sackA ? '#fff' : '#111'; ctx.textBaseline = 'middle'; ctx.fillText(txt, cx, cy - rad - 15); }
  }
  // ballon
  if (tp.ball) { const b = posAt(tp.ball); if (b) { ctx.save(); ctx.translate(X(b.x), Y(b.y)); ctx.beginPath(); ctx.ellipse(0, 0, 7, 4.5, 0, 0, 7); ctx.fillStyle = '#8b4513'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); } }
}
function evLabel(e) { return EV[e] || e; }
function updateReadout() {
  const tp = R.tp; if (!tp) return;
  const f = tp.fr[R.fi], t = (f - tp.fr[R.snapIdx]) / 10, ev = tp.ev.get(f);
  let s = `Image ${R.fi + 1}/${tp.fr.length} · ${t >= 0 ? '+' : '−'}${f1(Math.abs(t))} s vs snap${ev ? ' · <b>' + esc(evLabel(ev)) + '</b>' : ''}`;
  if (R.press) { const p = R.press; s += `<br>Indicatif — premier rusher à ≤ 2 yd du QB : ${p.first === null ? 'jamais avant la fin de la poche' : '+' + f1(p.first) + ' s'} · distance minimale QB–rusher : ${p.min === null ? '–' : f1(p.min) + ' yd à +' + f1(p.minT) + ' s'} · fin de poche : +${f1(p.endT)} s`; }
  $('#readout').innerHTML = s; $('#slider').value = R.fi;
  $('#btnPlay').textContent = R.playing ? '⏸ Pause' : '▶ Lecture';
}
function buildEvStrip() {
  const tp = R.tp, n = tp.fr.length - 1 || 1; $('#evStrip').innerHTML = [...tp.ev.entries()].map(([f, e]) => { const i = tp.fr.indexOf(f); return `<button style="left:${i / n * 100}%" data-i="${i}" title="${esc(e)}">${esc(evLabel(e))}</button>`; }).join('');
  $('#evStrip').querySelectorAll('button').forEach(b => b.onclick = () => { stopPlayback(); R.fi = +b.dataset.i; R.t = 0; draw(); updateReadout(); });
}
function renderLegend() {
  $('#roleLegend').innerHTML = Object.entries(ROLE).map(([k, v]) => `<label><input type="checkbox" data-role="${k}" ${R.opts.roles[k] !== false ? 'checked' : ''}><i style="background:${v.c}"></i>${v.l}</label>`).join('');
  $('#roleLegend').querySelectorAll('input').forEach(i => i.onchange = () => { R.opts.roles[i.dataset.role] = i.checked; draw(); });
}
function renderRoster() {
  const key = [...R.tp.players.values()].filter(p => p.row && ['Pass Block', 'Pass Rush', 'Pass'].includes(p.role)).sort((a, b) => ROLE[b.role].z - ROLE[a.role].z);
  const rows = key.map(p => { const r = p.row, bad = r.sackA || r.hitA || r.hurryA, ru = r.sack || r.hit || r.hurry;
    return `<tr class="click ${R.selPid === p.id ? 'sel' : ''}" data-pid="${p.id}"><td><i class="dot" style="background:${ROLE[p.role].c}"></i>${esc(p.pos)} #${esc(p.jersey)}</td><td>${esc(shortName(p.name))}</td><td>${bad ? tags(r) : ru ? '<span class="n">rusher ✔</span>' : r.beaten ? '<span class="tag t-beat">BATTU</span>' : ''}</td></tr>`; }).join('');
  $('#roster').innerHTML = `<div class="scroll" style="max-height:280px"><table class="tbl"><tbody>${rows}</tbody></table></div>`;
  $('#roster').querySelectorAll('tr').forEach(tr => tr.onclick = () => { R.selPid = R.selPid === tr.dataset.pid ? null : tr.dataset.pid; renderRoster(); draw(); });
}
function stopPlayback() { R.playing = false; cancelAnimationFrame(R.raf); if (R.tp) updateReadout(); }
function startPlayback() {
  if (!R.tp) return; if (R.fi >= R.tp.fr.length - 1) { R.fi = R.snapIdx; R.t = 0; }
  R.playing = true; R.last = performance.now(); R.acc = R.t * 100;
  const tick = now => {
    if (!R.playing) return; R.acc += (now - R.last) * R.speed; R.last = now;
    while (R.acc >= 100) { R.acc -= 100; R.fi++; if (R.fi >= R.tp.fr.length - 1) { R.fi = R.tp.fr.length - 1; R.acc = 0; R.playing = false; break; } }
    R.t = R.playing ? R.acc / 100 : 0; draw(); updateReadout(); if (R.playing) R.raf = requestAnimationFrame(tick);
  };
  R.raf = requestAnimationFrame(tick);
}
const step = d => { if (!R.tp) return; stopPlayback(); R.fi = Math.max(0, Math.min(R.tp.fr.length - 1, R.fi + d)); R.t = 0; draw(); updateReadout(); };
$('#btnPlay').onclick = () => R.playing ? stopPlayback() : startPlayback();
$('#btnPrev').onclick = () => step(-1); $('#btnNext').onclick = () => step(1);
$('#btnSnap').onclick = () => { if (!R.tp) return; stopPlayback(); R.fi = R.snapIdx; R.t = 0; draw(); updateReadout(); };
$('#btnEnd').onclick = () => { if (!R.tp) return; stopPlayback(); R.fi = R.tp.fr.length - 1; R.t = 0; draw(); updateReadout(); };
$('#slider').oninput = e => { stopPlayback(); R.fi = +e.target.value; R.t = 0; draw(); updateReadout(); };
$('#selSpeed').onchange = e => R.speed = +e.target.value;
$('#selView').onchange = e => { R.opts.mode = e.target.value; layoutCanvas(); };
$('#selLabels').onchange = e => { R.opts.labels = e.target.value; draw(); };
for (const [id, k] of [['#chkTrails', 'trails'], ['#chkFull', 'full'], ['#chkAssign', 'assign'], ['#chkDist', 'dist'], ['#chkVec', 'vec']]) $(id).onchange = e => { R.opts[k] = e.target.checked; draw(); };
window.addEventListener('resize', () => { if (R.tp) layoutCanvas(); });
document.addEventListener('keydown', e => {
  if (!R.tp || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); R.playing ? stopPlayback() : startPlayback(); } else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
});
function pick(e) {
  const cv = $('#cv'), rc = cv.getBoundingClientRect(), v = R.view; if (!R.tp || !v) return null;
  const mx = (e.clientX - rc.left) / R.scale + v.x0, my = v.y1 - (e.clientY - rc.top) / R.scale; let best = null;
  for (const p of R.tp.players.values()) { if (R.opts.roles[p.role] === false) continue; const q = posAt(p); if (!q) continue; const d = Math.hypot(q.x - mx, q.y - my); if (d < 1.4 && (!best || d < best.d)) best = { d, p, q }; }
  return best;
}
$('#cv').addEventListener('mousemove', e => {
  const b = pick(e), tip = $('#tip'); if (!b) { tip.hidden = true; return; }
  const r = b.p.row, ev = r ? [r.sackA ? 'sack concédé' : '', r.hitA ? 'hit concédé' : '', r.hurryA ? 'hurry concédé' : '', r.beaten ? 'battu' : '', r.sack ? 'sack réalisé' : '', r.hit ? 'hit réalisé' : '', r.hurry ? 'hurry réalisé' : ''].filter(Boolean).join(', ') : '';
  tip.innerHTML = `<b>${esc(b.p.name)}</b> #${esc(b.p.jersey)}<br>${ROLE[b.p.role].l}${b.p.pos ? ' · ' + esc(b.p.pos) : ''}<br>${f1(b.q.s)} yd/s · acc. ${f1(b.q.a)}${ev ? '<br><b>' + esc(ev) + '</b>' : ''}`;
  const rc = $('.cwrap').getBoundingClientRect(); tip.style.left = Math.min(e.clientX - rc.left + 14, rc.width - 190) + 'px'; tip.style.top = (e.clientY - rc.top + 14) + 'px'; tip.hidden = false;
});
$('#cv').addEventListener('mouseleave', () => $('#tip').hidden = true);
$('#cv').addEventListener('click', e => { const b = pick(e); R.selPid = b ? (R.selPid === b.p.id ? null : b.p.id) : null; renderRoster(); draw(); });


App.replay = { openPlay, prepareReplay, startPlayback, stopPlayback, layoutCanvas, R };

/* ============ Démarrage ============ */
$('#files').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
window.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

async function loadDefaultData() {
  const status = $('#loadStatus');
  status.innerHTML = '<span class="chip">Chargement automatique des données du dossier data/…</span>';
  // Les chemins sont relatifs à index.html : data doit être à la racine du projet.
  const defaults = [
    ['games.csv', 'games'],
    ['players.csv', 'players'],
    ['plays.csv', 'plays'],
    ['pffScoutingData.csv', 'pff']
  ];
  const found = [];
  for (const [name] of defaults) {
    try {
      const response = await fetch('data/' + name);
      if (response.ok) found.push(new File([await response.blob()], name, { type: 'text/csv' }));
    } catch (e) { /* Le navigateur peut bloquer fetch si index.html est ouvert en file:// */ }
  }
  if (found.length) {
    await handleFiles(found);
    // Références paresseuses : aucun gros CSV de tracking n'est chargé avant un rejeu.
    DB.trackFiles = Array.from({ length: 18 }, (_, i) => ({ name: `week${i + 1}.csv`, size: 0, url: `data/tracking/week${i + 1}.csv` }));
    DB.counts.tracking = DB.trackFiles.length;
    renderStatus();
    toast('Données par défaut chargées depuis data/');
  } else {
    renderStatus();
    status.insertAdjacentHTML('beforeend', '<p class="hint">Chargement automatique impossible. Vérifiez que les fichiers CSV sont dans <code>data/</code> et lancez le projet avec un serveur local (pas en ouvrant directement index.html). Vous pouvez toujours importer les CSV avec le bouton ci-dessus.</p>');
  }
}

renderStatus(); renderNotes();
loadDefaultData();

})();