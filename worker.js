/* Worker du site Sphinx Alliance.
   Sert les fichiers statiques, plus des relais sous /api/ pour ce qu'un
   navigateur ne peut pas lire directement (sites qui refusent les appels
   depuis une page web) :
     /api/feargreed  indice Fear & Greed de CNN
     /api/news       flux RSS financiers fusionnés
     /api/dmx        sentiment des particuliers (Myfxbook)
     /api/polymarket marchés de prédiction (Fed, économie, géopolitique)
     /api/calendar   calendrier économique (ForexFactory, sinon TradingView)
     /api/macro      dernières statistiques publiées par pays (planisphère, décisions de taux,
                     PMI : calendrier TradingView et titres de presse)
     /api/rates      rendements 2 et 10 ans, stocks de pétrole
     /api/history    clôtures quotidiennes BTC, S&P 500, Nasdaq 100, or (saisonnalité)
     /api/gdelt      tension géopolitique (volume d'articles)
   Aucune clé dans ce fichier. Pour l'API officielle Myfxbook (facultative),
   les identifiants se règlent dans Cloudflare en tant que secrets du Worker
   (MYFXBOOK_EMAIL, MYFXBOOK_PASSWORD), jamais dans le dépôt. */
import { parseFeed, mergeNews, parseOutlookHtml, outlookFromApi, widgetUrlFromScript, cleanText, pmiHeadlines } from './api-lib.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CNN = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const CNN_HEADERS = { 'User-Agent': UA, 'Referer': 'https://www.cnn.com/markets/fear-and-greed', 'Origin': 'https://www.cnn.com', 'Accept': 'application/json' };

const FEEDS = [
  { id: 'fxstreet',   name: 'FXStreet',          url: 'https://www.fxstreet.com/rss/news' },
  { id: 'fxstreet-a', name: 'FXStreet Analysis', url: 'https://www.fxstreet.com/rss/analysis' },
  { id: 'ing',        name: 'ING Think',         url: 'https://think.ing.com/rss/' },
  { id: 'cnbc',       name: 'CNBC',              url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'cnbc-eco',   name: 'CNBC Economy',      url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { id: 'cnbc-mkt',   name: 'CNBC Markets',      url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html' },
  { id: 'mw',         name: 'MarketWatch',       url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'mw-pulse',   name: 'MarketWatch Pulse', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  { id: 'fed',        name: 'Federal Reserve',   url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'ecb',        name: 'BCE',               url: 'https://www.ecb.europa.eu/rss/press.html' },
  { id: 'boe',        name: 'Bank of England',   url: 'https://www.bankofengland.co.uk/rss/news' },
  { id: 'gnews',      name: 'Google News',       aggregator: true,
    url: 'https://news.google.com/rss/search?q=forex+OR+%22central+bank%22+OR+%22currency+markets%22+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen' },
];

const json = (obj, status, cache) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'access-control-allow-origin': '*' },
});
const errText = e => String(e && e.name === 'TimeoutError' ? 'délai dépassé' : (e && e.message) || e);

/* Garde la réponse en cache côté Cloudflare pour ne pas solliciter les sources à chaque visite. */
async function cached(request, ctx, build) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  try { const hit = await cache.match(key); if (hit) return hit; } catch (e) { /* cache indisponible : on continue */ }
  const res = await build();
  if (res.status === 200) { try { ctx.waitUntil(cache.put(key, res.clone())); } catch (e) { /* idem */ } }
  return res;
}

async function fearGreed() {
  try {
    const r = await fetch(CNN, { headers: CNN_HEADERS, cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) return json({ error: 'CNN a répondu HTTP ' + r.status }, 502, 'no-store');
    const j = await r.json();
    const fg = j && j.fear_and_greed;
    if (!fg || fg.score == null) return json({ error: 'Réponse CNN inattendue' }, 502, 'no-store');
    // sous-indicateurs : toute rubrique de la réponse qui porte une note (momentum, VIX, options…)
    const indicators = Object.keys(j).filter(k => k !== 'fear_and_greed' && k !== 'fear_and_greed_historical' && j[k] && typeof j[k] === 'object' && j[k].score != null)
      .map(k => ({ key: k, score: j[k].score, rating: j[k].rating || '' }));
    const h = j.fear_and_greed_historical && Array.isArray(j.fear_and_greed_historical.data) ? j.fear_and_greed_historical.data : [];
    const history = h.slice(-130).filter(p => p && isFinite(p.x) && isFinite(p.y)).map(p => [Math.round(p.x), Math.round(p.y * 10) / 10]);
    return json({ fear_and_greed: {
      score: fg.score, rating: fg.rating, timestamp: fg.timestamp,
      previous_close: fg.previous_close, previous_1_week: fg.previous_1_week,
      previous_1_month: fg.previous_1_month, previous_1_year: fg.previous_1_year,
    }, indicators, history }, 200, 'public, max-age=900');
  } catch (e) {
    return json({ error: 'CNN injoignable : ' + errText(e) }, 502, 'no-store');
  }
}

async function news() {
  const results = await Promise.all(FEEDS.map(async feed => {
    try {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(7000), cf: { cacheTtl: 180, cacheEverything: true },
      });
      if (!r.ok) return { feed, items: [], error: 'HTTP ' + r.status };
      const items = parseFeed(await r.text(), feed);
      return { feed, items, error: items.length ? '' : 'aucun article lisible' };
    } catch (e) {
      return { feed, items: [], error: errText(e) };
    }
  }));
  const items = mergeNews(results.map(r => r.items), { limit: 160, maxAgeDays: 5 });
  const feeds = results.map(r => ({ id: r.feed.id, name: r.feed.name, ok: !r.error, count: r.items.length, error: r.error }));
  if (!items.length) return json({ error: 'Aucun flux n\'a répondu', feeds }, 502, 'no-store');
  return json({ items, feeds, at: Date.now() }, 200, 'public, max-age=180');
}

let mfxSession = null;   // session de l'API officielle, gardée en mémoire du Worker
async function mfxApi(env) {
  const base = 'https://www.myfxbook.com/api/';
  const get = async path => { const r = await fetch(base + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) }); return r.json(); };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!mfxSession) {
      const l = await get('login.json?email=' + encodeURIComponent(env.MYFXBOOK_EMAIL) + '&password=' + encodeURIComponent(env.MYFXBOOK_PASSWORD));
      if (!l || l.error || !l.session) throw new Error('connexion Myfxbook refusée');
      mfxSession = l.session;
    }
    const o = await get('get-community-outlook.json?session=' + mfxSession);
    if (o && !o.error) return outlookFromApi(o);
    mfxSession = null;   // session expirée : on se reconnecte une fois
  }
  throw new Error('API Myfxbook : session refusée');
}
async function mfxWidget(debug) {
  const headers = { 'User-Agent': UA, 'Referer': 'https://www.myfxbook.com/', 'Accept': 'text/html,application/xhtml+xml,*/*' };
  const trail = [];
  let page = '';
  try {
    const s = await fetch('https://widgets.myfxbook.com/scripts/fxOutlook.js?type=1', { headers, signal: AbortSignal.timeout(8000) });
    trail.push('script HTTP ' + s.status);
    if (s.ok) { const js = await s.text(); page = widgetUrlFromScript(js); if (debug) debug.script = js.slice(0, 1500); }
  } catch (e) { trail.push('script : ' + errText(e)); }
  if (!page) page = 'https://widgets.myfxbook.com/widgets/outlook.html?type=1';
  if (debug) { debug.page = page; debug.trail = trail; }
  let r;
  try { r = await fetch(page, { headers, signal: AbortSignal.timeout(9000) }); }
  catch (e) { trail.push('page : ' + errText(e)); throw new Error('widget Myfxbook injoignable : ' + errText(e)); }
  trail.push('page HTTP ' + r.status);
  if (!r.ok) throw new Error('widget Myfxbook : HTTP ' + r.status);
  const html = await r.text();
  if (debug) { debug.length = html.length; debug.text = cleanText(html).slice(0, 3000); debug.html = html.slice(0, 3000); }
  return parseOutlookHtml(html);
}
async function dmx(env, wantDebug) {
  const debug = wantDebug ? {} : null;
  const errors = [];
  if (env.MYFXBOOK_EMAIL && env.MYFXBOOK_PASSWORD) {
    try {
      const pairs = await mfxApi(env);
      if (pairs.length) return json({ pairs, source: 'api', at: Date.now() }, 200, 'public, max-age=600');
      errors.push('API Myfxbook : réponse vide');
    } catch (e) { errors.push(errText(e)); }
  }
  try {
    const pairs = await mfxWidget(debug);
    if (debug) return json({ pairs, errors, debug }, 200, 'no-store');
    if (pairs.length >= 3) return json({ pairs, source: 'widget', at: Date.now() }, 200, 'public, max-age=600');
    errors.push('widget Myfxbook : page reçue mais positions illisibles');
  } catch (e) { errors.push(errText(e)); }
  return json(Object.assign({ error: errors.join(' · ') }, debug ? { debug } : {}), 502, 'no-store');
}

/* Polymarket : son API refuse les appels venant d'une page web, on la relaie.
   On interroge plusieurs rubriques ; celles qui ne répondent pas sont ignorées. */
const PM = 'https://gamma-api.polymarket.com';
const PM_TAGS = ['fed-rates', 'fed', 'economy', 'economic-policy', 'geopolitics', 'world', 'trade-war', 'politics'];
const pmMarket = m => ({ id: m.id, question: m.question, groupItemTitle: m.groupItemTitle, outcomes: m.outcomes, outcomePrices: m.outcomePrices,
  clobTokenIds: m.clobTokenIds, oneDayPriceChange: m.oneDayPriceChange, volume24hr: m.volume24hr, closed: m.closed, active: m.active });
const pmEvent = (e, tag) => ({ id: e.id, slug: e.slug, title: e.title, endDate: e.endDate, volume24hr: e.volume24hr, tag,
  markets: (Array.isArray(e.markets) ? e.markets : []).slice(0, 30).map(pmMarket) });
async function polymarket(wantDebug) {
  const trail = [];
  const get = async (label, path) => {
    try {
      const r = await fetch(PM + path, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 300, cacheEverything: true } });
      if (!r.ok) { trail.push(label + ' : HTTP ' + r.status); return []; }
      const j = await r.json(); const a = Array.isArray(j) ? j : [];
      trail.push(label + ' : ' + a.length); return a;
    } catch (e) { trail.push(label + ' : ' + errText(e)); return []; }
  };
  const lists = await Promise.all(PM_TAGS.map(t => get(t, '/events?closed=false&active=true&limit=15&order=volume24hr&ascending=false&tag_slug=' + t)
    .then(a => a.map(e => pmEvent(e, t)))));
  const top = await get('markets', '/markets?closed=false&active=true&limit=60&order=volume24hr&ascending=false');
  const seen = new Set(), events = [];
  for (const list of lists) for (const e of list) { if (!e.id || seen.has(e.id)) continue; seen.add(e.id); events.push(e); }
  const body = { events, markets: top.map(pmMarket), at: Date.now() };
  if (wantDebug) body.debug = trail;
  if (!events.length && !top.length) return json(Object.assign({ error: 'Polymarket ne répond pas (' + trail.join(' · ') + ')' }, wantDebug ? { debug: trail } : {}), 502, 'no-store');
  return json(body, 200, 'public, max-age=300');
}
async function polymarketHistory(market) {
  if (!/^\d{6,90}$/.test(market || '')) return json({ error: 'Identifiant de marché invalide' }, 400, 'no-store');
  try {
    const r = await fetch('https://clob.polymarket.com/prices-history?market=' + market + '&interval=max&fidelity=720', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 1800, cacheEverything: true } });
    if (!r.ok) return json({ error: 'Polymarket (historique) : HTTP ' + r.status }, 502, 'no-store');
    const j = await r.json();
    return json({ history: Array.isArray(j.history) ? j.history : [] }, 200, 'public, max-age=1800');
  } catch (e) { return json({ error: 'Polymarket (historique) : ' + errText(e) }, 502, 'no-store'); }
}

/* Calendrier économique : fichiers hebdomadaires de ForexFactory (sans clé).
   Ils demandent de ne pas les solliciter souvent : réponse gardée une heure. */
const FF = { thisweek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', nextweek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json' };
/* Seconde source si ForexFactory ne répond pas : le calendrier public de TradingView
   (non documenté ; il donne aussi le chiffre publié). */
const TV_CAL_COUNTRIES = { US: 'USD', EU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CN: 'CNY' };
const calFmt = (v, unit, scale) => (v == null || v === '' ? '' : String(v) + (scale || '') + (unit || ''));
async function calendarTradingView(trail) {
  const now = new Date(), day = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)));
  const nextMonday = monday.getTime() + 7 * 864e5, end = new Date(monday.getTime() + 14 * 864e5);
  const url = 'https://economic-calendar.tradingview.com/events?from=' + monday.toISOString() + '&to=' + end.toISOString() + '&countries=' + Object.keys(TV_CAL_COUNTRIES).join(',');
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/', 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000), cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) { trail.push('tradingview : HTTP ' + r.status); return []; }
    const j = await r.json(); const list = Array.isArray(j && j.result) ? j.result : [];
    const out = [];
    list.forEach(e => {
      const ms = Date.parse(e.date); if (!isFinite(ms) || !e.title) return;
      out.push({ t: Math.floor(ms / 1000), week: ms < nextMonday ? 'thisweek' : 'nextweek', ccy: TV_CAL_COUNTRIES[e.country] || String(e.currency || e.country || ''), title: String(e.title),
        impact: e.importance >= 1 ? 'high' : e.importance === 0 ? 'medium' : 'low',
        forecast: calFmt(e.forecast, e.unit, e.scale), previous: calFmt(e.previous, e.unit, e.scale), actual: calFmt(e.actual, e.unit, e.scale) });
    });
    trail.push('tradingview : ' + out.length); return out;
  } catch (e) { trail.push('tradingview : ' + errText(e)); return []; }
}
async function calendar(wantDebug) {
  const trail = []; let events = [], source = 'ForexFactory';
  await Promise.all(Object.entries(FF).map(async ([week, url]) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 3600, cacheEverything: true } });
      if (!r.ok) { trail.push(week + ' : HTTP ' + r.status); return; }
      const text = await r.text(); let j;
      try { j = JSON.parse(text); } catch (e) { trail.push(week + ' : réponse non JSON (' + text.slice(0, 80).replace(/\s+/g, ' ') + ')'); return; }
      let n = 0;
      (Array.isArray(j) ? j : []).forEach(e => {
        const ms = Date.parse(e.date); if (!isFinite(ms) || !e.title) return;
        events.push({ t: Math.floor(ms / 1000), week, ccy: String(e.country || '').toUpperCase(), title: String(e.title), impact: String(e.impact || '').toLowerCase(),
          forecast: e.forecast || '', previous: e.previous || '', actual: e.actual || '' }); n++;
      });
      trail.push(week + ' : ' + n);
    } catch (e) { trail.push(week + ' : ' + errText(e)); }
  }));
  if (!events.some(e => e.week === 'thisweek')) {
    const tv = await calendarTradingView(trail);
    if (tv.length) { events = tv; source = 'TradingView'; }
  }
  if (!events.length) return json({ error: 'Calendrier indisponible (' + trail.join(' · ') + ')' }, 502, 'no-store');
  events.sort((a, b) => a.t - b.t);
  return json(Object.assign({ events: wantDebug ? events.slice(0, 5) : events, source, sources: trail, at: Date.now() }), 200, wantDebug ? 'no-store' : 'public, max-age=1800');
}
/* ---------- Rendements souverains et pétrole (sources officielles, sans clé) ---------- */
const dayAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
function csvRows(text) {   // découpe un CSV en tenant compte des guillemets
  return String(text || '').split(/\r?\n/).filter(l => l.trim()).map(line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out.map(x => x.trim());
  });
}
async function getText(url, headers) {
  const r = await fetch(url, { headers: Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, headers || {}), signal: AbortSignal.timeout(9000), cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
/* FRED, export CSV public : une colonne de dates puis une colonne par série. */
async function fredSeries(ids, days) {
  const rows = csvRows(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + ids.join(',') + '&cosd=' + dayAgo(days)));
  const head = rows[0] || [], out = {};
  ids.forEach(id => {
    const col = head.indexOf(id); out[id] = [];
    if (col < 0) return;
    rows.slice(1).forEach(r => { const v = parseFloat(r[col]); if (/^\d{4}-\d{2}-\d{2}$/.test(r[0]) && isFinite(v)) out[id].push([r[0], v]); });
  });
  return out;
}
const RATE_SOURCES = {
  USD: async () => { const f = await fredSeries(['DGS2', 'DGS10'], 75); return { src: 'Trésor américain (FRED)', y2: f.DGS2, y10: f.DGS10 }; },
  EUR: async () => {
    const rows = csvRows(await getText('https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y+SR_10Y?lastNObservations=45&format=csvdata', { 'Accept': 'text/csv' }));
    const head = rows[0] || [], iT = head.indexOf('TIME_PERIOD'), iV = head.indexOf('OBS_VALUE');
    if (iT < 0 || iV < 0) throw new Error('colonnes absentes');
    const pick = tag => rows.slice(1).filter(r => r.some(c => c === tag || c.endsWith('.' + tag))).map(r => [r[iT], parseFloat(r[iV])]).filter(p => isFinite(p[1])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { src: 'BCE (courbe des emprunts AAA de la zone euro)', y2: pick('SR_2Y'), y10: pick('SR_10Y') };
  },
  CAD: async () => {
    const j = JSON.parse(await getText('https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.10YR.DQ.YLD/json?recent=45', { 'Accept': 'application/json' }));
    const obs = (Array.isArray(j.observations) ? j.observations : []).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
    const pick = k => obs.map(o => [o.d, parseFloat(o[k] && o[k].v)]).filter(p => isFinite(p[1]));
    return { src: 'Banque du Canada', y2: pick('BD.CDN.2YR.DQ.YLD'), y10: pick('BD.CDN.10YR.DQ.YLD') };
  },
  JPY: async () => {
    const rows = csvRows(await getText('https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv'));
    const hi = rows.findIndex(r => r.includes('2Y') && r.includes('10Y')); if (hi < 0) throw new Error('en-tête absent');
    const i2 = rows[hi].indexOf('2Y'), i10 = rows[hi].indexOf('10Y');
    const iso = d => { const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(d); return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : ''; };
    const pick = i => rows.slice(hi + 1).map(r => [iso(r[0]), parseFloat(r[i])]).filter(p => p[0] && isFinite(p[1]));
    return { src: 'Ministère des Finances du Japon (mois en cours)', y2: pick(i2), y10: pick(i10) };
  },
};
async function rates() {
  const out = {}, trail = [];
  await Promise.all(Object.entries(RATE_SOURCES).map(async ([ccy, fn]) => {
    try {
      const r = await fn();
      if (!r.y10.length && !r.y2.length) throw new Error('aucune observation');
      out[ccy] = { src: r.src, y2: r.y2.slice(-45), y10: r.y10.slice(-45) }; trail.push(ccy + ' : ' + r.y10.length + ' obs.');
    } catch (e) { trail.push(ccy + ' : ' + errText(e)); }
  }));
  let oil = null;
  try {
    const [w, p] = await Promise.all([fredSeries(['WCESTUS1'], 400), fredSeries(['DCOILWTICO'], 75)]);
    if (w.WCESTUS1.length) { oil = { stocks: w.WCESTUS1.slice(-56), wti: p.DCOILWTICO.slice(-45), src: 'EIA (via FRED)' }; trail.push('pétrole : ' + w.WCESTUS1.length + ' semaines'); }
    else trail.push('pétrole : aucune observation');
  } catch (e) { trail.push('pétrole : ' + errText(e)); }
  if (!Object.keys(out).length && !oil) return json({ error: 'Rendements indisponibles (' + trail.join(' · ') + ')', sources: trail }, 502, 'no-store');
  return json({ yields: out, oil, sources: trail, at: Date.now() }, 200, 'public, max-age=7200');
}

/* ---------- Tension géopolitique : volume d'articles par thème (GDELT, sans clé) ---------- */
const GDELT_THEMES = [
  { id: 'conflits', label: 'Conflits armés', q: '(war OR airstrike OR invasion OR "military strike")' },
  { id: 'ukraine', label: 'Russie – Ukraine', q: 'ukraine russia (war OR strike OR ceasefire OR offensive)' },
  { id: 'moyen-orient', label: 'Moyen-Orient', q: '(israel OR iran OR gaza OR hezbollah) (strike OR war OR attack)' },
  { id: 'chine', label: 'Chine – Taïwan', q: 'taiwan china (military OR blockade OR drills OR tension)' },
  { id: 'commerce', label: 'Guerre commerciale', q: '(tariffs OR "trade war" OR sanctions)' },
];
async function gdelt() {
  const themes = [], trail = [];
  for (let i = 0; i < GDELT_THEMES.length; i++) {
    const th = GDELT_THEMES[i];
    if (i) await new Promise(res => setTimeout(res, 5500));   // GDELT demande une requête toutes les 5 secondes au plus
    try {
      const text = await getText('https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent(th.q) + '&mode=timelinevol&timespan=3m&timelinesmooth=3&format=json');
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error(text.slice(0, 70).replace(/\s+/g, ' ')); }
      const data = j && Array.isArray(j.timeline) && j.timeline[0] && Array.isArray(j.timeline[0].data) ? j.timeline[0].data : [];
      const byDay = new Map();
      data.forEach(p => { const d = String(p.date || '').slice(0, 8), v = +p.value; if (/^\d{8}$/.test(d) && isFinite(v)) { const x = byDay.get(d) || [0, 0]; x[0] += v; x[1]++; byDay.set(d, x); } });
      const series = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([d, x]) => [d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6), Math.round(x[0] / x[1] * 1e4) / 1e4]);
      if (series.length < 10) throw new Error('série trop courte (' + series.length + ')');
      themes.push({ id: th.id, label: th.label, series }); trail.push(th.id + ' : ' + series.length + ' j');
    } catch (e) { trail.push(th.id + ' : ' + errText(e)); }
  }
  if (!themes.length) return json({ error: 'GDELT ne répond pas (' + trail.join(' · ') + ')', sources: trail }, 502, 'no-store');
  return json({ themes, sources: trail, at: Date.now() }, 200, 'public, max-age=21600');
}

/* ---------- Dernières statistiques publiées, tirées du calendrier (planisphère) ---------- */
const MACRO_COUNTRIES = { US: 'USD', EU: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
const MACRO_PICK = [
  ['cpi', /^(Inflation Rate YoY( Flash| Prel| Final)?|Monthly CPI Indicator)$/i],
  ['core', /^Core Inflation Rate YoY( Flash| Prel| Final)?$/i],
  ['unemp', /^Unemployment Rate( Prel| Final)?$/i],
  ['gdp', /^GDP Growth Rate QoQ( Adv| Prel| Final| Flash| 2nd Est| 3rd Est)?$/i],
  ['retail', /^Retail Sales MoM( Adv| Prel| Final)?$/i],
  ['ism', /^ISM Manufacturing PMI$/i],
  ['isms', /^ISM (Services|Non-Manufacturing) PMI$/i],
  ['pmi', /^((S&P Global|HCOB|au Jibun Bank|Jibun Bank|Judo Bank|procure\.ch) )?Manufacturing PMI( Flash| Final)?$|^Business ?NZ PMI$/i],
  ['pmis', /^((S&P Global|HCOB|au Jibun Bank|Jibun Bank|Judo Bank|procure\.ch) )?Services PMI( Flash| Final)?$|^Business ?NZ (PSI|Services Index)$/i],
  ['pmic', /^((S&P Global|HCOB|au Jibun Bank|Jibun Bank|Judo Bank) )?Composite PMI( Flash| Final)?$/i],
];
/* Décisions de taux : le code TradingView est plus sûr que l'intitulé (la Fed, la BoE, la BoJ
   et la BoC sont publiées sous le seul titre « Interest Rate »). BCE : taux de dépôt et taux refi. */
function macroKey(e) {
  const tk = String(e.ticker || ''), t = String(e.title || '');
  if (tk === 'ECONOMICS:EUDIR') return 'rate';
  if (tk === 'ECONOMICS:EUINTR') return 'rateMro';
  if (/^ECONOMICS:(US|GB|JP|CA|AU|NZ|CH)INTR$/.test(tk)) return 'rate';
  if (tk === 'ECONOMICS:USBCOI') return 'ism';
  if (!tk) {
    if (e.country === 'EU') { if (/^Deposit Facility Rate$/i.test(t)) return 'rate'; if (/^ECB Interest Rate Decision$/i.test(t)) return 'rateMro'; }
    else if (/^(Interest Rate|.*Interest Rate Decision)$/i.test(t)) return 'rate';
  }
  const hit = MACRO_PICK.find(([, re]) => re.test(t)); return hit ? hit[0] : null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function macroPeriod(e, key) {   // période de référence d'une publication → « 2026-10 » ou « 2026-Q3 »
  const rel = new Date(e.date);
  if (key === 'rate' || key === 'rateMro') return rel.toISOString().slice(0, 7);
  const ref = e.referenceDate && isFinite(Date.parse(e.referenceDate)) ? new Date(e.referenceDate) : null;
  const p = String(e.period || '').trim();
  const q = /^Q([1-4])$/i.exec(p);
  if (q) { const y = ref ? ref.getUTCFullYear() : (rel.getUTCMonth() + 1 < (+q[1]) * 3 - 1 ? rel.getUTCFullYear() - 1 : rel.getUTCFullYear()); return y + '-Q' + q[1]; }
  if (ref) return ref.toISOString().slice(0, 7);
  const m = MONTHS[p.slice(0, 3).toLowerCase()];
  if (m) { const y = m > rel.getUTCMonth() + 1 ? rel.getUTCFullYear() - 1 : rel.getUTCFullYear(); return y + '-' + String(m).padStart(2, '0'); }
  return '';
}
/* Le calendrier TradingView tronque les longues périodes : on le lit par tranches de 15 jours. */
async function tvEvents(days, span) {
  const end = Date.now(), parts = [];
  for (let t = end - days * 864e5; t < end; t += span * 864e5) parts.push([t, Math.min(end, t + span * 864e5)]);
  const res = await Promise.all(parts.map(async ([a, b]) => {
    const url = 'https://economic-calendar.tradingview.com/events?from=' + new Date(a).toISOString() + '&to=' + new Date(b).toISOString() + '&countries=' + Object.keys(MACRO_COUNTRIES).join(',');
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/', 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000), cf: { cacheTtl: 3600, cacheEverything: true } });
      if (!r.ok) return { err: 'HTTP ' + r.status };
      const j = await r.json(); return { list: Array.isArray(j && j.result) ? j.result : [] };
    } catch (e) { return { err: errText(e) }; }
  }));
  const seen = new Set(), list = [];
  res.forEach(x => (x.list || []).forEach(e => { const k = e.id || (e.country + '|' + e.title + '|' + e.date); if (!seen.has(k)) { seen.add(k); list.push(e); } }));
  return { list, parts: res.map(x => (x.list ? x.list.length : x.err)) };
}
/* PMI S&P Global / HCOB : chiffres absents du calendrier TradingView, repris des titres de presse. */
const PMI_NEWS = [['Manufacturing PMI', 'Eurozone OR UK OR Japan'], ['Manufacturing PMI', 'Australia OR Canada OR "S&P Global"'], ['Services PMI', 'Eurozone OR UK OR Japan'],
  ['Services PMI', 'Australia OR Canada OR "S&P Global"'], ['Composite PMI', 'Eurozone OR UK OR Japan'], ['Composite PMI', 'Australia OR Canada OR "S&P Global"']];
async function pmiNews(trail) {
  const out = [];
  await Promise.all(PMI_NEWS.map(async ([kind, where]) => {
    const q = 'intitle:"' + kind + '" (' + where + ') when:75d';
    try {
      const r = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 1800, cacheEverything: true } });
      if (!r.ok) { trail.push(kind + ' (' + where + ') : HTTP ' + r.status); return; }
      const recs = pmiHeadlines(await r.text()); out.push(...recs); trail.push(kind + ' (' + where + ') : ' + recs.length + ' titre(s) retenu(s)');
    } catch (e) { trail.push(kind + ' (' + where + ') : ' + errText(e)); }
  }));
  return out;
}
async function macro(wantDebug) {
  const pmiTrail = [], [tv, news] = await Promise.all([tvEvents(120, 15), pmiNews(pmiTrail)]);
  if (!tv.list.length && !news.length) return json({ error: 'Calendrier TradingView : ' + tv.parts.join(' · '), pmi: pmiTrail }, 502, 'no-store');
  // candidats par indicateur / devise / période ; à période égale : calendrier > presse, définitif > provisoire, puis le plus récent
  const cand = {}; let used = 0;
  const put = (key, ccy, p, x) => {
    const slot = ((cand[key] = cand[key] || {})[ccy] = cand[key][ccy] || {}), cur = slot[p];
    if (cur && (cur.rank > x.rank || (cur.rank === x.rank && (cur.prelim < x.prelim || (cur.prelim === x.prelim && cur.rel >= x.rel))))) return;
    slot[p] = x;
  };
  tv.list.forEach(e => {
    const ccy = MACRO_COUNTRIES[e.country], v = typeof e.actual === 'number' ? e.actual : parseFloat(e.actual);
    if (!ccy || !isFinite(v) || !e.title || !isFinite(Date.parse(e.date))) return;
    const key = macroKey(e); if (!key) return;
    const p = macroPeriod(e, key); if (!p) return;
    const prev = typeof e.previous === 'number' ? e.previous : parseFloat(e.previous);
    put(key, ccy, p, { v, title: String(e.title), rel: new Date(e.date).toISOString(), rank: 2, prelim: /\b(Flash|Prel|Adv|Preliminary)\b/i.test(e.title) ? 1 : 0,
      src: 'calendrier TradingView', ticker: e.ticker || '', prev: isFinite(prev) ? prev : null });
    used++;
  });
  news.forEach(x => { put(x.key, x.ccy, x.p, { v: x.v, title: x.title, rel: x.rel, rank: 1, prelim: x.prelim ? 1 : 0, src: 'presse (' + x.source + ')' }); used++; });
  const indicators = {};
  Object.entries(cand).forEach(([key, byCcy]) => Object.entries(byCcy).forEach(([ccy, byP]) => {
    const ps = Object.keys(byP).sort(), last = byP[ps[ps.length - 1]];
    (indicators[key] = indicators[key] || {})[ccy] = { p: ps[ps.length - 1], v: last.v, title: last.title, rel: last.rel, src: last.src, prelim: !!last.prelim,
      prev: last.prev == null ? undefined : last.prev, prev0: byP[ps[0]].prev == null ? undefined : byP[ps[0]].prev, ticker: last.ticker || undefined, hist: ps.map(p => [p, byP[p].v]) };
  }));
  const body = { indicators, events: tv.list.length, sources: { tradingview: tv.parts, pmi: pmiTrail }, at: Date.now() };
  if (wantDebug) {
    const count = {}; tv.list.forEach(e => { const k = e.country + ' | ' + e.title + (e.ticker ? ' | ' + e.ticker : '') + (e.actual == null ? ' | sans chiffre' : ''); count[k] = (count[k] || 0) + 1; });
    body.debug = { titles: Object.keys(count).filter(k => /inflation|cpi|unemploy|employment|gdp|retail|pmi|psi|interest rate|deposit/i.test(k)).sort(), pmiHeadlines: news.map(x => x.ccy + ' ' + x.key + ' ' + x.p + ' = ' + x.v + (x.prelim ? ' (flash)' : '') + ' ← ' + x.title) };
  }
  if (!used && !wantDebug) return json({ error: 'Aucune statistique reconnue dans le calendrier (' + tv.list.length + ' publications lues)' }, 502, 'no-store');
  return json(body, 200, wantDebug ? 'no-store' : 'public, max-age=10800');
}

/* ---------- Historique quotidien d'actifs hors devises (saisonnalité) ----------
   Plusieurs sources gratuites, essayées dans l'ordre ; on garde la première qui renvoie
   au moins trois ans de clôtures à jour. Depuis 1999, comme les fixings BCE. */
const HIST_ASSETS = {
  btc: { label: 'BTC/USD', yahoo: 'BTC-USD', stooq: 'btcusd', fred: 'CBBTCUSD' },
  spx: { label: 'S&P 500', yahoo: '^GSPC', stooq: '^spx', fred: 'SP500' },
  ndx: { label: 'Nasdaq 100', yahoo: '^NDX', stooq: '^ndx', fred: 'NASDAQ100' },
  xau: { label: 'XAU/USD', yahoo: 'GC=F', stooq: 'xauusd', lbma: true },
};
const HIST_FROM = '1999-01-01';
async function histYahoo(sym) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?period1=915148800&period2=' + Math.floor(Date.now() / 1000) + '&interval=1d&events=history&includeAdjustedClose=false';
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000), cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(), res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || 'réponse vide');
  const ts = res.timestamp || [], close = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const off = (res.meta && +res.meta.gmtoffset) || 0;   // date locale de la séance
  return ts.map((t, i) => [new Date((t + off) * 1000).toISOString().slice(0, 10), close[i]]);
}
async function histStooq(sym) {
  const text = await getText('https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym) + '&i=d&d1=' + HIST_FROM.replace(/-/g, '') + '&d2=' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const rows = csvRows(text); if (!rows.length || !/^date$/i.test(rows[0][0])) throw new Error('réponse non CSV (' + text.slice(0, 60).replace(/\s+/g, ' ') + ')');
  const ci = rows[0].findIndex(h => /^close$/i.test(h)); if (ci < 0) throw new Error('colonne Close absente');
  return rows.slice(1).map(r => [r[0], parseFloat(r[ci])]);
}
async function histFred(id) {
  const rows = csvRows(await getText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id + '&cosd=' + HIST_FROM));
  if (!rows.length || rows[0].length < 2) throw new Error('réponse non CSV');
  return rows.slice(1).map(r => [r[0], parseFloat(r[1])]);
}
async function histLbma() {
  const r = await fetch('https://prices.lbma.org.uk/json/gold_pm.json', { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000), cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const a = await r.json(); if (!Array.isArray(a)) throw new Error('réponse inattendue');
  return a.map(x => [String(x && x.d || ''), x && Array.isArray(x.v) ? +x.v[0] : NaN]);
}
function histClean(rows) {
  const by = new Map();
  (rows || []).forEach(([d, v]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= HIST_FROM && isFinite(v) && v > 0) by.set(d, Math.round(v * 100) / 100); });
  const dates = [...by.keys()].sort(); return { dates, p: dates.map(d => by.get(d)) };
}
async function history(asset, wantDebug) {
  const A = HIST_ASSETS[asset]; if (!A) return json({ error: 'Actif inconnu (btc, spx, ndx, xau)' }, 400, 'no-store');
  const tries = [];
  if (A.yahoo) tries.push(['Yahoo Finance', () => histYahoo(A.yahoo)]);
  if (A.lbma) tries.push(['LBMA (fixing de l\'après-midi)', histLbma]);
  if (A.stooq) tries.push(['Stooq', () => histStooq(A.stooq)]);
  if (A.fred) tries.push(['FRED (' + A.fred + ')', () => histFred(A.fred)]);
  const trail = []; let best = null;
  for (const [name, fn] of tries) {
    try {
      const s = histClean(await fn()), last = s.dates[s.dates.length - 1] || '';
      const fresh = last && (Date.now() - Date.parse(last)) / 864e5 < 10;
      trail.push(name + ' : ' + s.dates.length + ' jours' + (last ? ', dernier ' + last : '') + (s.dates.length && !fresh ? ' (pas à jour)' : ''));
      if (s.dates.length >= 750 && (!best || (fresh && !best.fresh) || (fresh === best.fresh && s.dates.length > best.s.dates.length * 1.5))) best = { name, s, fresh };
      if (best && best.fresh && best.name === name) break;
    } catch (e) { trail.push(name + ' : ' + errText(e)); }
  }
  if (!best) return json({ error: 'Historique indisponible (' + trail.join(' · ') + ')', sources: trail }, 502, 'no-store');
  const body = { asset, label: A.label, source: best.name, sources: trail, at: Date.now() };
  if (wantDebug) Object.assign(body, { count: best.s.dates.length, first: [best.s.dates[0], best.s.p[0]], last: [best.s.dates.at(-1), best.s.p.at(-1)] });
  else Object.assign(body, { dates: best.s.dates, p: best.s.p });
  return json(body, 200, wantDebug ? 'no-store' : 'public, max-age=21600');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
      if (url.pathname === '/api/feargreed') return fearGreed();
      if (url.pathname === '/api/news') return cached(request, ctx, news);
      if (url.pathname === '/api/dmx') return url.searchParams.has('debug') ? dmx(env, true) : cached(request, ctx, () => dmx(env, false));
      if (url.pathname === '/api/polymarket') return url.searchParams.has('debug') ? polymarket(true) : cached(request, ctx, () => polymarket(false));
      if (url.pathname === '/api/polymarket/history') return cached(request, ctx, () => polymarketHistory(url.searchParams.get('market')));
      if (url.pathname === '/api/calendar') return url.searchParams.has('debug') ? calendar(true) : cached(request, ctx, () => calendar(false));
      if (url.pathname === '/api/rates') return cached(request, ctx, rates);
      if (url.pathname === '/api/gdelt') return cached(request, ctx, gdelt);
      if (url.pathname === '/api/history') return url.searchParams.has('debug') ? history(url.searchParams.get('asset'), true) : cached(request, ctx, () => history(url.searchParams.get('asset'), false));
      if (url.pathname === '/api/macro') return url.searchParams.has('debug') ? macro(true) : cached(request, ctx, () => macro(false));
      return json({ error: 'Route inconnue' }, 404, 'no-store');
    }
    return env.ASSETS.fetch(request);
  },
};
