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
    bel: { Diesel: 1.77, SP95: 1.72, E10: 1.72, SP98: 1.91, trends: {} }
};

const cache = { france: {}, germany: {} };
const CACHE_DURATION_GEO = 10 * 60 * 1000; 

function getDistanceBackend(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

async function fetchNationalPricesBackground() {
    console.log("🔄 Lancement de la mise à jour des prix nationaux...");
    
    // --- LUXEMBOURG ---
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
            const act = tvacRows[0]; const anc = tvacRows[1];
            memoryPrices.lux = {
                Diesel: act.diesel, SP95: act.sp95, E10: act.sp95, SP98: act.sp98,
                trends: {
                    Diesel: act.diesel > anc.diesel ? 'hausse' : (act.diesel < anc.diesel ? 'baisse' : 'stable'),
                    SP95: act.sp95 > anc.sp95 ? 'hausse' : (act.sp95 < anc.sp95 ? 'baisse' : 'stable'),
                    SP98: act.sp98 > anc.sp98 ? 'hausse' : (act.sp98 < anc.sp98 ? 'baisse' : 'stable')
                }
            };
            console.log("✅ LUX mis à jour.");
        }
    } catch (e) { console.log("⚠️ Échec LUX."); }

    // --- BELGIQUE (Via Energiafed - Source robuste pour robot) ---
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://www.energiafed.be/fr/prix-maximums')}`;
        const res = await axios.get(proxyUrl);
        const $ = cheerio.load(res.data.contents);
        let newBel = { trends: {} };
        
        $('section.samenstelling-chart').each((i, el) => {
            const title = $(el).find('h3.samenstelling-chart__title').text().trim().toLowerCase();
            const priceDiv = $(el).find('.samenstelling-chart__price');
            const match = priceDiv.text().trim().match(/([0-9][.,][0-9]{2,4})/);
            
            let trend = 'stable';
            if (priceDiv.hasClass('price-change--up')) trend = 'hausse';
            else if (priceDiv.hasClass('price-change--down')) trend = 'baisse';
            
            if (match) {
                const price = parseFloat(match[1].replace(',', '.'));
                if (title.includes('essence 95 ron - e10')) { 
                    newBel.SP95 = price; newBel.E10 = price; newBel.trends.SP95 = trend;
                }
                if (title.includes('essence 98 ron - e5')) { 
                    newBel.SP98 = price; newBel.trends.SP98 = trend;
                }
                if (title.includes('gasoil diesel à la pompe') || title.includes('gasoil diesel a la pompe')) { 
                    newBel.Diesel = price; newBel.trends.Diesel = trend;
                }
            }
        });
        if (Object.keys(newBel).length > 1) {
            memoryPrices.bel = newBel;
            console.log("✅ BEL mis à jour via Energiafed.");
        }
    } catch (e) { console.log("⚠️ Échec BEL."); }
}

fetchNationalPricesBackground();
setInterval(fetchNationalPricesBackground, 6 * 60 * 60 * 1000);

// --- ESPAGNE ---
let spainStationsCache = [];
async function fetchSpainBackground() {
    try {
        const url = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
        const res = await axios.get(url, { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) });
        if (res.data && res.data.ListaEESSPrecio) {
            spainStationsCache = res.data.ListaEESSPrecio;
            console.log(`✅ ESPAGNE : ${spainStationsCache.length} stations.`);
        }
    } catch (e) { console.log("⚠️ Échec ESPAGNE."); }
}
fetchSpainBackground();
setInterval(fetchSpainBackground, 60 * 60 * 1000); 

// --- ROUTES ---
app.get('/api/lux-prices', (req, res) => res.json(memoryPrices.lux));
app.get('/api/belgium-prices', (req, res) => res.json(memoryPrices.bel));

app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        if (cache.france[cacheKey] && (Date.now() - cache.france[cacheKey].time < CACHE_DURATION_GEO)) return res.json(cache.france[cacheKey].data);
        const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
        const response = await axios.get(url, { ...axiosConfig, params: { limit: 100, where: `within_distance(geom, GEOM'POINT(${lng} ${lat})', 50km)` } });
        cache.france[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: "Erreur France" }); }
});

app.get('/api/germany-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
        if (cache.germany[cacheKey] && (Date.now() - cache.germany[cacheKey].time < CACHE_DURATION_GEO)) return res.json(cache.germany[cacheKey].data);
        const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=25&sort=dist&type=all&apikey=bbe071ee-7196-4c1e-b471-8c7934596447`;
        const response = await axios.get(url);
        cache.germany[cacheKey] = { data: response.data, time: Date.now() };
        res.json(response.data);
    } catch (error) { res.status(500).json({ error: "Erreur Allemagne" }); }
});

app.get('/api/spain-proxy', (req, res) => {
    const userLat = parseFloat(req.query.lat); const userLng = parseFloat(req.query.lng);
    if (!userLat || !userLng || spainStationsCache.length === 0) return res.json([]);
    const nearby = spainStationsCache.filter(s => {
        const sLat = parseFloat(s['Latitud'].replace(',', '.'));
        const sLng = parseFloat(s['Longitud (WGS84)'].replace(',', '.'));
        return getDistanceBackend(userLat, userLng, sLat, sLng) <= 50000; 
    });
    res.json(nearby);
});

app.listen(PORT, () => console.log(`🚀 Serveur prêt sur le port ${PORT}`));
