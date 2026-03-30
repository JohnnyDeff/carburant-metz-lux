/**
 * backend-lux-prices.js
 * ─────────────────────────────────────────────────────────────
 * Backend Node.js — Scraper prix carburant Luxembourg (V2)
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const express  = require('express');
const fetch    = require('node-fetch');
const cheerio  = require('cheerio');

const PORT          = process.env.PORT || 3000;
const REFRESH_HOURS = 6;
const CACHE_TTL_MS  = REFRESH_HOURS * 60 * 60 * 1000;

const FALLBACK_PRICES = {
  Diesel: 1.489, SP95: 1.552, SP98: 1.674, GPL: 0.850,
  date_maj: 'Dernière valeur connue', source: 'Fallback', is_fallback: true
};

let cache = { data: null, fetched_at: null, expires_at: null };

// ── FONCTIONS DE SCRAPING OPTIMISÉES ─────────────────────────

async function scrapeCarbuCom() {
  const url = 'https://carbu.com/luxembourg/';
  // Simulation d'un vrai navigateur pour éviter le blocage Render
  const headers = { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8'
  };

  const res = await fetch(url, { headers, timeout: 15000 });
  if (!res.ok) throw new Error(`carbu.com HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const prices = {};
  
  // On parcourt toutes les lignes ou blocs susceptibles de contenir un prix
  $('tr, div, .price-box').each((_, el) => {
    const text = $(el).text().toLowerCase();
    // Regex pour capturer un prix (ex: 1,522 ou 1.522)
    const match = text.match(/(\d[,\.]\d{3})/); 
    
    if (match) {
      const val = parseFloat(match[1].replace(',', '.'));
      if (val < 0.5 || val > 3) return; // Sécurité prix incohérent

      if (text.includes('diesel') && !prices['Diesel']) prices['Diesel'] = val;
      if ((text.includes('95') || text.includes('e10')) && !prices['SP95']) prices['SP95'] = val;
      if (text.includes('98') && !prices['SP98']) prices['SP98'] = val;
      if ((text.includes('gpl') || text.includes('lpg')) && !prices['GPL']) prices['GPL'] = val;
    }
  });

  if (!prices['Diesel'] && !prices['SP95']) throw new Error('Aucun prix extrait de carbu.com');
  return prices;
}

async function scrapeGouvernementLu() {
  const now = new Date();
  const url = `https://gouvernement.lu/fr/actualites/toutes_actualites/communiques/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/prix-carburants.html`;
  
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

  try {
    const res = await fetch(url, { headers, timeout: 10000 });
    if (!res.ok) throw new Error(`gouvernement.lu HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const prices = {};

    $('table tr').each((_, row) => {
      const label = $(row).find('td').first().text().toLowerCase();
      const priceText = $(row).find('td').last().text();
      const valMatch = priceText.match(/(\d[,\.]\d{3})/);

      if (valMatch) {
        const val = parseFloat(valMatch[1].replace(',', '.'));
        if (label.includes('diesel')) prices['Diesel'] = val;
        if (label.includes('95')) prices['SP95'] = val;
        if (label.includes('98')) prices['SP98'] = val;
      }
    });

    if (Object.keys(prices).length > 0) return prices;
    throw new Error('Structure table gouvernement non trouvée');
  } catch (e) {
    throw new Error(`Gouvernement.lu : ${e.message}`);
  }
}

// ── GESTION CACHE & API ──────────────────────────────────────

async function fetchAll() {
  const now = new Date();
  const sources = [
    { name: 'carbu.com', fn: scrapeCarbuCom },
    { name: 'gouvernement.lu', fn: scrapeGouvernementLu }
  ];

  for (const source of sources) {
    try {
      console.log(`[scraping] Tentative via ${source.name}...`);
      const prices = await source.fn();
      console.log(`[scraping] ✓ Succès avec ${source.name}`);
      return {
        ...prices,
        date_maj: now.toLocaleDateString('fr-FR'),
        source: source.name,
        fetched_at: now.toISOString()
      };
    } catch (err) {
      console.warn(`[scraping] ✗ Échec ${source.name}: ${err.message}`);
    }
  }
  return { ...FALLBACK_PRICES, fetched_at: now.toISOString() };
}

const app = express();

// CORS & Fichiers statiques
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static(__dirname));

// Routes
app.get('/api/lux-prices', async (req, res) => {
  const now = Date.now();
  if (!cache.data || now > cache.expires_at) {
    cache.data = await fetchAll();
    cache.expires_at = now + CACHE_TTL_MS;
    cache.fetched_at = now;
  }
  res.json(cache.data);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', source: cache.data?.source }));

// Démarrage
app.listen(PORT, () => {
  console.log(`\n⛽ Serveur carburant lancé sur le port ${PORT}`);
  console.log(`Accès local : http://localhost:${PORT}\n`);
});