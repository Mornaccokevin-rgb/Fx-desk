/* Worker du site Sphinx Alliance : sert les fichiers statiques (assets) et UNE route d'API,
   /api/feargreed, qui relaie l'indice Fear & Greed de CNN (le navigateur ne peut pas l'appeler
   directement : CNN n'autorise pas les requêtes depuis un autre site, et refuse les « robots »
   sans en-têtes de navigateur). Aucune clé, aucune donnée stockée. */
const CNN = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': 'https://www.cnn.com/markets/fear-and-greed',
  'Origin': 'https://www.cnn.com',
  'Accept': 'application/json',
};
const json = (obj, status, cache) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
});

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/feargreed') {
      try {
        const r = await fetch(CNN, { headers: HEADERS, cf: { cacheTtl: 900, cacheEverything: true } });
        if (!r.ok) return json({ error: 'CNN a répondu HTTP ' + r.status }, 502, 'no-store');
        const j = await r.json();
        const fg = j && j.fear_and_greed;
        if (!fg || fg.score == null) return json({ error: 'Réponse CNN inattendue' }, 502, 'no-store');
        return json({ fear_and_greed: { score: fg.score, rating: fg.rating, timestamp: fg.timestamp,
          previous_close: fg.previous_close, previous_1_week: fg.previous_1_week,
          previous_1_month: fg.previous_1_month, previous_1_year: fg.previous_1_year } }, 200, 'public, max-age=900');
      } catch (e) {
        return json({ error: 'CNN injoignable : ' + (e && e.message || e) }, 502, 'no-store');
      }
    }
    return env.ASSETS.fetch(request);
  },
};
