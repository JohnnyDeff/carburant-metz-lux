/**
 * backend-lux-prices.js
 * ─────────────────────────────────────────────────────────────
 * Backend Node.js — Scraper prix carburant Luxembourg
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

async function scrapeCarbuCom() {
  const url = 'https://carbu.com/luxembourg/';
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)' };

  const res = await fetch(url, { headers, timeout: 10000 });
  if (!res.ok) throw new Error(`carbu.com HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const prices = {};
  const fuelMap = {
    'diesel': 'Diesel', 'sp95': 'SP95', 'sp98': 'SP98', 'gpl': 'GPL'
  };

  $('tr, .fuel-row').each((_, el) => {
    const text = $(el).text().toLowerCase();
    for (const [key, label] of Object.entries(fuelMap)) {
      if (text.includes(key) && !prices[label]) {
        const match = text.match(/(\d[,\.]\d{2,3})/g);
        if (match) {
          prices[label] = parseFloat(match[match.length - 1].replace(',', '.'));
        }
      }
    }
  });

  if (!Object.keys(prices).length) throw new Error('carbu.com : aucun prix extrait');
  return prices;
}

async function scrapeGouvernementLu() {
  const now  = new Date();
  const year = now.getFullYear();
  const months = [now.getMonth() + 1, now.getMonth() || 12];
  const headers = { 'User-Agent': 'Mozilla/5.0' };

  for (const month of months) {
    const mm = String(month).padStart(2, '0');
    const url = `https://gouvernement.lu/fr/actualites/toutes_actualites/communiques/${year}/${mm}/prix-carburants.html`;

    try {
      const res = await fetch(url, { headers, timeout: 8000 });
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);
      const prices = {};
      
      $('table tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length < 2) return;
        const label = $(cells[0]).text().toLowerCase();
        if (label.includes('diesel')) prices['Diesel'] = parseFloat($(cells[cells.length-1]).text().replace(',', '.').replace(/[^\d.]/g, ''));
        if (label.includes('95')) prices['SP95'] = parseFloat($(cells[cells.length-1]).text().replace(',', '.').replace(/[^\d.]/g, ''));
        if (label.includes('98')) prices['SP98'] = parseFloat($(cells[cells.length-1]).text().replace(',', '.').replace(/[^\d.]/g, ''));
      });

      if (Object.keys(prices).length >= 2) return prices;
    } catch (err) {}
  }
  throw new Error('gouvernement.lu : échec');
}

// ── Orchestration & Cache ────────────────────────────────────

async function fetchLuxPrices() {
  const now = new Date();
  const sources = [{ name: 'gouvernement.lu', fn: scrapeGouvernementLu }, { name: 'carbu.com', fn: scrapeCarbuCom }];

  for (const source of sources) {
    try {
      const prices = await source.fn();
      return {
        ...prices,
        date_maj: now.toLocaleDateString('fr-FR'),
        source: source.name,
        is_fallback: false,
        fetched_at: now.toISOString()
      };
    } catch (err) { console.warn(`✗ ${source.name} : ${err.message}`); }
  }
  return { ...FALLBACK_PRICES, fetched_at: now.toISOString() };
}

async function getOrRefreshCache() {
  const now = Date.now();
  if (cache.data && cache.expires_at && now < cache.expires_at) return cache.data;
  const data = await fetchLuxPrices();
  cache = { data, fetched_at: now, expires_at: now + CACHE_TTL_MS };
  return data;
}

// ── API Express ──────────────────────────────────────────────

const app = express();

// 1. Configuration CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// 2. MODIFICATION : Servir les fichiers statiques (index.html, app.js, style.css)
// C'est cette ligne qui permet à Render d'afficher ton site sur l'URL principale
app.use(express.static(__dirname));

// 3. Routes API
app.get('/api/lux-prices', async (req, res) => {
  try {
    const data = await getOrRefreshCache();
    res.json({ ...data, cache_expires_at: new Date(cache.expires_at).toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne', details: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', source: cache.data?.source });
});

// ── Démarrage ────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`⛽ Serveur démarré sur le port ${PORT}`);
  try { await getOrRefreshCache(); } catch (err) {}
});

process.on('SIGTERM', () => process.exit(0));