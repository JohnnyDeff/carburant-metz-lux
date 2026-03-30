/**
 * backend-lux-prices.js
 * ─────────────────────────────────────────────────────────────
 * Backend Node.js — Scraper prix carburant Luxembourg (V2)
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration des URLs officielles et secondaires
const OPENDATA_LU_URL = 'https://data.public.lu/api/1/datasets/prix-des-carburants-au-luxembourg/';

let cache = { data: null, expires: 0 };

async function getLuxPrices() {
    const now = Date.now();
    if (cache.data && now < cache.expires) return cache.data;

    let prices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0, source: "Inconnue", date_maj: "" };

    try {
        console.log("[Backend] Tentative via OpenData Luxembourg...");
        const response = await fetch(OPENDATA_LU_URL);
        const metadata = await response.json();
        
        // On récupère la ressource JSON la plus récente
        const resource = metadata.resources.find(r => r.format === 'json' && r.title.includes('Prix'));
        
        if (resource) {
            const pRes = await fetch(resource.url);
            const pData = await pRes.json();
            // Structure type de l'OpenData Lux
            prices.Diesel = parseFloat(pData.diesel || pData.Diesel);
            prices.SP95 = parseFloat(pData.sp95 || pData.SP95);
            prices.SP98 = parseFloat(pData.sp98 || pData.SP98);
            prices.GPL = parseFloat(pData.lpg || pData.LPG || 0.850);
            prices.source = "Portail OpenData Lux";
            prices.date_maj = new Date().toLocaleDateString('fr-FR');
        }
    } catch (e) {
        console.error("[Backend] Erreur OpenData, tentative via Carbu.com...", e.message);
        // Fallback simple si l'API est down
        prices = { Diesel: 1.485, SP95: 1.542, SP98: 1.662, GPL: 0.820, source: "Valeurs de secours (API Down)", date_maj: "Vérifiez carbu.com" };
    }

    cache.data = prices;
    cache.expires = now + (1000 * 60 * 60 * 2); // Cache 2 heures
    return prices;
}

app.use(express.static(__dirname));

app.get('/api/lux-prices', async (req, res) => {
    const data = await getLuxPrices();
    res.json(data);
});

app.listen(PORT, () => console.log(`⛽ Serveur prêt sur le port ${PORT}`));
