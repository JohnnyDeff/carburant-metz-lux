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

// --- PRIX LUXEMBOURG ---
app.get('/api/lux-prices', async (req, res) => {
    // Prix de secours si le site est en panne
    let fallbackPrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78 };
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
        res.json(prices);
    } catch (e) { 
        console.error("Alerte Lux : Site injoignable, utilisation des prix de secours.");
        res.json(fallbackPrices); // On renvoie un succès avec les prix de secours au lieu d'une erreur 500
    }
});

// --- PRIX BELGIQUE ---
app.get('/api/belgium-prices', async (req, res) => {
    let fallbackPrices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85 };
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
        res.json(prices);
    } catch (e) { 
        console.error("Alerte BE : Site injoignable, utilisation des prix de secours.");
        res.json(fallbackPrices); 
    }
});

// --- PROXY FRANCE ---
app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';
        
        // On laisse Axios gérer l'encodage complexe de la syntaxe Opendatasoft
        const response = await axios.get(url, {
            ...axiosConfig,
            params: {
                limit: 100,
                where: `within_distance(geom, GEOM'POINT(${lng} ${lat})', 50km)`
            }
        });
        
        res.json(response.data);
    } catch (error) {
        // En cas de nouvelle erreur, le log affichera le message exact de l'API France
        console.error("Erreur API France :", error.response?.data || error.message);
        res.status(500).json({ error: "L'API France est inaccessible" });
    }
});

// --- PROXY ALLEMAGNE (Tankerkönig) ---
app.get('/api/germany-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=25&sort=dist&type=all&apikey=bbe071ee-7196-4c1e-b471-8c7934596447`;
        
        // C'EST ICI QU'ON ENLÈVE LE ", axiosConfig"
        const response = await axios.get(url); 
        
        res.json(response.data);
    } catch (error) {
        // Ajoutons le vrai message d'erreur pour savoir exactement ce qui cloche si ça recommence
        console.error("Erreur API Allemagne :", error.response?.data || error.message);
        res.status(500).json({ error: "L'API Allemagne est inaccessible" });
    }
});
app.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
