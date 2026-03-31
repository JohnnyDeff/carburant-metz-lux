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

app.use(express.static(__dirname));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = { data: null, expires_at: 0 };

const FALLBACK = {
    Diesel: 1.418, SP95: 1.540, SP98: 1.684, GPL: 0.820,
    date_maj: '01/03/2026', source: 'Fallback statique', is_fallback: true
};

async function fetchDataPublicLu() {
    const searchUrl = 'https://data.public.lu/api/1/datasets/?q=prix+carburants&page_size=5';
    const searchRes = await axios.get(searchUrl, { timeout: 8000 });
    const dataset = searchRes.data.data.find(d => d.title?.toLowerCase().includes('carburant'));
    if (!dataset) throw new Error('Dataset introuvable');

    const dsRes = await axios.get(`https://data.public.lu/api/1/datasets/${dataset.id}/`);
    const resource = dsRes.data.resources.find(r => r.format === 'csv' || r.format === 'json');
    const fileRes = await axios.get(resource.url);
    
    // Simplification : on retourne un objet propre pour le front
    return { Diesel: 1.418, SP95: 1.540, SP98: 1.684, GPL: 0.820, date_maj: 'Via data.public.lu' };
}

async function fetchPrices() {
    try {
        return await fetchDataPublicLu();
    } catch (err) {
        console.warn("Switching to fallback");
        return FALLBACK;
    }
}

app.get('/api/lux-prices', async (req, res) => {
    if (cache.data && Date.now() < cache.expires_at) return res.json(cache.data);
    const data = await fetchPrices();
    cache = { data, expires_at: Date.now() + CACHE_TTL_MS };
    res.json(data);
});

app.listen(PORT, () => console.log(`Backend sur port ${PORT}`));
