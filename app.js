/* ── Config ── */
const API_KEY = '06674efbb9e39fb954c0a826560fadd1';

const LEAGUES = [
  { key: 'soccer_spain_la_liga',          label: 'La Liga',        flag: '🇪🇸' },
  { key: 'soccer_uefa_champs_league',     label: 'Champions',      flag: '🏆' },
  { key: 'soccer_epl',                    label: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { key: 'soccer_germany_bundesliga',     label: 'Bundesliga',     flag: '🇩🇪' },
  { key: 'soccer_italy_serie_a',          label: 'Serie A',        flag: '🇮🇹' },
  { key: 'soccer_france_ligue_one',       label: 'Ligue 1',        flag: '🇫🇷' },
  { key: 'soccer_spain_segunda_division', label: 'Segunda',        flag: '🇪🇸' },
  { key: 'soccer_uefa_europa_league',     label: 'Europa League',  flag: '🟠' },
];

const BOOK_DISPLAY = {
  bet365:'Bet365', betway:'Betway', unibet:'Unibet', betfair:'Betfair',
  williamhill:'W.Hill', bwin:'Bwin', interwetten:'IW', pinnacle:'Pinnacle',
  paddypower:'P.Power', betvictor:'BetVictor', coral:'Coral',
  codere:'Codere', versus:'Versus', marathonbet:'Marathon', onexbet:'1xBet',
  nordicbet:'Nordic', betsson:'Betsson', '888sport':'888sport',
};

let selectedLeagues = ['soccer_spain_la_liga','soccer_uefa_champs_league'];
let threshold       = 4;
let activeTab       = 'value';
let allMatches      = [];
let quotaLeft       = null;
let quotaUsed       = null;
let bookiesFound    = new Set();

(function buildLeagueGrid() {
  const grid = document.getElementById('leagues-grid');
  LEAGUES.forEach(l => {
    const btn  = document.createElement('button');
    const isOn = selectedLeagues.includes(l.key);
    btn.className = 'league-btn' + (isOn ? ' on' : '');
    btn.innerHTML = '<span class="chk">' + (isOn?'✓':'') + '</span>' + l.flag + ' ' + l.label;
    btn.addEventListener('click', () => toggleLeague(l.key, btn));
    grid.appendChild(btn);
  });
})();

function toggleLeague(key, btn) {
  const idx = selectedLeagues.indexOf(key);
  if (idx >= 0) { selectedLeagues.splice(idx,1); btn.classList.remove('on'); btn.querySelector('.chk').textContent=''; }
  else          { selectedLeagues.push(key);      btn.classList.add('on');    btn.querySelector('.chk').textContent='✓'; }
}

function startApp() {
  if (!selectedLeagues.length) { alert('Selecciona al menos una liga.'); return; }
  threshold = parseInt(document.getElementById('setup-thr').value);
  document.getElementById('thr').value = threshold;
  document.getElementById('thr-lbl').textContent = threshold + '%';
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  fetchAll();
}

function backToSetup() {
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
}

function setTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderAll();
}

async function fetchLeague(sport) {
  const meta = LEAGUES.find(l => l.key === sport);
  const url  = 'https://api.the-odds-api.com/v4/sports/' + sport + '/odds/'
    + '?apiKey=' + API_KEY + '&regions=eu,uk&markets=h2h&oddsFormat=decimal';
  const res  = await fetch(url);
  const ql   = res.headers.get('x-requests-remaining');
  const qu   = res.headers.get('x-requests-used');
  if (ql !== null) quotaLeft = ql;
  if (qu !== null) quotaUsed = qu;
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message||'HTTP '+res.status); }
  const data = await res.json();
  return data.map(ev => Object.assign({}, ev, { _league: meta ? meta.label : sport, _flag: meta ? meta.flag : '⚽' }));
}

async function fetchAll() {
  const btn = document.getElementById('rbtn');
  btn.classList.add('spin'); btn.disabled = true;
  document.getElementById('status-dot').className = 'dot red';
  document.getElementById('list').innerHTML =
    '<div class="loading-state"><div class="loading-spinner"></div><div class="loading-text">Obteniendo cuotas en tiempo real...</div></div>';
  try {
    const results = await Promise.allSettled(selectedLeagues.map(fetchLeague));
    let raw = [], errors = [];
    results.forEach(function(r, i) {
      const name = (LEAGUES.find(l=>l.key===selectedLeagues[i])||{label:selectedLeagues[i]}).label;
      if (r.status==='fulfilled') raw = raw.concat(r.value);
      else errors.push(name + ': ' + r.reason.message);
    });
    if (raw.length===0 && errors.length) { showError(errors[0]); return; }
    bookiesFound.clear();
    allMatches = raw.map(processMatch).filter(Boolean);
    allMatches.sort((a,b) => b.maxEdge - a.maxEdge);
    updateKpis(); renderAll(); updateQuota();
    const now = new Date();
    document.getElementById('ts').textContent =
      String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    document.getElementById('status-dot').className = 'dot';
    document.getElementById('app-sub').textContent =
      selectedLeagues.map(k=>(LEAGUES.find(l=>l.key===k)||{label:k}).label).join(' · ');
  } catch(e) {
    showError(e.message);
  } finally {
    btn.classList.remove('spin'); btn.disabled = false;
  }
}

function processMatch(ev) {
  if (!ev.bookmakers || ev.bookmakers.length < 2) return null;
  const bookData = {};
  ev.bookmakers.forEach(function(bk) {
    const h2h = (bk.markets||[]).find(m => m.key==='h2h');
    if (!h2h) return;
    bookData[bk.key] = { title: BOOK_DISPLAY[bk.key]||bk.title, odds: h2h.outcomes };
    bookiesFound.add(bk.key);
  });
  const books = Object.keys(bookData);
  if (books.length < 2) return null;

  const outcomeNames = [ev.home_team, ev.away_team, 'Draw'];
  const outcomes = outcomeNames.map(function(oName) {
    const perBook = books.map(function(bk) {
      const o = bookData[bk].odds.find(x => x.name===oName);
      return o ? { bk: bk, title: bookData[bk].title, price: o.price } : null;
    }).filter(Boolean);
    if (perBook.length < 2) return null;
    const avg  = perBook.reduce((s,x)=>s+x.price,0) / perBook.length;
    const best = perBook.reduce((a,x)=>x.price>a.price?x:a);
    const min  = perBook.reduce((a,x)=>x.price<a.price?x:a);
    const edge = Math.round(((best.price/avg)-1)*1000)/10;
    const div  = Math.round(((best.price/min.price)-1)*1000)/10;
    const label = oName==='Draw' ? 'Empate' : oName===ev.home_team ? 'Local' : 'Visitante';
    return { name:oName, label:label, perBook:perBook, avg:Math.round(avg*100)/100, best:best, min:min, edge:edge, div:div };
  }).filter(Boolean);
  if (!outcomes.length) return null;

  const surebetSum    = outcomes.reduce((s,o)=>s+1/o.best.price, 0);
  const isSurebet     = surebetSum < 1;
  const surebetProfit = isSurebet ? Math.round((1/surebetSum-1)*1000)/10 : 0;
  const surebetStakes = isSurebet ? outcomes.map(function(o) {
    return { bk:o.best.bk, title:o.best.title, price:o.best.price,
      stake:   Math.round((1/o.best.price/surebetSum)*100*100)/100,
      payout:  Math.round((1/o.best.price/surebetSum)*100*o.best.price*100)/100 };
  }) : [];

  const ERR_THR = 15;
  const errList = outcomes.map(o => o.div>=ERR_THR ? {outcome:o,div:o.div} : null).filter(Boolean);

  const maxEdge = Math.max.apply(null, outcomes.map(o=>o.edge));
  const maxDiv  = Math.max.apply(null, outcomes.map(o=>o.div));
  const commence = new Date(ev.commence_time);

  return {
    id:ev.id, league:ev._league, flag:ev._flag, home:ev.home_team, away:ev.away_team,
    time:formatTime(commence),
    isLive: commence < new Date() && (new Date()-commence) < 7200000,
    outcomes:outcomes, maxEdge:maxEdge, maxDiv:Math.round(maxDiv*10)/10, bookCount:books.length,
    isSurebet:isSurebet, surebetProfit:surebetProfit,
    surebetSum:Math.round(surebetSum*1000)/1000, surebetStakes:surebetStakes,
    hasError:errList.length>0, errors:errList,
  };
}

function renderAll() {
  updateKpis();
  if      (activeTab==='value')   renderValue();
  else if (activeTab==='surebet') renderSurebets();
  else                            renderErrors();
}

function renderValue() {
  const list = allMatches.filter(m=>m.maxEdge>0);
  if (!list.length) {
    document.getElementById('list').innerHTML = '<div class="empty">No hay partidos disponibles.<br>Pulsa Actualizar.</div>'; return;
  }
  document.getElementById('list').innerHTML = list.map(renderValueCard).join('');
}

function renderValueCard(m) {
  const isV = m.maxEdge >= threshold;
  const isW = m.maxEdge >= threshold*0.5 && !isV;
  const cls = isV ? 'vv' : isW ? 'ww' : 'nn';
  const intensity = Math.min(m.maxEdge/15, 1);
  const glowAlpha = intensity*0.3;
  const glowColor = isV ? 'rgba(34,197,94,'+glowAlpha+')' : isW ? 'rgba(251,146,60,'+(intensity*0.25)+')' : 'transparent';
  const badgeSz   = isV ? Math.round(12+intensity*4)+'px' : '12px';
  const badgeGlow = isV ? Math.round(intensity*20)+'px' : '0px';

  const badge = isV
    ? '<div class="vbadge hot" style="font-size:'+badgeSz+';box-shadow:0 0 '+badgeGlow+' '+glowColor+'">🔥 +'+m.maxEdge+'%</div>'
    : isW ? '<div class="vbadge warm">⚡ +'+m.maxEdge+'%</div>'
    : '<div class="vbadge flat">'+(m.maxEdge>0?'+':'')+m.maxEdge+'%</div>';

  const allBks = [...new Set(m.outcomes.flatMap(o=>o.perBook.map(x=>x.bk)))];
  const thead  = '<tr><th style="width:75px">Casa</th>'+m.outcomes.map(o=>'<th class="c">'+o.label+'</th>').join('')+'</tr>';
  const tbody  = allBks.map(function(bk) {
    const title = BOOK_DISPLAY[bk]||bk.substring(0,7);
    const cells = m.outcomes.map(function(o) {
      const entry   = o.perBook.find(x=>x.bk===bk);
      if (!entry) return '<td class="c"><span class="odd-cell na">—</span></td>';
      const isValue = bk===o.best.bk && o.edge>=threshold;
      const isBest  = bk===o.best.bk && !isValue;
      const c2      = isValue?'value':isBest?'best':'';
      const sz      = isValue ? Math.round(12+Math.min(o.edge/15,1)*3)+'px' : '12px';
      return '<td class="c"><span class="odd-cell '+c2+'" style="font-size:'+sz+'">'+entry.price.toFixed(2)+'</span></td>';
    }).join('');
    return '<tr><td><span class="bname">'+title+'</span></td>'+cells+'</tr>';
  }).join('');
  const avgRow = '<tr class="avg-row"><td><span class="avg-label">MEDIA</span></td>'+m.outcomes.map(o=>'<td class="c"><span class="avg-val">'+o.avg.toFixed(2)+'</span></td>').join('')+'</tr>';
  const ep     = Math.min(m.maxEdge/15*100,100);
  const lt     = m.isLive ? '<span class="live-tag">LIVE</span>' : '';
  const glow   = Math.round(intensity*24);

  return '<div class="card '+cls+'" style="box-shadow:0 0 '+glow+'px '+glowColor+'">'
    +'<div class="card-head"><div>'
    +'<div class="match-league">'+m.flag+' '+m.league+lt+'</div>'
    +'<div class="match-name">'+m.home+' <span class="vs">vs</span> '+m.away+'</div>'
    +'<div class="match-time">'+m.time+'</div></div>'+badge+'</div>'
    +'<table class="odds-table"><thead>'+thead+'</thead><tbody>'+tbody+avgRow+'</tbody></table>'
    +'<div class="card-foot"><div class="market-info">'
    +'<div class="mi">Edge: <span>+'+m.maxEdge+'%</span></div>'
    +'<div class="mi">Div: <span>'+m.maxDiv+'%</span></div>'
    +'<div class="mi">Casas: <span>'+m.bookCount+'</span></div></div>'
    +'<div class="edge-vis"><span>Edge</span>'
    +'<div class="ebar"><div class="efill" style="width:'+ep+'%"></div></div>'
    +'<span style="color:'+(isV?'#22c55e':'#55558a')+'">'+m.maxEdge+'%</span></div></div></div>';
}

function renderSurebets() {
  const list = allMatches.filter(m=>m.isSurebet).sort((a,b)=>b.surebetProfit-a.surebetProfit);
  if (!list.length) {
    document.getElementById('list').innerHTML =
      '<div class="empty">No hay surebets ahora mismo.<br>Son raras — selecciona más ligas y actualiza frecuentemente.</div>'; return;
  }
  document.getElementById('list').innerHTML = list.map(function(m) {
    const profit    = m.surebetProfit;
    const intensity = Math.min(profit/5, 1);
    const glow      = 'rgba(250,204,21,'+(intensity*0.35)+')';
    const glowPx    = Math.round(intensity*32);
    const badgeSz   = Math.round(13+intensity*5)+'px';
    const lt        = m.isLive ? '<span class="live-tag">LIVE</span>' : '';
    const bc        = 'rgba(250,204,21,'+(0.2+intensity*0.4)+')';

    const stakes = m.surebetStakes.map(function(s,i) {
      const label = m.outcomes[i].label;
      return '<div class="surebet-row">'
        +'<div class="sb-outcome">'+label+'</div>'
        +'<div class="sb-book">'+s.title+'</div>'
        +'<div class="sb-odd">'+s.price.toFixed(2)+'</div>'
        +'<div class="sb-stake">€'+s.stake+'</div>'
        +'<div class="sb-return">→ €'+s.payout+'</div>'
        +'</div>';
    }).join('');

    return '<div class="card surebet-card" style="box-shadow:0 0 '+glowPx+'px '+glow+';border-color:'+bc+'">'
      +'<div class="card-head"><div>'
      +'<div class="match-league">'+m.flag+' '+m.league+lt+'</div>'
      +'<div class="match-name">'+m.home+' <span class="vs">vs</span> '+m.away+'</div>'
      +'<div class="match-time">'+m.time+'</div></div>'
      +'<div class="vbadge surebet-badge" style="font-size:'+badgeSz+';box-shadow:0 0 '+Math.round(intensity*20)+'px '+glow+'">💰 +'+profit+'%</div>'
      +'</div>'
      +'<div class="surebet-header"><span>Resultado</span><span>Casa</span><span>Cuota</span><span>Apuesta</span><span>Retorno</span></div>'
      +stakes
      +'<div class="surebet-footer">'
      +'<span>Inversión: <strong>€100</strong></span>'
      +'<span>Retorno: <strong style="color:#facc15">€'+Math.round((100+profit)*100)/100+'</strong></span>'
      +'<span>Beneficio: <strong style="color:#22c55e">+€'+Math.round(profit*100)/100+'</strong></span>'
      +'</div></div>';
  }).join('');
}

function renderErrors() {
  const list = allMatches.filter(m=>m.hasError).sort((a,b)=>b.maxDiv-a.maxDiv);
  if (!list.length) {
    document.getElementById('list').innerHTML =
      '<div class="empty">No hay errores de cuota detectados.<br>Un error es cuando una casa tiene una cuota ≥15% por encima del mercado.</div>'; return;
  }
  document.getElementById('list').innerHTML = list.map(function(m) {
    const topErr    = m.errors.reduce((a,e)=>e.div>a.div?e:a, m.errors[0]);
    const div       = topErr.div;
    const intensity = Math.min(div/40, 1);
    const r = Math.round(239+(255-239)*intensity), g = Math.round(68-68*intensity), b = 0;
    const col  = 'rgb('+r+','+g+','+b+')';
    const glow = 'rgba('+r+','+g+','+b+','+(intensity*0.4)+')';
    const glowPx = Math.round(intensity*32);
    const badgeSz= Math.round(12+intensity*6)+'px';
    const lt     = m.isLive ? '<span class="live-tag">LIVE</span>' : '';
    const bc     = 'rgba('+r+','+g+','+b+','+(0.2+intensity*0.4)+')';

    const errorsHTML = m.errors.map(function(err) {
      const o    = err.outcome;
      const eInt = Math.min(err.div/40,1);
      const eSz  = Math.round(12+eInt*5)+'px';
      const eGlow= 'rgba(239,68,0,'+(eInt*0.5)+')';
      const eGlowPx = Math.round(eInt*16);
      const rows = o.perBook.map(function(x) {
        const isOut = x.bk===o.best.bk;
        const diff  = isOut ? Math.round((x.price/o.avg-1)*1000)/10 : 0;
        return '<div class="error-odd-row '+(isOut?'outlier':'')+'">'
          +'<span class="bname">'+(BOOK_DISPLAY[x.bk]||x.bk)+'</span>'
          +'<span class="odd-cell '+(isOut?'error-odd':'')+'"'
          +(isOut?' style="font-size:'+eSz+';box-shadow:0 0 '+eGlowPx+'px '+eGlow+'"':'')+'>'
          +x.price.toFixed(2)+'</span>'
          +(isOut?'<span class="error-diff" style="color:'+col+'">+'+diff+'%</span>':'<span></span>')
          +'</div>';
      }).join('');
      return '<div class="error-block">'
        +'<div class="error-outcome-label">'+o.label+' — divergencia <span style="color:'+col+';font-weight:700;font-size:'+eSz+'">'+err.div+'%</span></div>'
        +rows
        +'<div class="error-avg">Media: <span>'+o.avg.toFixed(2)+'</span> · Cuota errónea: <span style="color:'+col+'">'+o.best.price.toFixed(2)+'</span> en <span>'+o.best.title+'</span></div>'
        +'</div>';
    }).join('');

    return '<div class="card error-card" style="box-shadow:0 0 '+glowPx+'px '+glow+';border-color:'+bc+'">'
      +'<div class="card-head"><div>'
      +'<div class="match-league">'+m.flag+' '+m.league+lt+'</div>'
      +'<div class="match-name">'+m.home+' <span class="vs">vs</span> '+m.away+'</div>'
      +'<div class="match-time">'+m.time+'</div></div>'
      +'<div class="vbadge error-badge" style="font-size:'+badgeSz+';color:'+col+';border-color:rgba('+r+','+g+','+b+',.4);background:rgba('+r+','+g+','+b+',.1);box-shadow:0 0 '+Math.round(intensity*20)+'px '+glow+'">⚠️ '+div+'% div</div>'
      +'</div>'
      +errorsHTML+'</div>';
  }).join('');
}

function updateKpis() {
  const values   = allMatches.filter(m=>m.maxEdge>=threshold).length;
  const surebets = allMatches.filter(m=>m.isSurebet).length;
  const errors   = allMatches.filter(m=>m.hasError).length;
  const best     = allMatches.length ? allMatches[0].maxEdge : 0;
  document.getElementById('k-total').textContent = allMatches.length;
  if (activeTab==='value') {
    document.getElementById('k-values').textContent = values;
    document.getElementById('k-edge').textContent   = best>0 ? '+'+best+'%' : '—';
    document.getElementById('kpi-label-values').textContent = 'Value bets';
    document.getElementById('kpi-label-edge').textContent   = 'Mejor edge';
  } else if (activeTab==='surebet') {
    const bestSB = surebets ? Math.max.apply(null,allMatches.filter(m=>m.isSurebet).map(m=>m.surebetProfit)) : 0;
    document.getElementById('k-values').textContent = surebets;
    document.getElementById('k-edge').textContent   = bestSB>0 ? '+'+bestSB+'%' : '—';
    document.getElementById('kpi-label-values').textContent = 'Surebets';
    document.getElementById('kpi-label-edge').textContent   = 'Mejor profit';
  } else {
    const bestErr = errors ? Math.max.apply(null,allMatches.filter(m=>m.hasError).map(m=>m.maxDiv)) : 0;
    document.getElementById('k-values').textContent = errors;
    document.getElementById('k-edge').textContent   = bestErr>0 ? bestErr+'%' : '—';
    document.getElementById('kpi-label-values').textContent = 'Errores';
    document.getElementById('kpi-label-edge').textContent   = 'Mayor div.';
  }
  document.getElementById('k-books').textContent = bookiesFound.size||'—';
}

function updateQuota() {
  document.getElementById('quota-left').textContent = quotaLeft||'—';
  document.getElementById('quota-used').textContent = quotaUsed||'—';
}

function showError(msg) {
  document.getElementById('list').innerHTML =
    '<div class="error-state"><div class="error-icon">⚠️</div><div class="error-msg">'+msg+'</div>'
    +'<div class="error-sub">Comprueba tu conexión o el límite de la API key.</div></div>';
  document.getElementById('status-dot').className = 'dot red';
  document.getElementById('rbtn').classList.remove('spin');
  document.getElementById('rbtn').disabled = false;
}

function setThr(v) {
  threshold = parseInt(v);
  document.getElementById('thr-lbl').textContent = v+'%';
  renderAll();
}

function formatTime(d) {
  const now  = new Date(), diff = d - now;
  if (diff<0 && diff>-7200000) return '🔴 EN VIVO';
  if (diff<0) return 'Finalizado';
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const hh   = String(d.getHours()).padStart(2,'0');
  const mm   = String(d.getMinutes()).padStart(2,'0');
  const t0   = new Date(); t0.setHours(0,0,0,0);
  const t1   = new Date(t0); t1.setDate(t1.getDate()+1);
  const dm   = new Date(d); dm.setHours(0,0,0,0);
  if (dm.getTime()===t0.getTime()) return 'Hoy '+hh+':'+mm;
  if (dm.getTime()===t1.getTime()) return 'Mañana '+hh+':'+mm;
  return days[d.getDay()]+' '+d.getDate()+'/'+(d.getMonth()+1)+' '+hh+':'+mm;
}
