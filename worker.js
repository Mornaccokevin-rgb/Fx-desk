/* Worker du site Sphinx Alliance.
   Sert les fichiers statiques, plus trois relais sous /api/ pour ce qu'un
   navigateur ne peut pas lire directement (sites qui refusent les appels
   depuis une page web) :
     /api/feargreed  indice Fear & Greed de CNN
     /api/news       flux RSS financiers fusionnés
     /api/dmx        sentiment des particuliers (Myfxbook)
     /api/polymarket marchés de prédiction (Fed, économie, géopolitique)
     /api/calendar   calendrier économique (ForexFactory)
   Aucune clé dans ce fichier. Pour l'API officielle Myfxbook (facultative),
   les identifiants se règlent dans Cloudflare en tant que secrets du Worker
   (MYFXBOOK_EMAIL, MYFXBOOK_PASSWORD), jamais dans le dépôt. */
import { parseFeed, mergeNews, parseOutlookHtml, outlookFromApi, widgetUrlFromScript, cleanText } from './api-lib.mjs';

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
    return json({ fear_and_greed: {
      score: fg.score, rating: fg.rating, timestamp: fg.timestamp,
      previous_close: fg.previous_close, previous_1_week: fg.previous_1_week,
      previous_1_month: fg.previous_1_month, previous_1_year: fg.previous_1_year,
    } }, 200, 'public, max-age=900');
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
      return json({ error: 'Route inconnue' }, 404, 'no-store');
    }
    return env.ASSETS.fetch(request);
  },
};
