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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
};

// --- MÉMOIRE VIVE DU SERVEUR ---
let memoryPrices = {
    lux: { Diesel: 1.54, SP95: 1.63, E10: 1.63, SP98: 1.86, trends: {} },
    bel: { Diesel: 1.77, SP95: 1.72, E10: 1.72, SP98: 1.91 }
};

const cache = { france: {}, germany: {} };
const CACHE_DURATION_GEO = 10 * 60 * 1000; // 10 minutes

// --- LE TRAVAILLEUR DE L'OMBRE (Tâches en arrière-plan) ---
async function fetchNationalPricesBackground() {
    console.log("🔄 Lancement de la mise à jour des prix nationaux...");
    
    // --- LUXEMBOURG (petrol.lu avec tendances) ---
    try {
        const res = await axios.get('https://www.petrol.lu/prix-officiels/', axiosConfig);
        const $ = cheerio.load(res.data);
        let tvacRows = [];
        
        $('.prices-table tbody tr').each((i, el) => {
            const tds = $(el).find('td');
            if (tds.length >= 7 && tds.eq(6).text().trim().toUpperCase() === 'TVAC') {
                tvacRows.push({
                    sp98: parseFloat(tds.eq(1).text().trim()),
                    sp95: parseFloat(tds.eq(2).text().trim()),
                    diesel: parseFloat(tds.eq(3).text().trim())
                });
            }
        });

        if (tvacRows.length >= 2) {
            const act = tvacRows[0]; 
            const anc = tvacRows[1]; 

            let newLux = {
                Diesel: act.diesel, SP95: act.sp95, E10: act.sp95, SP98: act.sp98,
                trends: {
                    Diesel: act.diesel > anc.diesel ? 'hausse' : (act.diesel < anc.diesel ? 'baisse' : 'stable'),
                    SP95: act.sp95 > anc.sp95 ? 'hausse' : (act.sp95 < anc.sp95 ? 'baisse' : 'stable'),
                    SP98: act.sp98 > anc.sp98 ? 'hausse' : (act.sp98 < anc.sp98 ? 'baisse' : 'stable')
                }
            };
            memoryPrices.lux = newLux;
            console.log("✅ LUX avec tendances :", newLux.trends);
        }
    } catch (e) {
        console.log("⚠️ Échec LUX (Petrol.lu), conservation de la mémoire.");
    }

// --- BELGIQUE (Via AllOrigins avec nouvelle structure Energia) ---
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://www.energiafed.be/fr/prix-maximums')}`;
        const res = await axios.get(proxyUrl);
        const $ = cheerio.load(res.data.contents);
        let newBel = {};
        
        // On parcourt chaque "carte" de carburant sur le nouveau site
        $('section.samenstelling-chart').each((i, el) => {
            const title = $(el).find('h3.samenstelling-chart__title').text().trim().toLowerCase();
            const priceText = $(el).find('.samenstelling-chart__price').text().trim(); // ex: "€/l 1.9010"
            
            // On attrape le chiffre exact (jusqu'à 4 décimales)
            const match = priceText.match(/([0-9][.,][0-9]{2,4})/);
            
            if (match) {
                const price = parseFloat(match[1].replace(',', '.'));
                
                // On cible exactement les bons noms du nouveau site
                if (title === 'essence 95 ron - e10') {
                    newBel.SP95 = price;
                    newBel.E10 = price;
                }
                if (title === 'essence 98 ron - e5') {
                    newBel.SP98 = price;
                }
                if (title === 'diesel') { // On évite "diesel - b10" ou "diesel - xtl"
                    newBel.Diesel = price;
                }
            }
        });
        
        if (Object.keys(newBel).length > 0) {
            memoryPrices.bel = newBel;
            console.log("✅ BEL mis à jour via Proxy :", newBel);
        } else {
            console.log("⚠️ Prix belges introuvables avec la nouvelle structure.");
        }
    } catch (e) {
        console.log("⚠️ Échec BEL via proxy, conservation de la mémoire.");
    }

// --- ROUTES API ULTRA-RAPIDES ---
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
