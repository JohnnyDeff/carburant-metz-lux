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
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
};

// --- LE SYSTÈME DE CACHE ---
const cache = {
    lux: { data: null, time: 0 },
    bel: { data: null, time: 0 },
    france: {},  // Va stocker par zone géographique
    germany: {}  // Va stocker par zone géographique
};
const CACHE_DURATION_GLOBAL = 30 * 60 * 1000; // 30 minutes pour LU/BE (les prix changent 1x par jour)
const CACHE_DURATION_GEO = 10 * 60 * 1000;    // 10 minutes pour FR/DE (évite le spam quand on bouge la carte)

// --- PRIX LUXEMBOURG ---
app.get('/api/lux-prices', async (req, res) => {
    let fallbackPrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78 };
    
    // Vérification du cache
    if (cache.lux.data && (Date.now() - cache.lux.time < CACHE_DURATION_GLOBAL)) {
        console.log("LUX : Servi depuis le cache !");
        return res.json(cache.lux.data);
    }

    try {
        const response = await axios.get('https://familiale.lu/petrol-prices', axiosConfig);
        const $ = cheerio.load(response.data);
        let prices = {};
        $('.price-item').each((i, el) => {
            const name = $(el).find('.fuel-name').text().trim();
            const price = parseFloat($(el).find('.fuel-price').text().replace(',', '.'));
            if (name.includes('Gazole') || name.includes('Diesel')) prices.Diesel = price;
            if (name.includes('95')) prices.SP95 = prices.E10 = price;
            if (name.includes('98')) prices.SP98 = price;
        });
        
        if (Object.keys(prices).length === 0) throw new Error("Site vide");
        
        // Sauvegarde dans le cache
        cache.lux = { data: prices, time: Date.now() };
        res.json(prices);
    } catch (e) { 
        console.error("Alerte Lux : Site injoignable, utilisation des prix de secours.");
        res.json(fallbackPrices);
    }
});

// --- PRIX BELGIQUE ---
app.get('/api/belgium-prices', async (req, res) => {
    let fallbackPrices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85 };
    
    if (cache.bel.data && (Date.now() - cache.bel.time < CACHE_DURATION_GLOBAL)) {
        console.log("BE : Servi depuis le cache !");
        return res.json(cache.bel.data);
    }

    try {
        const response = await axios.get('https://www.energiafed.be/fr/prix-maximums', axiosConfig);
        const $ = cheerio.load(response.data);
        let prices = {};
        $('table tr').each((i, el) => {
            const text = $(el).text().toLowerCase();
            const val = parseFloat($(el).find('td').eq(1).text().replace(',', '.'));
            if (text.includes('diesel') && !isNaN(val)) prices.Diesel = val;
            if (text.includes('95') && !isNaN(val)) { prices.SP95 = val; prices.E10 = val; }
            if (text.includes('98') && !isNaN(val)) prices.SP98 = val;
        });
        
        if (Object.keys(prices).length === 0) throw new Error("Site vide");
        
        cache.bel = { data: prices, time: Date.now() };
        res.json(prices);
    } catch (e) { 
        res.json(fallbackPrices); 
    }
});

// --- PROXY FRANCE ---
app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        // Création d'une clé de cache (ex: "49.45_6.15")
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        
        if (cache.france[cacheKey] && (Date.now() - cache.france[cacheKey].time < CACHE_DURATION_GEO)) {
            console.log(`FRANCE : Cache utilisé pour la zone ${cacheKey}`);
            return res.json(cache.france[cacheKey].data);
        }

        const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
        const response = await axios.get(url, {
            ...axiosConfig,
            params: {
                limit: 100,
                where: `within_distance(geom, GEOM'POINT(${lng} ${lat})', 50km)`
            }
        });
        
        cache.france[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "L'API France est inaccessible" });
    }
});

// --- PROXY ALLEMAGNE (Tankerkönig) ---
app.get('/api/germany-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        
        if (cache.germany[cacheKey] && (Date.now() - cache.germany[cacheKey].time < CACHE_DURATION_GEO)) {
            console.log(`ALLEMAGNE : Cache utilisé pour la zone ${cacheKey}`);
            return res.json(cache.germany[cacheKey].data);
        }

        const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=25&sort=dist&type=all&apikey=bbe071ee-7196-4c1e-b471-8c7934596447`;
        
        // Attention: Pas de axiosConfig ici pour ne pas se faire bloquer
        const response = await axios.get(url);
        
        cache.germany[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "L'API Allemagne est inaccessible" });
    }
});

app.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
