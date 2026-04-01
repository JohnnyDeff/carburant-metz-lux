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

// --- MÉMOIRE VIVE DU SERVEUR ---
// Ces prix servent de base ultra-rapide. Ils sont mis à jour en arrière-plan.
let memoryPrices = {
    lux: { Diesel: 1.54, SP95: 1.63, E10: 1.63, SP98: 1.86 },
    bel: { Diesel: 1.77, SP95: 1.72, E10: 1.72, SP98: 1.91 }
};

const cache = { france: {}, germany: {} };
const CACHE_DURATION_GEO = 10 * 60 * 1000; // 10 minutes pour FR/DE

// --- LE TRAVAILLEUR DE L'OMBRE (Tâches en arrière-plan) ---
async function fetchNationalPricesBackground() {
    console.log("🔄 Lancement de la mise à jour des prix nationaux...");
    
 // --- LUXEMBOURG (Lecture propre du tableau HTML de RTL) ---
    try {
        const res = await axios.get('https://today.rtl.lu/mobility/fuel-prices', axiosConfig);
        const $ = cheerio.load(res.data);
        let newLux = {};
        
        // On parcourt chaque ligne (tr) de tous les tableaux de la page
        $('tr').each((i, el) => {
            // La première colonne (td 0) contient le nom
            const label = $(el).find('td').eq(0).text().toLowerCase();
            // La deuxième colonne (td 1) contient le prix
            const valueText = $(el).find('td').eq(1).text();
            
            // On extrait uniquement les chiffres du prix (ex: "1.758 €/l" -> 1.758)
            const priceMatch = valueText.match(/([0-9][.,][0-9]{2,3})/);
            
            if (priceMatch) {
                const price = parseFloat(priceMatch[1].replace(',', '.'));
                
                if (label.includes('diesel')) newLux.Diesel = price;
                if (label.includes('95')) { newLux.SP95 = price; newLux.E10 = price; }
                if (label.includes('98')) newLux.SP98 = price;
            }
        });

        if (Object.keys(newLux).length > 0) {
            memoryPrices.lux = newLux;
            console.log("✅ LUX mis à jour via RTL (Lecture Tableau) :", newLux);
        } else {
            console.log("⚠️ Prix non trouvés dans le tableau RTL.");
        }
    } catch (e) {
        console.log("⚠️ Échec LUX (RTL Tableau), conservation de la mémoire.");
    }

    // --- BELGIQUE (On garde AllOrigins qui fonctionnait) ---
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://www.energiafed.be/fr/prix-maximums')}`;
        const res = await axios.get(proxyUrl);
        const $ = cheerio.load(res.data.contents);
        let newBel = {};
        
        $('table tr').each((i, el) => {
            const textEl = $(el).text().toLowerCase();
            const val = parseFloat($(el).find('td').eq(1).text().replace(',', '.'));
            if (textEl.includes('diesel') && !isNaN(val)) newBel.Diesel = val;
            if (textEl.includes('95') && !isNaN(val)) { newBel.SP95 = val; newBel.E10 = val; }
            if (textEl.includes('98') && !isNaN(val)) newBel.SP98 = val;
        });
        
        if (Object.keys(newBel).length > 0) {
            memoryPrices.bel = newBel;
            console.log("✅ BEL mis à jour via Proxy :", newBel);
        }
    } catch (e) {
        console.log("⚠️ Échec BEL via proxy, conservation de la mémoire.");
    }
}

// 1. On lance le travailleur une première fois au démarrage du serveur
fetchNationalPricesBackground();
// 2. On lui dit de recommencer toutes les 6 heures (6h * 60m * 60s * 1000ms)
setInterval(fetchNationalPricesBackground, 6 * 60 * 60 * 1000);

// --- ROUTES API ULTRA-RAPIDES (Réponse en 0 milliseconde) ---
app.get('/api/lux-prices', (req, res) => res.json(memoryPrices.lux));
app.get('/api/belgium-prices', (req, res) => res.json(memoryPrices.bel));

// --- PROXY FRANCE (Avec cache) ---
app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        
        if (cache.france[cacheKey] && (Date.now() - cache.france[cacheKey].time < CACHE_DURATION_GEO)) {
            return res.json(cache.france[cacheKey].data);
        }

        const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
        const response = await axios.get(url, {
            ...axiosConfig,
            params: { limit: 100, where: `within_distance(geom, GEOM'POINT(${lng} ${lat})', 50km)` }
        });
        
        cache.france[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: "L'API France est inaccessible" }); }
});

// --- PROXY ALLEMAGNE (Avec cache) ---
app.get('/api/germany-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        
        if (cache.germany[cacheKey] && (Date.now() - cache.germany[cacheKey].time < CACHE_DURATION_GEO)) {
            return res.json(cache.germany[cacheKey].data);
        }

        const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=25&sort=dist&type=all&apikey=bbe071ee-7196-4c1e-b471-8c7934596447`;
        const response = await axios.get(url);
        
        cache.germany[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: "L'API Allemagne est inaccessible" }); }
});

app.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
