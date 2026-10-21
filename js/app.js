(() => {
    'use strict';
    /* ============ Utilitaires ============ */
    const $ = s => document.querySelector(s);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num = v => { if (v === undefined || v === null || v === '' || v === 'NA' || v === 'NaN') return null; const n = +v; return Number.isFinite(n) ? n : null; };
    const n0 = v => num(v) ?? 0;
    const flag = v => n0(v) > 0 ? 1 : 0;
    const normId = v => { const n = num(v); return n === null ? null : String(Math.trunc(n)); };
    const pct = (x, d = 1) => (x * 100).toFixed(d).replace('.', ',') + ' %';
    const f1 = (x, d = 1) => Number(x).toFixed(d).replace('.', ',');
    const gv = v => (v === undefined || v === null || v === '' || v === 'NA') ? 'Non renseigné' : String(v);
    const colIndex = h => Object.fromEntries(h.map((n, i) => [n, i]));
    const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
    const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
    const ord = d => d == null ? '' : ({1:'1st',2:'2nd',3:'3rd',4:'4th'}[d] || d + 'th');
    const shortName = n => { if (!n) return ''; const p = n.trim().split(/\s+/); return p.length < 2 ? n : p[0][0] + '. ' + p.slice(1).join(' '); };
    const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

    /* ============ Lecture CSV en flux ============ */
    function splitLine(line) {
      if (line.indexOf('"') < 0) return line.split(',');
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur); return out;
    }
    async function streamCSV(file, o) {
      const reader = file.stream().getReader(), dec = new TextDecoder('utf-8');
      let carry = '', header = null, read = 0, seen = false, misses = 0, stop = false;
      const handle = line => {
        if (line.charCodeAt(0) === 0xFEFF) line = line.slice(1);
        if (!header) { header = splitLine(line).map(s => s.trim()); o.onHeader && o.onHeader(header); return; }
        if (o.lineFilter && !o.lineFilter(line)) { misses++; }
        else if (o.onRow(splitLine(line)) === true) { seen = true; misses = 0; } else misses++;
        if (o.stopAfterMisses && seen && misses > o.stopAfterMisses) stop = true;
      };
      while (!stop) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.length;
        carry += dec.decode(value, { stream: true });
        let start = 0, idx;
        while ((idx = carry.indexOf('\n', start)) >= 0) {
          let line = carry.slice(start, idx); start = idx + 1;
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line) handle(line);
          if (stop) break;
        }
        carry = carry.slice(start);
        o.onProgress && o.onProgress(Math.min(1, read / (file.size || 1)));
      }
      if (stop) { try { await reader.cancel(); } catch (e) {} }
      else if (carry.trim()) handle(carry.replace(/\r$/, ''));
      o.onProgress && o.onProgress(1);
    }

    /* ============ Base de données en mémoire ============ */
    const DB = { games: new Map(), players: new Map(), plays: new Map(), playsByTeam: new Map(), pff: [], pffByPlay: new Map(), trackFiles: [], trackCache: new Map(), league: { n: 0, press: 0, sack: 0, hit: 0, hurry: 0, beaten: 0 }, counts: {} };
    const S = { team: null, gameId: 'ALL', tab: 'players', minSnaps: 15, minPlays: 5, groupBy: 'offenseFormation',
      sel: { players: new Set(), groups: new Set(), pos: new Set() },
      sort: { players: { k: 'press', d: -1 }, groups: { k: 'press', d: -1 }, pos: { k: 'press', d: -1 }, probs: { k: 'sev', d: -1 } },
      probType: 'all', selPlayKey: null, notes: {} };
    const pname = id => DB.players.get(id)?.name || ('#' + id);
    const COL = ['#4da3ff', '#f59e0b', '#34d399', '#f472b6'];

    /* ============ Chargement ============ */
    async function identify(file) {
      const head = (await file.slice(0, 4096).text()).replace(/^\uFEFF/, '');
      const cols = splitLine(head.split(/\r?\n/)[0]).map(s => s.trim());
      const has = c => cols.includes(c);
      if (has('frameId') && has('x') && has('y')) return 'tracking';
      if (has('pff_role')) return 'pff';
      if (has('playDescription')) return 'plays';
      if (has('officialPosition')) return 'players';
      if (has('homeTeamAbbr')) return 'games';
      return null;
    }
    let progBase = 0, progSpan = 1;
    const setProg = f => { $('#prog i').style.width = ((progBase + f * progSpan) * 100) + '%'; };

    async function loadGames(f) {
      DB.games.clear(); let H;
      await streamCSV(f, { onHeader: h => H = colIndex(h), onProgress: setProg, onRow: c => {
        const g = String(normId(c[H.gameId]));
        DB.games.set(g, { id: g, season: c[H.season], week: num(c[H.week]), date: c[H.gameDate], home: c[H.homeTeamAbbr], away: c[H.visitorTeamAbbr] }); return true; } });
      return DB.games.size;
    }
    async function loadPlayers(f) {
      DB.players.clear(); let H;
      await streamCSV(f, { onHeader: h => H = colIndex(h), onProgress: setProg, onRow: c => {
        const id = normId(c[H.nflId]); if (id === null) return false;
        DB.players.set(id, { id, name: c[H.displayName], pos: c[H.officialPosition], h: c[H.height], w: c[H.weight], college: c[H.collegeName] }); return true; } });
      return DB.players.size;
    }
    async function loadPlays(f) {
      DB.plays.clear(); let H;
      await streamCSV(f, { onHeader: h => H = colIndex(h), onProgress: setProg, onRow: c => {
        const g = String(normId(c[H.gameId])), p = String(normId(c[H.playId]));
        DB.plays.set(g + '_' + p, { g, p, key: g + '_' + p, desc: c[H.playDescription], quarter: num(c[H.quarter]), down: num(c[H.down]), ytg: num(c[H.yardsToGo]),
          off: c[H.possessionTeam], def: c[H.defensiveTeam], clock: c[H.gameClock], passResult: c[H.passResult], playResult: num(c[H.playResult]),
          penaltyYards: num(c[H.penaltyYards]), foul: c[H.foulName1], abs: num(c[H.absoluteYardlineNumber]),
          offenseFormation: c[H.offenseFormation], personnelO: c[H.personnelO], defendersInBox: c[H.defendersInBox], personnelD: c[H.personnelD],
          dropBackType: c[H.dropBackType], pff_playAction: c[H.pff_playAction], pff_passCoverage: c[H.pff_passCoverage], pff_passCoverageType: c[H.pff_passCoverageType] }); return true; } });
      return DB.plays.size;
    }
    async function loadPff(f) {
      DB.pff = []; let H;
      await streamCSV(f, { onHeader: h => H = colIndex(h), onProgress: setProg, onRow: c => {
        const g = String(normId(c[H.gameId])), p = String(normId(c[H.playId]));
        const r = { g, p, key: g + '_' + p, id: normId(c[H.nflId]), role: c[H.pff_role], pos: c[H.pff_positionLinedUp],
          hit: flag(c[H.pff_hit]), hurry: flag(c[H.pff_hurry]), sack: flag(c[H.pff_sack]), beaten: flag(c[H.pff_beatenByDefender]),
          hitA: flag(c[H.pff_hitAllowed]), hurryA: flag(c[H.pff_hurryAllowed]), sackA: flag(c[H.pff_sackAllowed]),
          blocked: normId(c[H.pff_nflIdBlockedPlayer]), blockType: c[H.pff_blockType], back: c[H.pff_backFieldBlock] };
        r.press = (r.hitA || r.hurryA || r.sackA) ? 1 : 0;
        DB.pff.push(r); return true; } });
      return DB.pff.length;
    }
    function relink() {
      DB.playsByTeam.clear();
      for (const p of DB.plays.values()) { if (!DB.playsByTeam.has(p.off)) DB.playsByTeam.set(p.off, []); DB.playsByTeam.get(p.off).push(p); }
      DB.pffByPlay.clear();
      const L = { n: 0, press: 0, sack: 0, hit: 0, hurry: 0, beaten: 0 };
      for (const r of DB.pff) {
        r.play = DB.plays.get(r.key) || null;
        let a = DB.pffByPlay.get(r.key); if (!a) { a = []; DB.pffByPlay.set(r.key, a); } a.push(r);
        if (r.role === 'Pass Block' && r.play) { L.n++; L.press += r.press; L.sack += r.sackA; L.hit += r.hitA; L.hurry += r.hurryA; L.beaten += r.beaten; }
      }
      DB.league = L;
    }
    const leagueRates = () => { const L = DB.league, d = L.n || 1; return { press: L.press / d, sack: L.sack / d, hit: L.hit / d, hurry: L.hurry / d, beaten: L.beaten / d }; };

    async function handleFiles(list) {
      const files = [...list]; if (!files.length) return;
      const kinds = {}, unknown = [];
      for (const f of files) {
        const k = await identify(f);
        if (k === 'tracking') { if (!DB.trackFiles.some(t => t.name === f.name && t.size === f.size)) { DB.trackFiles.push(f); } }
        else if (k) kinds[k] = f; else unknown.push(f.name);
      }
      const steps = ['games', 'players', 'plays', 'pff'].filter(k => kinds[k]);
      const loaders = { games: loadGames, players: loadPlayers, plays: loadPlays, pff: loadPff };
      try {
        for (let i = 0; i < steps.length; i++) {
          progBase = i / steps.length; progSpan = 1 / steps.length;
          DB.counts[steps[i]] = await loaders[steps[i]](kinds[steps[i]]);
        }
      } catch (e) { console.error(e); toast('Erreur de lecture : ' + e.message); }
      setProg(0); $('#prog i').style.width = '0';
      DB.counts.tracking = DB.trackFiles.length;
      relink(); renderStatus(unknown);
      if (DB.plays.size && DB.pff.length) { document.body.classList.add('ready'); initSelectors(); renderAll(); }
    }
    function renderStatus(unknown = []) {
      const c = DB.counts, mk = (k, label, unit) => `<span class="chip ${c[k] ? 'ok' : 'bad'}">${label} : ${c[k] ? c[k].toLocaleString('fr-FR') + ' ' + unit : 'manquant'}</span>`;
      $('#loadStatus').innerHTML = mk('games', 'games', 'matchs') + mk('players', 'players', 'joueurs') + mk('plays', 'plays', 'actions') + mk('pff', 'pffScoutingData', 'lignes') +
        `<span class="chip ${c.tracking ? 'ok' : ''}">tracking : ${c.tracking || 0} fichier(s) (lu à la demande)</span>` +
        unknown.map(n => `<span class="chip bad">non reconnu : ${esc(n)}</span>`).join('');
    }

    /* ============ Sélection équipe / match ============ */
    const teamPlays = (team, gid) => (DB.playsByTeam.get(team) || []).filter(p => gid === 'ALL' || p.g === gid);
    const teamRows = (team, gid) => DB.pff.filter(r => r.role === 'Pass Block' && r.play && r.play.off === team && (gid === 'ALL' || r.g === gid));
    function gamesOf(team) {
      const ids = [...new Set((DB.playsByTeam.get(team) || []).map(p => p.g))];
      return ids.map(id => { const g = DB.games.get(id), pl = DB.playsByTeam.get(team).find(p => p.g === id);
        return { id, week: g?.week ?? 99, date: g?.date || '', home: g ? g.home === team : null, opp: pl.def, n: DB.playsByTeam.get(team).filter(p => p.g === id).length }; })
        .sort((a, b) => a.week - b.week || String(a.date).localeCompare(String(b.date)));
    }
    function initSelectors() {
      const teams = [...DB.playsByTeam.keys()].filter(Boolean).sort();
      if (!S.team || !teams.includes(S.team)) S.team = teams[0];
      $('#selTeam').innerHTML = teams.map(t => `<option ${t === S.team ? 'selected' : ''}>${esc(t)}</option>`).join('');
      fillGames(true);
    }
    function fillGames(reset) {
      const gs = gamesOf(S.team);
      if (reset || (S.gameId !== 'ALL' && !gs.some(g => g.id === S.gameId))) S.gameId = gs[0]?.id || 'ALL';
      $('#selGame').innerHTML = `<option value="ALL">Saison (${gs.length} matchs chargés)</option>` +
        gs.map(g => `<option value="${g.id}" ${g.id === S.gameId ? 'selected' : ''}>${g.week !== 99 ? 'S' + g.week + ' · ' : ''}${g.home === null ? 'vs' : g.home ? 'vs' : '@'} ${esc(g.opp)} · ${g.n} passes ${esc(g.date)}</option>`).join('');
      if (S.gameId === 'ALL') $('#selGame').value = 'ALL';
    }
    $('#selTeam').onchange = e => { S.team = e.target.value; S.sel.players.clear(); S.sel.groups.clear(); S.sel.pos.clear(); fillGames(true); renderAll(); };
    $('#selGame').onchange = e => { S.gameId = e.target.value; S.sel.players.clear(); S.sel.groups.clear(); S.sel.pos.clear(); renderAll(); };

    /* ============ Agrégations ============ */
    function agg(rows, keyFn) {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r); if (k == null) continue;
        let a = m.get(k); if (!a) { a = { key: k, n: 0, sack: 0, hit: 0, hurry: 0, beaten: 0, press: 0, plays: new Set(), pPlays: new Set(), posC: new Map() }; m.set(k, a); }
        a.n++; a.sack += r.sackA; a.hit += r.hitA; a.hurry += r.hurryA; a.beaten += r.beaten; a.press += r.press;
        a.plays.add(r.key); if (r.press) a.pPlays.add(r.key); a.posC.set(r.pos, (a.posC.get(r.pos) || 0) + 1);
      }
      return [...m.values()];
    }
    function groupKey(r) {
      const p = r.play, g = S.groupBy;
      if (g === 'pff_playAction') { const v = p[g]; return v === '1' || v === 1 ? 'Play-action' : v === '0' || v === 0 ? 'Dropback pur' : 'Non renseigné'; }
      if (g === 'defendersInBox') { const v = num(p[g]); return v === null ? 'Non renseigné' : v + ' en box'; }
      return gv(p[g]);
    }
    const topPos = a => [...a.posC.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '';

    function rateCell(k, n, max, color) {
      const p = n ? k / n : 0, [lo, hi] = wilson(k, n), w = max ? Math.min(100, p / max * 100) : 0;
      return `<div class="rc" title="Intervalle de confiance 95 % : ${pct(lo)} – ${pct(hi)}"><div class="bar"><i style="width:${w}%;background:${color}"></i></div><b>${pct(p)}</b><span class="n">${k}/${n}</span></div>`;
    }

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

    /* ============ Étape 5 : rejeu ============ */
    const ROLE = { 'Pass Block': { c: '#3b82f6', l: 'Bloqueurs', z: 4 }, 'Pass': { c: '#f59e0b', l: 'QB', z: 5 }, 'Pass Rush': { c: '#ef4444', l: 'Rusheurs', z: 3 }, 'Pass Route': { c: '#a3e635', l: 'Receveurs', z: 1 }, 'Coverage': { c: '#94a3b8', l: 'Couverture', z: 0 }, 'Autre': { c: '#cbd5e1', l: 'Autres', z: 0 } };
    const EV = { ball_snap: 'Snap', autoevent_ballsnap: 'Snap', pass_forward: 'Passe', autoevent_passforward: 'Passe', qb_sack: 'Sack', qb_strip_sack: 'Sack+fumble', pass_arrived: 'Arrivée', pass_outcome_caught: 'Capté', pass_outcome_incomplete: 'Incomplet', pass_outcome_interception: 'Interception', pass_outcome_touchdown: 'TD', fumble: 'Fumble', handoff: 'Remise', run: 'Course', tackle: 'Plaqué', touchdown: 'TD', out_of_bounds: 'Sortie', first_contact: '1er contact', line_set: 'Alignés', man_in_motion: 'Motion', play_action: 'Play-action', shift: 'Shift', qb_slide: 'QB slide', pass_tipped: 'Déviée', qb_spike: 'Spike', penalty_flag: 'Flag', pass_shovel: 'Shovel', lateral: 'Latéral' };
    const R = { tp: null, play: null, fi: 0, t: 0, snapIdx: 0, playing: false, speed: 1, raf: 0, last: 0, acc: 0, selPid: null, view: null, scale: 20, los: 60, yc: 26.67, press: null,
      opts: { mode: 'pocket', trails: true, full: false, assign: true, dist: true, vec: false, labels: 'num', roles: { 'Pass Block': true, 'Pass': true, 'Pass Rush': true, 'Pass Route': true, 'Coverage': true, 'Autre': true } } };

    async function ensureTracking(gid) {
      if (DB.trackCache.has(gid)) return DB.trackCache.get(gid);
      const week = DB.games.get(gid)?.week;
      const wk = f => { const m = f.name.match(/week[_\s-]*0*(\d+)/i); return m ? +m[1] : null; };
      const files = [...DB.trackFiles.filter(f => wk(f) === week), ...DB.trackFiles.filter(f => wk(f) !== week)];
      for (const entry of files) {
        let f = entry;
        // Les fichiers du dossier data/tracking sont téléchargés uniquement au moment du rejeu.
        if (entry.url) {
          try { const response = await fetch(entry.url); if (!response.ok) continue; f = new File([await response.blob()], entry.name, { type: 'text/csv' }); }
          catch (e) { continue; }
        }
        const res = new Map(); let H, found = 0;
        progBase = 0; progSpan = 1;
        await streamCSV(f, { onProgress: setProg, stopAfterMisses: 20000, onHeader: h => H = colIndex(h),
          lineFilter: l => l.indexOf(gid) >= 0,
          onRow: c => {
            if (String(normId(c[H.gameId])) !== gid) return false;
            const pid = String(normId(c[H.playId])); let tp = res.get(pid);
            if (!tp) { tp = { flip: c[H.playDirection] === 'left', players: new Map(), ball: null, ev: new Map(), frames: new Set() }; res.set(pid, tp); }
            const fid = +c[H.frameId], flip = tp.flip;
            let x = +c[H.x], y = +c[H.y], o = num(c[H.o]), d = num(c[H.dir]);
            if (flip) { x = 120 - x; y = 53.33 - y; if (o !== null) o = (o + 180) % 360; if (d !== null) d = (d + 180) % 360; }
            const pt = { f: fid, x, y, s: num(c[H.s]) ?? 0, a: num(c[H.a]) ?? 0, o, dir: d };
            tp.frames.add(fid);
            const ev = c[H.event]; if (ev && ev !== 'NA' && ev !== 'None') tp.ev.set(fid, ev);
            const id = normId(c[H.nflId]);
            let pl;
            if (id === null || c[H.team] === 'football') { if (!tp.ball) tp.ball = { map: new Map() }; pl = tp.ball; }
            else { pl = tp.players.get(id); if (!pl) { pl = { id, name: c[H.displayName], jersey: c[H.jerseyNumber] === 'NA' ? '' : String(normId(c[H.jerseyNumber]) ?? ''), side: c[H.team], map: new Map() }; tp.players.set(id, pl); } }
            pl.map.set(fid, pt); return true;
          } });
        if (res.size) {
          for (const tp of res.values()) { tp.fr = [...tp.frames].sort((a, b) => a - b); tp.snapF = [...tp.ev.entries()].find(([, e]) => e === 'ball_snap' || e === 'autoevent_ballsnap')?.[0] ?? tp.fr[0]; }
          DB.trackCache.set(gid, res); setProg(0); $('#prog i').style.width = '0'; return res;
        }
      }
      setProg(0); $('#prog i').style.width = '0';
      const empty = new Map(); DB.trackCache.set(gid, empty); return empty;
    }
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

    /* ============ Démarrage ============ */
    function renderAll() { renderKPIs(); renderCompare(); renderProblems(); renderNotes(); }
    $('#files').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    window.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

    /*to get all the files in the tracking folder */

    async function loadTrackingFiles() {
      const response = await fetch('data/tracking/manifest.json');

      if (!response.ok) {
        throw new Error('Impossible de charger manifest.json');
      }

      const filenames = await response.json();

      DB.trackFiles = filenames.map(name => ({
        name,
        size: 0,
        url: `data/tracking/${name}`
      }));
    }

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
        try {
        await loadTrackingFiles();
      } catch (e) {
        console.error(e);
        toast('Impossible de charger la liste des fichiers de tracking');
      }

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