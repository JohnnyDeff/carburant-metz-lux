/**
 * backend-lux-prices.js
 * ─────────────────────────────────────────────────────────────
 * Backend Node.js — Scraper prix carburant Luxembourg
 *
 * FONCTIONNEMENT :
 *   1. Récupère les prix officiels depuis gouvernement.lu (PDF/page)
 *      + carbu.com/luxembourg (tableau HTML) comme fallback
 *   2. Met en cache le résultat en mémoire (TTL configurable)
 *   3. Expose une API REST simple : GET /api/lux-prices
 *   4. Relance automatiquement le scraping toutes les REFRESH_HOURS heures
 *
 * INSTALLATION :
 *   npm init -y
 *   npm install express node-fetch cheerio
 *
 * LANCEMENT :
 *   node backend-lux-prices.js
 *
 * L'API répond sur http://localhost:3000/api/lux-prices
 *
 * INTÉGRATION DANS LE FRONTEND :
 *   Remplacer le bloc `const luxePrices = { ... }` par :
 *
 *   let luxePrices = null;
 *   async function fetchLuxPrices() {
 *     try {
 *       const r = await fetch('http://localhost:3000/api/lux-prices');
 *       luxePrices = await r.json();
 *     } catch(e) {
 *       console.warn('Backend LU non disponible, fallback hardcodé');
 *       luxePrices = { Diesel:2.005, SP95:1.700, SP98:1.814, GPL:0.930, date_maj:'fallback' };
 *     }
 *     renderLuPrices(); updateSavings();
 *   }
 *   fetchLuxPrices();
 *   setInterval(fetchLuxPrices, 3600000); // refresh toutes les heures
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const express  = require('express');
const fetch    = require('node-fetch');
const cheerio  = require('cheerio');

// ── Config ──────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const REFRESH_HOURS = 6;   // Rafraîchissement toutes les 6h
const CACHE_TTL_MS  = REFRESH_HOURS * 60 * 60 * 1000;

// Fallback en dur si toutes les sources échouent
const FALLBACK_PRICES = {
  Diesel:    2.005,
  SP95:      1.700,
  SP98:      1.814,
  GPL:       0.930,
  date_maj:  'fallback',
  source:    'valeurs codées en dur — scraping échoué',
  is_fallback: true
};

// ── Cache en mémoire ─────────────────────────────────────────
let cache = {
  data:       null,
  fetched_at: null,
  expires_at: null
};

// ── Sources de scraping ──────────────────────────────────────

/**
 * Source 1 : carbu.com/luxembourg
 * Scrape le tableau de prix moyen affiché sur la page.
 */
async function scrapeCarbuCom() {
  const url = 'https://carbu.com/luxembourg/';
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0; +https://example.com)'
  };

  const res = await fetch(url, { headers, timeout: 10000 });
  if (!res.ok) throw new Error(`carbu.com HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const prices = {};

  // carbu.com affiche les prix dans un tableau .prix-carbu ou similaire
  // On cherche les lignes contenant les noms de carburants connus
  const fuelMap = {
    'diesel': 'Diesel',
    'sp95':   'SP95',
    'sp98':   'SP98',
    'e10':    'SP95',    // E10 ≈ SP95 au LU
    'gpl':    'GPL',
    'lpg':    'GPL'
  };

  // Stratégie générique : chercher toutes les cellules contenant un nom de carburant
  $('tr, .fuel-row, [class*="carbu"], [class*="fuel"]').each((_, el) => {
    const text = $(el).text();
    const lower = text.toLowerCase();

    for (const [key, label] of Object.entries(fuelMap)) {
      if (lower.includes(key) && !prices[label]) {
        // Chercher un nombre décimal dans la même ligne (ex: 2.005 ou 2,005)
        const match = text.match(/(\d[,\.]\d{2,3})/g);
        if (match) {
          const val = parseFloat(match[match.length - 1].replace(',', '.'));
          if (val > 0.5 && val < 5) {
            prices[label] = val;
          }
        }
      }
    }
  });

  // Fallback JSON embarqué dans la page (carbu.com injecte parfois du JSON)
  const jsonMatch = html.match(/window\.__STORE__\s*=\s*({.*?});/s)
    || html.match(/var pricesData\s*=\s*({.*?});/s);
  if (jsonMatch) {
    try {
      const store = JSON.parse(jsonMatch[1]);
      // Parcourir récursivement pour trouver des clés de carburant
      const flat = JSON.stringify(store).toLowerCase();
      if (flat.includes('diesel') || flat.includes('sp95')) {
        console.log('[carbu.com] JSON store détecté — parsing avancé nécessaire');
      }
    } catch (_) {}
  }

  if (!Object.keys(prices).length) {
    throw new Error('carbu.com : aucun prix extrait (structure HTML peut-être changée)');
  }

  return prices;
}

/**
 * Source 2 : gouvernement.lu — communiqués prix carburants
 * Le gouvernement LU publie les prix max légaux sous forme de tableau HTML.
 * URL type : https://gouvernement.lu/fr/actualites/toutes_actualites/communiques/2026/03/prix-carburants.html
 * → On construit l'URL dynamiquement en fonction du mois/année courant,
 *   avec fallback sur le mois précédent.
 */
async function scrapeGouvernementLu() {
  const now  = new Date();
  const year = now.getFullYear();
  const months = [
    now.getMonth() + 1,      // mois courant
    now.getMonth() || 12      // mois précédent (fallback)
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
    'Accept-Language': 'fr-FR,fr;q=0.9'
  };

  for (const month of months) {
    const mm = String(month).padStart(2, '0');
    const url = `https://gouvernement.lu/fr/actualites/toutes_actualites/communiques/${year}/${mm}/prix-carburants.html`;

    try {
      const res = await fetch(url, { headers, timeout: 8000 });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      const prices = {};
      const fuelMap = {
        'diesel': 'Diesel', 'gasoil': 'Diesel',
        'essence': 'SP95', 'sp95': 'SP95', 'super 95': 'SP95',
        'sp98': 'SP98', 'super 98': 'SP98',
        'gpl': 'GPL', 'propane': 'GPL', 'butane': 'GPL'
      };

      $('table tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length < 2) return;
        const label = $(cells[0]).text().toLowerCase().trim();
        for (const [key, name] of Object.entries(fuelMap)) {
          if (label.includes(key) && !prices[name]) {
            const priceText = $(cells[cells.length - 1]).text().trim();
            const val = parseFloat(priceText.replace(',', '.').replace(/[^\d.]/g, ''));
            if (val > 0.5 && val < 5) prices[name] = val;
          }
        }
      });

      if (Object.keys(prices).length >= 2) {
        console.log(`[gouvernement.lu] Prix trouvés pour ${mm}/${year} :`, prices);
        return prices;
      }
    } catch (err) {
      console.warn(`[gouvernement.lu] Échec ${url} :`, err.message);
    }
  }

  throw new Error('gouvernement.lu : aucun communiqué trouvé');
}

// ── Orchestration des sources ────────────────────────────────

async function fetchLuxPrices() {
  const now = new Date();
  const date_maj = now.toLocaleDateString('fr-FR');
  const sources = [
    { name: 'gouvernement.lu', fn: scrapeGouvernementLu },
    { name: 'carbu.com',       fn: scrapeCarbuCom       }
  ];

  for (const source of sources) {
    try {
      console.log(`[scraping] Tentative : ${source.name}…`);
      const prices = await source.fn();

      // Valider les données minimales
      if (!prices.Diesel && !prices.SP95) {
        throw new Error('Données insuffisantes (ni Diesel ni SP95)');
      }

      const result = {
        Diesel:    prices.Diesel || null,
        SP95:      prices.SP95   || null,
        SP98:      prices.SP98   || null,
        GPL:       prices.GPL    || null,
        date_maj,
        source:    source.name,
        is_fallback: false,
        fetched_at: now.toISOString()
      };

      console.log(`[scraping] ✓ ${source.name} :`, result);
      return result;
    } catch (err) {
      console.warn(`[scraping] ✗ ${source.name} : ${err.message}`);
    }
  }

  // Toutes les sources ont échoué
  console.error('[scraping] Toutes les sources ont échoué — fallback');
  return { ...FALLBACK_PRICES, fetched_at: now.toISOString() };
}

// ── Gestion du cache ─────────────────────────────────────────

async function getOrRefreshCache() {
  const now = Date.now();

  // Cache encore valide
  if (cache.data && cache.expires_at && now < cache.expires_at) {
    return cache.data;
  }

  // Rafraîchir
  console.log('[cache] Rafraîchissement du cache…');
  const data = await fetchLuxPrices();
  cache = {
    data,
    fetched_at: now,
    expires_at: now + CACHE_TTL_MS
  };
  return data;
}

// ── API Express ──────────────────────────────────────────────

const app = express();

// CORS — autoriser le frontend local/Leaflet à appeler l'API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * GET /api/lux-prices
 * Retourne les prix Luxembourg en JSON.
 *
 * Réponse :
 * {
 *   "Diesel":    2.005,
 *   "SP95":      1.700,
 *   "SP98":      1.814,
 *   "GPL":       0.930,
 *   "date_maj":  "30/03/2026",
 *   "source":    "gouvernement.lu",
 *   "is_fallback": false,
 *   "fetched_at": "2026-03-30T08:00:00.000Z",
 *   "cache_expires_at": "2026-03-30T14:00:00.000Z"
 * }
 */
app.get('/api/lux-prices', async (req, res) => {
  try {
    const data = await getOrRefreshCache();
    res.json({
      ...data,
      cache_expires_at: cache.expires_at ? new Date(cache.expires_at).toISOString() : null
    });
  } catch (err) {
    console.error('[API] Erreur :', err);
    res.status(500).json({ error: 'Erreur interne', details: err.message });
  }
});

/**
 * GET /api/lux-prices/force-refresh
 * Force un rechargement immédiat (utile en dev ou après un communiqué officiel).
 */
app.get('/api/lux-prices/force-refresh', async (req, res) => {
  cache.expires_at = 0; // Invalider le cache
  try {
    const data = await getOrRefreshCache();
    res.json({ message: 'Cache rafraîchi', ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/health
 * Vérification de l'état du backend.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    cache_age_minutes: cache.fetched_at
      ? Math.round((Date.now() - cache.fetched_at) / 60000)
      : null,
    cache_expires_at: cache.expires_at
      ? new Date(cache.expires_at).toISOString()
      : null,
    source: cache.data?.source || null,
    is_fallback: cache.data?.is_fallback ?? null
  });
});

// ── Démarrage ────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n⛽  Backend carburant Luxembourg démarré`);
  console.log(`   API : http://localhost:${PORT}/api/lux-prices`);
  console.log(`   Santé : http://localhost:${PORT}/api/health\n`);

  // Pré-charger le cache au démarrage
  try {
    await getOrRefreshCache();
    console.log('[init] Cache pré-chargé avec succès.');
  } catch (err) {
    console.warn('[init] Échec pré-chargement :', err.message);
  }

  // Rafraîchissement automatique
  setInterval(async () => {
    try {
      cache.expires_at = 0;
      await getOrRefreshCache();
      console.log('[auto-refresh] Cache mis à jour.');
    } catch (err) {
      console.warn('[auto-refresh] Échec :', err.message);
    }
  }, CACHE_TTL_MS);
});

// ── Gestion arrêt propre ─────────────────────────────────────
process.on('SIGTERM', () => { console.log('Arrêt propre…'); process.exit(0); });
process.on('SIGINT',  () => { console.log('Arrêt propre…'); process.exit(0); });
