/**
 * backend-lux-prices.js — V3
 * ─────────────────────────────────────────────────────────────
 * Sources par ordre de priorité :
 *   1. data.public.lu  → dataset officiel "Prix des carburants"
 *   2. gouvernement.lu → communiqué mensuel (HTML scrape)
 *   3. Fallback statique (derniers prix connus, hardcodés)
 *
 * INSTALL : npm install express axios cheerio
 * START   : node backend-lux-prices.js
 * API     : GET /api/lux-prices
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');

const app  = express();
const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques (index.html, app.js, style.css)
app.use(express.static(__dirname));

// CORS pour dev local
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

// ── Cache mémoire (6h) ──────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = { data: null, expires_at: 0 };

// ── Fallback : prix officiels du dernier communiqué connu ───
// Source : https://gouvernement.lu/fr/actualites/communiques/prix-carburants.html
// À mettre à jour manuellement si besoin (change ~1-2 fois/mois)
const FALLBACK = {
    Diesel: 1.418,
    SP95:   1.540,
    SP98:   1.684,
    GPL:    0.820,
    date_maj: '01/03/2026',
    source: 'fallback statique (backend hors ligne)',
    is_fallback: true
};

// ── Source 1 : data.public.lu ────────────────────────────────
// Dataset officiel : "Prix maxima des carburants au Luxembourg"
// URL stable depuis plusieurs années.
async function fetchDataPublicLu() {
    // L'API catalog permet de lister les datasets
    const searchUrl = 'https://data.public.lu/api/1/datasets/?q=prix+carburants&page_size=5';
    const searchRes = await axios.get(searchUrl, { timeout: 8000 });
    const datasets  = searchRes.data.data || [];

    // On cherche le dataset contenant "prix" et "carburant"
    const dataset = datasets.find(d =>
        d.title?.toLowerCase().includes('carburant') &&
        (d.title?.toLowerCase().includes('prix') || d.title?.toLowerCase().includes('maxima'))
    );

    if (!dataset) throw new Error('data.public.lu : dataset introuvable');

    // Récupérer les ressources du dataset
    const dsRes   = await axios.get(`https://data.public.lu/api/1/datasets/${dataset.id}/`, { timeout: 8000 });
    const resources = dsRes.data.resources || [];

    // Prendre la ressource CSV ou JSON la plus récente
    const resource = resources.find(r =>
        r.format?.toLowerCase() === 'csv' || r.format?.toLowerCase() === 'json'
    ) || resources[0];

    if (!resource?.url) throw new Error('data.public.lu : aucune ressource téléchargeable');

    const fileRes = await axios.get(resource.url, { timeout: 10000, responseType: 'text' });
    const text    = fileRes.data;

    // Parser CSV simple (format attendu : date;Diesel;SP95;SP98;GPL)
    const prices = parseCarburantCSV(text);
    if (!prices) throw new Error('data.public.lu : parsing CSV échoué');

    return { ...prices, source: 'data.public.lu (officiel)' };
}

function parseCarburantCSV(text) {
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return null;

    // Détecter le séparateur (;  ou  ,)
    const sep    = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].toLowerCase().split(sep).map(h => h.trim().replace(/['"]/g, ''));

    // Indices des colonnes carburant
    const colMap = {
        Diesel: findCol(header, ['diesel', 'gasoil']),
        SP95:   findCol(header, ['sp95', 'essence', 'super 95', 'e5']),
        SP98:   findCol(header, ['sp98', 'super 98']),
        GPL:    findCol(header, ['gpl', 'lpg', 'propane'])
    };

    // Prendre la dernière ligne (données les plus récentes)
    const lastLine = lines[lines.length - 1].split(sep).map(v => v.trim().replace(/['"]/g, ''));

    const prices = {};
    for (const [fuel, idx] of Object.entries(colMap)) {
        if (idx >= 0 && lastLine[idx]) {
            const val = parseFloat(lastLine[idx].replace(',', '.'));
            if (val > 0.5 && val < 5) prices[fuel] = val;
        }
    }

    // Colonne date
    const dateIdx = findCol(header, ['date', 'periode', 'mois']);
    const dateRaw = dateIdx >= 0 ? lastLine[dateIdx] : null;

    return Object.keys(prices).length >= 2
        ? { ...prices, date_maj: formatDate(dateRaw) }
        : null;
}

function findCol(header, candidates) {
    for (const c of candidates) {
        const i = header.findIndex(h => h.includes(c));
        if (i >= 0) return i;
    }
    return -1;
}

function formatDate(raw) {
    if (!raw) return new Date().toLocaleDateString('fr-FR');
    // Formats possibles : 2026-03, 2026-03-01, 01/03/2026
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toLocaleDateString('fr-FR');
}

// ── Source 2 : gouvernement.lu (scrape HTML) ─────────────────
// Le gouvernement publie les prix max légaux sur cette page stable.
async function fetchGouvernementLu() {
    const url = 'https://gouvernement.lu/fr/actualites/toutes_actualites/communiques.html?tag=Energie';
    const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'fr-FR' };

    const listRes  = await axios.get(url, { headers, timeout: 8000 });
    const $list    = cheerio.load(listRes.data);

    // Trouver le lien vers le dernier communiqué "prix carburants"
    let communiqueUrl = null;
    $list('a').each((_, el) => {
        const href = $list(el).attr('href') || '';
        const text = $list(el).text().toLowerCase();
        if (text.includes('carburant') && href.includes('communiques') && !communiqueUrl) {
            communiqueUrl = href.startsWith('http') ? href : 'https://gouvernement.lu' + href;
        }
    });

    if (!communiqueUrl) throw new Error('gouvernement.lu : aucun communiqué trouvé');

    const pageRes = await axios.get(communiqueUrl, { headers, timeout: 8000 });
    const $       = cheerio.load(pageRes.data);

    const prices   = {};
    const fuelMap  = {
        'diesel': 'Diesel', 'gasoil': 'Diesel',
        'sp95': 'SP95', 'super 95': 'SP95', 'essence': 'SP95',
        'sp98': 'SP98', 'super 98': 'SP98',
        'gpl': 'GPL', 'lpg': 'GPL'
    };

    $('table tr').each((_, row) => {
        const cells = $(row).find('td, th');
        if (cells.length < 2) return;
        const label = $(cells[0]).text().toLowerCase().trim();
        for (const [key, name] of Object.entries(fuelMap)) {
            if (label.includes(key) && !prices[name]) {
                const raw = $(cells[cells.length - 1]).text().trim();
                const val = parseFloat(raw.replace(',', '.').replace(/[^\d.]/g, ''));
                if (val > 0.5 && val < 5) prices[name] = val;
            }
        }
    });

    if (Object.keys(prices).length < 2) throw new Error('gouvernement.lu : prix insuffisants');

    return {
        ...prices,
        date_maj: new Date().toLocaleDateString('fr-FR'),
        source:   'gouvernement.lu (communiqué officiel)'
    };
}

// ── Orchestration ────────────────────────────────────────────
async function fetchPrices() {
    const sources = [
        { name: 'data.public.lu',   fn: fetchDataPublicLu   },
        { name: 'gouvernement.lu',  fn: fetchGouvernementLu },
    ];

    for (const { name, fn } of sources) {
        try {
            console.log(`[scraping] Tentative : ${name}…`);
            const data = await fn();
            console.log(`[scraping] ✓ ${name} :`, data);
            return { ...data, is_fallback: false, fetched_at: new Date().toISOString() };
        } catch (err) {
            console.warn(`[scraping] ✗ ${name} : ${err.message}`);
        }
    }

    console.error('[scraping] Toutes les sources ont échoué — fallback statique');
    return { ...FALLBACK, fetched_at: new Date().toISOString() };
}

async function getOrRefreshCache() {
    if (cache.data && Date.now() < cache.expires_at) return cache.data;
    const data = await fetchPrices();
    cache = { data, expires_at: Date.now() + CACHE_TTL_MS };
    return data;
}

// ── Routes API ───────────────────────────────────────────────

/** GET /api/lux-prices → prix actuels */
app.get('/api/lux-prices', async (req, res) => {
    try {
        const data = await getOrRefreshCache();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** GET /api/lux-prices/refresh → forcer rechargement */
app.get('/api/lux-prices/refresh', async (req, res) => {
    cache.expires_at = 0;
    try {
        const data = await getOrRefreshCache();
        res.json({ message: 'Rafraîchi', ...data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/** GET /api/health */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        cache_valid: Date.now() < cache.expires_at,
        source: cache.data?.source || null,
        is_fallback: cache.data?.is_fallback ?? null,
        expires_at: new Date(cache.expires_at).toISOString()
    });
});

// ── Démarrage ────────────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`\n⛽  Backend carburant Luxembourg — port ${PORT}`);
    console.log(`   GET http://localhost:${PORT}/api/lux-prices`);
    console.log(`   GET http://localhost:${PORT}/api/health\n`);
    // Pré-charger le cache au démarrage
    await getOrRefreshCache().catch(e => console.warn('[init]', e.message));
    // Rafraîchissement auto toutes les 6h
    setInterval(() => { cache.expires_at = 0; getOrRefreshCache(); }, CACHE_TTL_MS);
});

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
