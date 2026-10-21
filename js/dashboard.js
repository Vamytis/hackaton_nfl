/* DEV 2 — Bilan, comparaisons, actions à revoir, notes et exports coach. */
(() => {
'use strict';
const App = window.PassProLab;
if (!App?.core) throw new Error('Charger data.js avant dashboard.js.');
const { $, esc, num, n0, flag, normId, pct, f1, gv, colIndex, toast, wilson, ord, shortName, download, DB, S, pname, COL, splitLine, streamCSV, identify, setProg, loadGames, loadPlayers, loadPlays, loadPff, relink, leagueRates, handleFiles, renderStatus, teamPlays, teamRows, gamesOf, initSelectors, fillGames, agg, groupKey, topPos, rateCell, ensureTracking } = App.core;
// Référence tardive : le moteur de rejeu est installé par le troisième script.
const openPlay = (...args) => App.replay.openPlay(...args);
/* ============ Étape 2 : bilan ============ */
function renderKPIs() {
  const rows = teamRows(S.team, S.gameId), plays = teamPlays(S.team, S.gameId), n = rows.length, L = leagueRates();
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const K = { press: sum('press'), sack: sum('sackA'), hit: sum('hitA'), hurry: sum('hurryA'), beaten: sum('beaten') };
  const pPlays = new Set(rows.filter(r => r.press).map(r => r.key)).size;
  const card = (label, k, base, color) => {
    const p = n ? k / n : 0, [lo, hi] = wilson(k, n), d = p - base;
    const cls = lo > base ? 'up' : hi < base ? 'down' : '';
    return `<div class="kpi" style="border-top:3px solid ${color}"><small>${label}</small><div class="big">${pct(p)}</div>
      <div class="sub">${k} sur ${n} actions de blocage</div>
      <div class="sub ${cls}">Ligue ${pct(base)} · ${d >= 0 ? '+' : ''}${f1(d * 100)} pt${cls ? (cls === 'up' ? ' (écart net, défavorable)' : ' (écart net, favorable)') : ''}</div></div>`;
  };
  $('#kpis').innerHTML =
    `<div class="kpi"><small>Passes (dropbacks) · actions de blocage</small><div class="big">${plays.length} · ${n.toLocaleString('fr-FR')}</div><div class="sub">${n && plays.length ? f1(n / plays.length) : '–'} bloqueurs par passe en moyenne</div></div>` +
    card('Pression (sack+hit+hurry)', K.press, L.press, '#ef4444') + card('Sacks concédés', K.sack, L.sack, '#ff2d55') +
    card('Hits concédés', K.hit, L.hit, '#fb923c') + card('Hurries concédés', K.hurry, L.hurry, '#fde047') + card('Bloqueur battu', K.beaten, L.beaten, '#a78bfa') +
    `<div class="kpi"><small>Passes avec au moins une pression</small><div class="big">${plays.length ? pct(pPlays / plays.length) : '–'}</div><div class="sub">${pPlays} sur ${plays.length} passes</div></div>`;
  $('#scopeInfo').textContent = S.gameId === 'ALL' ? `Portée : ${S.team}, ${gamesOf(S.team).length} match(s) chargé(s).` : `Portée : ${S.team}, match sélectionné.`;
  // points d'attention
  const items = [];
  const pl = agg(rows, r => r.id).filter(a => a.n >= S.minSnaps).sort((a, b) => b.press / b.n - a.press / a.n).slice(0, 3);
  for (const a of pl) { if (!a.press) continue; const [lo] = wilson(a.press, a.n); items.push(`<b>${esc(topPos(a))} ${esc(pname(a.key))}</b> : ${pct(a.press / a.n)} de pression (${a.press}/${a.n})${lo > L.press ? ' — écart net vs ligue' : ' — écart non significatif vs ligue'}`); }
  const savedG = S.groupBy; S.groupBy = 'offenseFormation';
  const gr = agg(rows, groupKey2).filter(a => a.plays.size >= S.minPlays).sort((a, b) => b.press / b.n - a.press / a.n)[0];
  S.groupBy = savedG;
  if (gr && gr.press) items.push(`Formation la plus exposée : <b>${esc(gr.key)}</b> — ${pct(gr.press / gr.n)} de pression par action (${gr.press}/${gr.n}, ${gr.plays.size} jeux)`);
  $('#attn').innerHTML = items.length ? items.map(t => `<li>${t}</li>`).join('') : '<li style="border-color:#34d399">Aucun point d\'attention avec l\'effectif minimum actuel.</li>';
}
function groupKey2(r) { return gv(r.play.offenseFormation); }

/* ============ Étape 3 : comparaisons ============ */
function buildEntities() {
  const rows = teamRows(S.team, S.gameId);
  if (S.tab === 'players') return agg(rows, r => r.id).map(a => ({ ...a, label: pname(a.key), sub: topPos(a), low: a.n < S.minSnaps }));
  if (S.tab === 'pos') return agg(rows, r => r.pos || 'Non renseigné').map(a => ({ ...a, label: a.key, sub: '', low: a.n < S.minSnaps }));
  return agg(rows, groupKey).map(a => ({ ...a, label: a.key, sub: '', low: a.plays.size < S.minPlays }));
}
function sortRows(rows, cols, st) {
  const col = cols.find(c => c.k === st.k), f = col?.val || (() => 0);
  return rows.slice().sort((a, b) => {
    if (a.low !== b.low) return a.low ? 1 : -1;
    const x = f(a), y = f(b);
    const c = typeof x === 'string' ? x.localeCompare(y, 'fr') : (x > y) - (x < y);
    return (c * st.d) || (b.n - a.n);
  });
}
function renderCompare() {
  const tab = S.tab, ents = buildEntities();
  const hints = {
    players: 'Un joueur est comparé par son nombre d\'actions de blocage (effectif). Les lignes grisées ont un effectif inférieur au seuil : taux peu fiables, toujours classées en bas.',
    groups: 'Chaque ligne regroupe les actions de blocage des jeux concernés ; l\'effectif est donné en actions et en jeux.',
    pos: 'Postes d\'alignement PFF (LT, LG, C, RG, RT, TE, RB…).' };
  $('#tabHint').textContent = hints[tab]; $('#grpWrap').style.display = tab === 'groups' ? '' : 'none';
  const max = k => Math.max(0.0001, ...ents.filter(e => !e.low).map(e => e[k] / e.n), ...ents.map(e => e[k] / e.n).slice(0, 0));
  const mx = { press: max('press'), sack: max('sack'), hit: max('hit'), hurry: max('hurry'), beaten: max('beaten') };
  const cols = [
    { k: 'chk', label: '', html: r => `<input type="checkbox" data-k="${esc(r.key)}" ${S.sel[tab].has(r.key) ? 'checked' : ''}>` },
    { k: 'label', label: tab === 'players' ? 'Joueur' : tab === 'pos' ? 'Poste' : 'Groupe', sort: 1, val: r => r.label, html: r => `${esc(r.label)} ${r.sub ? `<span class="n">${esc(r.sub)}</span>` : ''}${r.low ? ' <span class="n">(effectif faible)</span>' : ''}` },
    { k: 'n', label: 'Actions (n)', cls: 'num', sort: 1, val: r => r.n, html: r => r.n },
    { k: 'pl', label: 'Jeux', cls: 'num', sort: 1, val: r => r.plays.size, html: r => r.plays.size },
    { k: 'press', label: 'Pression / action', sort: 1, val: r => r.press / r.n, html: r => rateCell(r.press, r.n, mx.press, '#ef4444') },
    { k: 'sack', label: 'Sacks', sort: 1, val: r => r.sack / r.n, html: r => rateCell(r.sack, r.n, mx.sack, '#ff2d55') },
    { k: 'hit', label: 'Hits', sort: 1, val: r => r.hit / r.n, html: r => rateCell(r.hit, r.n, mx.hit, '#fb923c') },
    { k: 'hurry', label: 'Hurries', sort: 1, val: r => r.hurry / r.n, html: r => rateCell(r.hurry, r.n, mx.hurry, '#fde047') },
    { k: 'beaten', label: 'Battu', sort: 1, val: r => r.beaten / r.n, html: r => rateCell(r.beaten, r.n, mx.beaten, '#a78bfa') },
    { k: 'pp', label: 'Jeux sous pression', cls: 'num', sort: 1, val: r => r.pPlays.size / r.plays.size, html: r => `${pct(r.pPlays.size / r.plays.size, 0)} <span class="n">${r.pPlays.size}/${r.plays.size}</span>` }
  ];
  const sorted = sortRows(ents, cols, S.sort[tab]);
  const head = cols.map(c => `<th class="${c.sort ? 'sortable' : ''} ${c.cls || ''}" data-k="${c.k}">${c.label}${S.sort[tab].k === c.k ? (S.sort[tab].d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = sorted.map(r => `<tr class="${r.low ? 'low' : ''} ${S.sel[tab].has(r.key) ? 'sel' : ''}">${cols.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`).join('');
  const el = $('#cmpTable');
  el.innerHTML = `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  el.querySelectorAll('th.sortable').forEach(th => th.onclick = () => { const st = S.sort[tab]; if (st.k === th.dataset.k) st.d *= -1; else { st.k = th.dataset.k; st.d = th.dataset.k === 'label' ? 1 : -1; } renderCompare(); });
  el.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => {
    const set = S.sel[tab];
    if (cb.checked) { if (set.size >= 4) { cb.checked = false; toast('4 éléments maximum à comparer'); return; } set.add(cb.dataset.k); } else set.delete(cb.dataset.k);
    renderCompare();
  });
  renderComparePanel(ents.filter(e => S.sel[tab].has(e.key)));
}
function renderComparePanel(ents) {
  const el = $('#cmpPanel');
  if (!ents.length) { el.innerHTML = '<p class="hint">Cochez 2 à 4 lignes du tableau pour les comparer côte à côte (la ligne pointillée = moyenne de la ligue).</p>'; return; }
  const L = leagueRates();
  const metrics = [['press', 'Pression totale'], ['sack', 'Sacks concédés'], ['hit', 'Hits concédés'], ['hurry', 'Hurries concédés'], ['beaten', 'Battu par le rusher']];
  let h = '<div class="cmp-legend">' + ents.map((e, i) => `<span><i style="background:${COL[i]}"></i>${esc(e.label)} <em>n=${e.n} actions · ${e.plays.size} jeux</em></span>`).join('') + '</div>';
  for (const [mk, ml] of metrics) {
    const base = L[mk], max = Math.max(base, ...ents.map(e => e[mk] / e.n)) * 1.2 || 1;
    h += `<div class="cmp-row"><div class="cmp-lab">${ml}<small>Ligue ${pct(base)}</small></div><div class="cmp-bars">` +
      ents.map((e, i) => { const [lo, hi] = wilson(e[mk], e.n), p = e.n ? e[mk] / e.n : 0;
        return `<div class="cmp-bar" title="IC 95 % : ${pct(lo)} – ${pct(hi)}"><i style="width:${p / max * 100}%;background:${COL[i]};opacity:.85"></i><span>${pct(p)} <em>${e[mk]}/${e.n}</em></span></div>`; }).join('') +
      `<u class="base" style="left:${base / max * 100}%"></u></div></div>`;
  }
  el.innerHTML = h;
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (!b) return; S.tab = b.dataset.tab; document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b)); renderCompare(); });
$('#selGroup').onchange = e => { S.groupBy = e.target.value; S.sel.groups.clear(); renderCompare(); };
$('#minSnaps').onchange = e => { S.minSnaps = Math.max(0, +e.target.value || 0); renderKPIs(); renderCompare(); };
$('#minPlays').onchange = e => { S.minPlays = Math.max(0, +e.target.value || 0); renderKPIs(); renderCompare(); };

/* ============ Étape 4 : actions problématiques ============ */
function buildProblems() {
  const out = [];
  for (const p of teamPlays(S.team, S.gameId)) {
    const rows = DB.pffByPlay.get(p.key) || [];
    const bl = rows.filter(r => r.sackA || r.hitA || r.hurryA), ru = rows.filter(r => r.sack || r.hit || r.hurry), isSack = p.passResult === 'S';
    if (!bl.length && !ru.length && !isSack) continue;
    let sev = bl.reduce((s, r) => s + r.sackA * 3 + r.hitA * 2 + r.hurryA, 0);
    if (!bl.length) sev = ru.reduce((s, r) => s + r.sack * 3 + r.hit * 2 + r.hurry, 0);
    const hasSack = isSack || bl.some(r => r.sackA) || ru.some(r => r.sack), hasHit = bl.some(r => r.hitA) || ru.some(r => r.hit), hasHurry = bl.some(r => r.hurryA) || ru.some(r => r.hurry);
    if (hasSack) sev = Math.max(sev, 3);
    out.push({ key: p.key, p, bl, ru, sev, hasSack, hasHit, hasHurry, low: false, n: sev });
  }
  return out;
}
function tags(r) { return (r.sackA ? '<span class="tag t-sack">SACK</span>' : '') + (r.hitA ? '<span class="tag t-hit">HIT</span>' : '') + (r.hurryA ? '<span class="tag t-hurry">HURRY</span>' : ''); }
function renderProblems() {
  let rows = buildProblems();
  const t = S.probType; if (t !== 'all') rows = rows.filter(r => t === 'sack' ? r.hasSack : t === 'hit' ? r.hasHit : r.hasHurry);
  $('#probCount').textContent = `(${rows.length} action${rows.length > 1 ? 's' : ''})`;
  const cols = [
    { k: 'g', label: 'Match', sort: 1, val: r => (DB.games.get(r.p.g)?.week ?? 0) * 100 + r.p.quarter, html: r => { const g = DB.games.get(r.p.g); return `${g ? 'S' + g.week + ' ' : ''}vs ${esc(r.p.def)}`; } },
    { k: 'q', label: 'Q · Temps', sort: 1, val: r => r.p.quarter * 10000 - (+String(r.p.clock).replace(':', '') || 0), html: r => `Q${r.p.quarter} · ${esc(r.p.clock?.slice(0, 5))}` },
    { k: 'dd', label: 'Situation', sort: 1, val: r => (r.p.down || 0) * 100 + (r.p.ytg || 0), html: r => `${ord(r.p.down)} & ${r.p.ytg ?? '?'}` },
    { k: 'f', label: 'Formation', sort: 1, val: r => r.p.offenseFormation || '', html: r => `${esc(gv(r.p.offenseFormation))} <span class="n">${esc(gv(r.p.personnelO))}</span>` },
    { k: 'c', label: 'Couverture', sort: 1, val: r => r.p.pff_passCoverage || '', html: r => esc(gv(r.p.pff_passCoverage)) },
    { k: 'w', label: 'Coupable(s)', html: r => r.bl.length ? r.bl.map(x => `${tags(x)}${esc(x.pos)} ${esc(shortName(pname(x.id)))}`).join('<br>') : `<span class="n">non attribué (rusher : ${r.ru.map(x => esc(shortName(pname(x.id)))).join(', ') || '—'})</span>` },
    { k: 'sev', label: 'Gravité', cls: 'num', sort: 1, val: r => r.sev, html: r => (r.sev >= 3 ? '●●●' : r.sev === 2 ? '●●○' : '●○○') + ` <span class="n">${r.sev}</span>` },
    { k: 'res', label: 'Résultat', sort: 1, val: r => r.p.playResult ?? 0, html: r => `${esc(gv(r.p.passResult))} · ${r.p.playResult ?? '?'} yds` },
    { k: 'note', label: 'Note', html: r => { const n = S.notes[r.key]; return n ? `<span class="prio${n.prio || 3}">${n.prio ? 'P' + n.prio : '✎'}</span>` : ''; } }
  ];
  const st = S.sort.probs, col = cols.find(c => c.k === st.k), f = col?.val || (() => 0);
  rows.sort((a, b) => { const x = f(a), y = f(b); const c = typeof x === 'string' ? x.localeCompare(y, 'fr') : (x > y) - (x < y); return (c * st.d) || (a.p.quarter - b.p.quarter); });
  const head = cols.map(c => `<th class="${c.sort ? 'sortable' : ''} ${c.cls || ''}" data-k="${c.k}">${c.label}${st.k === c.k ? (st.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = rows.slice(0, 300).map(r => `<tr class="click ${S.selPlayKey === r.key ? 'sel' : ''}" data-key="${r.key}">${cols.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`).join('');
  const el = $('#probTable');
  el.innerHTML = `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + (rows.length === 0 ? '<p class="hint" style="padding:10px">Aucune action problématique pour cette sélection.</p>' : '');
  el.querySelectorAll('th.sortable').forEach(th => th.onclick = () => { if (st.k === th.dataset.k) st.d *= -1; else { st.k = th.dataset.k; st.d = (th.dataset.k === 'g' || th.dataset.k === 'q') ? 1 : -1; } renderProblems(); });
  el.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => openPlay(tr.dataset.key));
}
$('#probType').onchange = e => { S.probType = e.target.value; renderProblems(); };


/* ============ Étape 6 : coach ============ */
const NOTES_KEY = 'passprolab_notes_v1';
try { S.notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch (e) { S.notes = {}; }
const persist = () => { try { localStorage.setItem(NOTES_KEY, JSON.stringify(S.notes)); } catch (e) { toast('Stockage local indisponible : pensez à exporter'); } };
function factsFor(play) {
  const out = [];
  for (const r of DB.pffByPlay.get(play.key) || []) {
    if (r.role !== 'Pass Block') continue;
    const tk = [r.sackA ? 'sack' : '', r.hitA ? 'hit' : '', r.hurryA ? 'hurry' : ''].filter(Boolean);
    if (!tk.length && !r.beaten) continue;
    out.push(`${esc(r.pos)} <b>${esc(pname(r.id))}</b> : ${tk.length ? tk.join(' + ') + ' concédé' : 'battu sans pression'}${tk.length && r.beaten ? ', battu' : ''}${r.blocked ? ' (bloquait ' + esc(pname(r.blocked)) + (r.blockType && r.blockType !== 'NA' ? ', ' + esc(r.blockType) : '') + ')' : ''}`);
  }
  return out;
}
function setupNoteForm(play) {
  $('#noteTarget').innerHTML = `Action sélectionnée : <b>${esc(play.off)} vs ${esc(play.def)}</b> · Q${play.quarter} ${esc(play.clock?.slice(0, 5))} · ${ord(play.down)} & ${play.ytg ?? '?'}`;
  const facts = factsFor(play); $('#facts').innerHTML = facts.length ? facts.map(f => `<li>${f}</li>`).join('') : '<li class="n">Aucun fait de protection attribué à un bloqueur sur cette action.</li>';
  $('#noteForm').hidden = false; $('#noteForm').style.display = 'grid';
  const blockers = (DB.pffByPlay.get(play.key) || []).filter(r => r.role === 'Pass Block');
  $('#notePlayer').innerHTML = '<option value="">Unité complète</option>' + blockers.map(r => `<option value="${r.id}">${esc(r.pos)} · ${esc(pname(r.id))}</option>`).join('');
  const n = S.notes[play.key] || {};
  $('#noteObs').value = n.obs || ''; $('#notePrio').value = n.prio || ''; $('#noteFocus').value = n.focus || ''; $('#notePlayer').value = n.player || ''; $('#noteDrill').value = n.drill || '';
  $('#noteState').textContent = n.ts ? 'Dernier enregistrement : ' + new Date(n.ts).toLocaleString('fr-FR') : '';
}
$('#btnSaveNote').onclick = () => {
  const k = S.selPlayKey; if (!k) return;
  const n = { obs: $('#noteObs').value.trim(), prio: $('#notePrio').value, focus: $('#noteFocus').value, player: $('#notePlayer').value, drill: $('#noteDrill').value.trim(), ts: Date.now() };
  if (!n.obs && !n.prio && !n.focus && !n.drill) { delete S.notes[k]; } else S.notes[k] = n;
  persist(); renderNotes(); renderProblems(); $('#noteState').textContent = 'Enregistré ✔'; toast('Note enregistrée');
};
$('#btnDelNote').onclick = () => { const k = S.selPlayKey; if (!k) return; delete S.notes[k]; persist(); setupNoteForm(DB.plays.get(k)); renderNotes(); renderProblems(); };
function renderNotes() {
  const ents = Object.entries(S.notes).filter(([k]) => true).map(([k, n]) => ({ k, n, p: DB.plays.get(k) }));
  ents.sort((a, b) => (+(a.n.prio || 9)) - (+(b.n.prio || 9)) || b.n.ts - a.n.ts);
  const W = { 1: 3, 2: 2, 3: 1 }, th = {};
  for (const { n } of ents) { const f = n.focus || 'Non précisé'; th[f] = th[f] || { s: 0, c: 0, top: 9 }; th[f].s += W[n.prio] || 0.5; th[f].c++; th[f].top = Math.min(th[f].top, +(n.prio || 9)); }
  const list = Object.entries(th).sort((a, b) => b[1].s - a[1].s), mx = Math.max(1, ...list.map(x => x[1].s));
  $('#trainSummary').innerHTML = list.length ? list.map(([f, v]) => `<div class="sumbar"><span>${esc(f)} <span class="n">${v.c} note${v.c > 1 ? 's' : ''}${v.top < 9 ? ' · max P' + v.top : ''}</span></span><div class="b"><i style="width:${v.s / mx * 100}%"></i></div><b>${f1(v.s)}</b></div>`).join('') : '<p class="hint">Aucune note pour l\'instant. Le score pondère les priorités (haute = 3, moyenne = 2, basse = 1).</p>';
  const pn = id => id ? pname(id) : 'Unité complète';
  $('#notesList').innerHTML = ents.length ? `<table class="tbl"><thead><tr><th>Prio</th><th>Action</th><th>Joueur</th><th>Thème</th><th>Observation</th><th>Exercice</th><th></th></tr></thead><tbody>` +
    ents.map(({ k, n, p }) => `<tr><td class="prio${n.prio || 3}">${n.prio ? 'P' + n.prio : '–'}</td><td>${p ? `${esc(p.off)} vs ${esc(p.def)} · Q${p.quarter} ${esc(p.clock?.slice(0, 5))} · ${ord(p.down)}&${p.ytg ?? '?'}` : esc(k)}</td><td>${esc(pn(n.player))}</td><td>${esc(n.focus || '')}</td><td>${esc(n.obs || '')}</td><td>${esc(n.drill || '')}</td><td>${p ? `<button class="btn sec" data-open="${k}">Ouvrir</button>` : ''}</td></tr>`).join('') + '</tbody></table>' : '';
  $('#notesList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => openPlay(b.dataset.open));
}
$('#btnExportJson').onclick = () => download('notes-coach.json', JSON.stringify(S.notes, null, 2), 'application/json');
$('#btnExportCsv').onclick = () => {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', head = ['gameId', 'playId', 'equipe', 'adversaire', 'quart', 'down', 'distance', 'priorite', 'theme', 'joueur', 'observation', 'exercice', 'date'];
  const lines = [head.join(',')];
  for (const [k, n] of Object.entries(S.notes)) { const p = DB.plays.get(k) || {}; lines.push([p.g, p.p, p.off, p.def, p.quarter, p.down, p.ytg, n.prio, n.focus, n.player ? pname(n.player) : 'Unité complète', n.obs, n.drill, new Date(n.ts).toISOString()].map(q).join(',')); }
  download('notes-coach.csv', '\uFEFF' + lines.join('\n'), 'text/csv');
};
$('#importJson').onchange = async e => { try { const o = JSON.parse(await e.target.files[0].text()); Object.assign(S.notes, o); persist(); renderNotes(); renderProblems(); toast('Notes importées'); } catch (err) { toast('Fichier JSON invalide'); } e.target.value = ''; };


function renderAll() { renderKPIs(); renderCompare(); renderProblems(); renderNotes(); }

App.dashboard = { renderAll, renderKPIs, renderCompare, renderProblems, renderNotes, setupNoteForm, tags, buildEntities, buildProblems, factsFor };
})();