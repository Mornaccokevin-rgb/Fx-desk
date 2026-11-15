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

/* Page du widget public : la structure exacte n'est pas documentée, on lit
   donc de façon tolérante. Pour chaque symbole trouvé dans un nœud texte, on
   cherche dans le fragment qui suit « Short … % » / « Long … % », sinon deux
   largeurs de barre (width: N%) dont la somme fait 100. */
export function parseOutlookHtml(html) {
  const src = String(html || '').slice(0, 1500000);
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
