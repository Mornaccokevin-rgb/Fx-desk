/* Fonctions pures des routes /api/* du Worker (aucun accès réseau ici :
   elles se testent telles quelles avec Node). */

/* ---------- texte ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', euro: '€', pound: '£', yen: '¥' };
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(+d))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] != null ? ENT[n.toLowerCase()] : m));
}
function safeChar(c) { try { return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; } catch (e) { return ''; } }
export function cleanText(s, max) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t).replace(/\s+/g, ' ').trim();
  if (max && t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

/* ---------- flux RSS / Atom ---------- */
function inner(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function attr(block, tagName, attrName) {
  const m = block.match(new RegExp('<' + tagName + '\\b[^>]*?\\b' + attrName + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
  return m ? decodeEntities(m[1]) : '';
}
function httpUrl(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) ? u : ''; }

/* Renvoie [{title, summary, url, ts (secondes), image, cats[], source}] pour un flux. */
export function parseFeed(xml, feed) {
  const text = String(xml || '').slice(0, 400000);
  const blocks = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks.slice(0, 40)) {
    const title = cleanText(inner(b, 'title'), 220);
    if (!title) continue;
    let url = httpUrl(cleanText(inner(b, 'link')));
    if (!url) url = httpUrl(attr(b, 'link', 'href'));
    if (!url) url = httpUrl(cleanText(inner(b, 'guid')));
    if (!url) continue;
    const rawDate = cleanText(inner(b, 'pubDate') || inner(b, 'dc:date') || inner(b, 'published') || inner(b, 'updated'));
    const ms = Date.parse(rawDate);
    if (!isFinite(ms)) continue;
    const summary = cleanText(inner(b, 'description') || inner(b, 'summary') || inner(b, 'content:encoded') || inner(b, 'content'), 300);
    const image = httpUrl(attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || (/<enclosure\b[^>]*type=["']image/i.test(b) ? attr(b, 'enclosure', 'url') : ''));
    const cats = (b.match(/<category\b[^>]*>[\s\S]*?<\/category>/gi) || []).map(c => cleanText(c, 40)).filter(Boolean).slice(0, 6);
    let source = feed && feed.name || '';
    let headline = title;
    const src = cleanText(inner(b, 'source'), 60);
    if (feed && feed.aggregator && src) {            // Google News : « Titre - Source »
      source = src;
      const tail = ' - ' + src;
      if (headline.endsWith(tail)) headline = headline.slice(0, -tail.length);
    }
    out.push({ title: headline, summary: summary === headline ? '' : summary, url, ts: Math.floor(ms / 1000), image, cats, source });
  }
  return out;
}

/* Fusionne plusieurs flux : dédoublonnage par titre, tri du plus récent au plus ancien. */
export function mergeNews(lists, opts) {
  const maxAgeS = (opts && opts.maxAgeDays || 5) * 86400, now = Math.floor((opts && opts.now || Date.now()) / 1000);
  const seen = new Set(), all = [];
  for (const list of lists) for (const a of list) {
    if (a.ts > now + 3600 || now - a.ts > maxAgeS) continue;
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 70);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    all.push(a);
  }
  all.sort((x, y) => y.ts - x.ts);
  return all.slice(0, opts && opts.limit || 160).map((a, i) => Object.assign({ id: a.ts + '-' + i }, a));
}

/* ---------- Myfxbook : sentiment communautaire ---------- */
const SYMBOL_RE = /^(?:[A-Z]{6}|XAUUSD|XAGUSD|XAUEUR|[A-Z]{3}\/[A-Z]{3})$/;
function num(s) { const v = parseFloat(String(s || '').replace(/[, \u00a0]/g, '')); return isFinite(v) ? v : null; }

/* Réponse de l'API officielle (get-community-outlook.json). */
export function outlookFromApi(j) {
  const list = j && Array.isArray(j.symbols) ? j.symbols : [];
  return list.map(s => ({
    symbol: String(s.name || '').toUpperCase().replace('/', ''),
    longPct: num(s.longPercentage), shortPct: num(s.shortPercentage),
    longVol: num(s.longVolume), shortVol: num(s.shortVolume),
    longPos: num(s.longPositions), shortPos: num(s.shortPositions),
    avgLong: num(s.avgLongPrice), avgShort: num(s.avgShortPrice),
  })).filter(p => p.symbol && p.longPct != null && p.shortPct != null);
}

/* Page du widget public (widgets.myfxbook.com/widgets/outlook.html?type=1).
   Elle pèse ~2,6 Mo, presque uniquement des blancs, et le détail de chaque
   paire est rangé dans une infobulle. Une fois les balises retirées, chaque
   paire donne une phrase régulière, relevée sur la vraie page :
     « EURUSD Short 12% 3032.99 Lots 8048 Long 87% 20435.63 Lots 37469
       32% of traders are currently trading EURUSD. "> 1.0955 1.1319 - »
   (vendeurs, acheteurs, popularité, puis prix moyen des ventes et des achats). */
export function parseOutlookText(text) {
  const re = /([A-Z0-9]{3,12})\s+Short\s+(\d{1,3}(?:\.\d+)?)\s*%\s+([\d.,]+)\s+[Ll]ots\s+([\d.,]+)\s+Long\s+(\d{1,3}(?:\.\d+)?)\s*%\s+([\d.,]+)\s+[Ll]ots\s+([\d.,]+)(?:\s+(\d{1,3}(?:\.\d+)?)\s*%\s+of traders are currently trading\s+[A-Z0-9]+\.?)?(?:\s*">\s*([\d.,]+)\s+([\d.,]+))?/g;
  const out = [], done = new Set();
  let m;
  while ((m = re.exec(String(text || '')))) {
    const symbol = m[1], shortPct = num(m[2]), longPct = num(m[5]);
    if (done.has(symbol) || shortPct == null || longPct == null || shortPct + longPct < 90 || shortPct + longPct > 101) continue;
    done.add(symbol);
    const price = v => (num(v) ? String(v) : null);   // gardé tel quel (« 1.4070 ») pour ne pas perdre les décimales à l'affichage
    out.push({
      symbol, longPct, shortPct,
      longVol: num(m[6]), shortVol: num(m[3]), longPos: num(m[7]), shortPos: num(m[4]),
      avgLong: price(m[10]), avgShort: price(m[9]), pop: m[8] != null ? num(m[8]) : null,
    });
  }
  return out;
}
export function parseOutlookHtml(html) {
  const compact = String(html || '').replace(/\s{2,}/g, ' ').slice(0, 3000000);   // d'abord les blancs : le reste travaille sur un texte court
  const pairs = parseOutlookText(cleanText(compact));
  return pairs.length ? pairs : parseOutlookLoose(compact);
}
/* Repli si la page change de forme : pour chaque symbole trouvé dans un nœud
   texte, on cherche dans le fragment qui suit « Short … % » / « Long … % »,
   sinon deux largeurs de barre (width: N%) dont la somme fait 100. */
export function parseOutlookLoose(html) {
  const src = String(html || '');
  const marks = [];
  const re = />\s*([A-Z]{3}\/?[A-Z]{3})\s*</g;
  let m;
  while ((m = re.exec(src))) {
    const sym = m[1].replace('/', '');
    if (SYMBOL_RE.test(sym)) marks.push({ sym, at: m.index });
  }
  const out = [], done = new Set();
  for (let i = 0; i < marks.length; i++) {
    const { sym, at } = marks[i];
    if (done.has(sym)) continue;
    let end = src.length;
    for (let k = i + 1; k < marks.length; k++) if (marks[k].sym !== sym) { end = marks[k].at; break; }
    const frag = src.slice(at, Math.min(end, at + 12000));
    const row = readFragment(frag);
    if (row) { done.add(sym); out.push(Object.assign({ symbol: sym }, row)); }
  }
  return out;
}
function readFragment(frag) {
  const text = cleanText(frag);
  const side = name => {
    const r = new RegExp('\\b' + name + '\\b[^%]{0,60}?(\\d{1,3}(?:[.,]\\d+)?)\\s*%(?:[^%]{0,40}?([\\d.,]+)\\s*lots?)?(?:[^%A-Za-z]{0,20}?([\\d.,]+))?', 'i');
    const x = text.match(r);
    return x ? { pct: num(x[1].replace(',', '.')), vol: x[2] ? num(x[2]) : null, pos: x[3] ? num(x[3]) : null } : null;
  };
  const S = side('Short'), L = side('Long');
  if (S && L && Math.abs(S.pct + L.pct - 100) <= 2.5) {
    return { longPct: L.pct, shortPct: S.pct, longVol: L.vol, shortVol: S.vol, longPos: L.pos, shortPos: S.pos, avgLong: null, avgShort: null };
  }
  const bars = [];
  const wre = /<[^>]*?(class\s*=\s*["'][^"']*["'])?[^>]*?width\s*:\s*(\d{1,3}(?:\.\d+)?)\s*%[^>]*>/gi;
  let w;
  while ((w = wre.exec(frag)) && bars.length < 6) bars.push({ v: parseFloat(w[2]), tag: w[0].toLowerCase() });
  for (let i = 0; i + 1 < bars.length; i++) {
    const a = bars[i], b = bars[i + 1];
    if (Math.abs(a.v + b.v - 100) > 2.5) continue;
    const isShort = t => /danger|red|short|sell|bear/.test(t), isLong = t => /success|green|long|buy|bull/.test(t);
    let shortPct = a.v, longPct = b.v, approx = true;        // Myfxbook affiche les vendeurs à gauche
    if (isLong(a.tag) && !isLong(b.tag) || isShort(b.tag) && !isShort(a.tag)) { longPct = a.v; shortPct = b.v; approx = false; }
    else if (isShort(a.tag) || isLong(b.tag)) approx = false;
    return { longPct, shortPct, longVol: null, shortVol: null, longPos: null, shortPos: null, avgLong: null, avgShort: null, approx };
  }
  return null;
}

/* Adresse de la page que le script du widget insère dans une iframe. */
export function widgetUrlFromScript(js) {
  const m = String(js || '').match(/(?:https?:)?\/\/widgets\.myfxbook\.com\/[^"'\s<>+)]+/i);
  let u = m ? m[0] : '';
  if (!u || /\.js(\?|$)/i.test(u)) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/[?&]type=/.test(u)) u += (u.includes('?') ? (/[?&]$/.test(u) ? '' : '&') : '?') + 'type=1';
  return u;
}

/* ---------- PMI S&P Global / HCOB lus dans les titres de presse ----------
   TradingView ne diffuse plus ces chiffres (licence S&P Global) : on les reprend des
   titres d'articles (« Eurozone HCOB Services PMI rises to 53.6 in November »).
   Lecture stricte : un seul pays suivi en tête du titre, un verbe de publication,
   jamais un titre d'avant-publication (« expected », « preview », « seen »…). */
const PMI_KIND = { manufacturing: 'pmi', services: 'pmis', composite: 'pmic' };
const PMI_PLACE = { 'eurozone': 'EUR', 'euro zone': 'EUR', 'euro area': 'EUR', 'ez': 'EUR', 'uk': 'GBP', 'u.k.': 'GBP', 'britain': 'GBP', 'united kingdom': 'GBP',
  'us': 'USD', 'u.s.': 'USD', 'united states': 'USD', 'japan': 'JPY', 'australia': 'AUD', 'canada': 'CAD' };
const PMI_BRAND = /\b(?:hcob|s&p\s*global(?:\s*\/\s*cips)?|s&p|cips|au\s+jibun\s+bank|jibun\s+bank|judo\s+bank|markit|flash|final|preliminary|prelim|the)(?![a-z])/gi;
const PMI_NOT_YET = /expect|preview|seen|forecast|poll|consensus|estimate[sd]? to|could|likely|ahead|due|set to|eyes|awaits?/i;
const PMI_MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
export function pmiHeadline(title, ms) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t || /preview|week ahead|calendar/i.test(t)) return null;
  const k = /\b(Manufacturing|Services|Composite)\s+PMIs?\b/i.exec(t); if (!k) return null;
  const prefix = t.slice(0, k.index);
  const place = prefix.replace(/[’']s\b/gi, ' ').replace(PMI_BRAND, ' ').replace(/[^a-z.\s]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\.$/, '');
  const ccy = PMI_PLACE[place]; if (!ccy) return null;
  if (ccy === 'USD' && !/s&p/i.test(prefix)) return null;        // aux États-Unis, sans « S&P Global » ce peut être l'ISM
  const rest = t.slice(k.index + k[0].length);
  const m = /^(.{0,60}?)(?:\bto|\bat|\bof|:)\s+(\d{2}(?:\.\d{1,2})?)(?![\d.%])/i.exec(rest); if (!m) return null;
  if (PMI_NOT_YET.test(m[1])) return null;
  const v = +m[2]; if (!(v >= 25 && v <= 75)) return null;
  const mo = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:'s|’s)?\b/.exec(rest); if (!mo) return null;
  const month = PMI_MONTHS[mo[1]], pub = new Date(isFinite(ms) ? ms : Date.now());
  const year = month > pub.getUTCMonth() + 1 + (pub.getUTCDate() > 25 ? 1 : 0) ? pub.getUTCFullYear() - 1 : pub.getUTCFullYear();
  return { ccy, key: PMI_KIND[k[1].toLowerCase()], p: year + '-' + String(month).padStart(2, '0'), v, prelim: /\bflash\b|\bprelim/i.test(t), title: t };
}
/* Titres d'un flux RSS Google News → relevés PMI (titre sans « - Source »). */
export function pmiHeadlines(xml) {
  const blocks = String(xml || '').slice(0, 600000).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const b of blocks.slice(0, 120)) {
    let title = cleanText(inner(b, 'title'), 240); const src = cleanText(inner(b, 'source'), 60);
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    const ms = Date.parse(cleanText(inner(b, 'pubDate')));
    const x = pmiHeadline(title, ms);
    if (x && isFinite(ms)) out.push(Object.assign(x, { rel: new Date(ms).toISOString(), source: src || 'presse' }));
  }
  return out;
}
