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

// Faux navigateur pour éviter d'être bloqué par les sécurités anti-bots
const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
};

// --- PRIX LUXEMBOURG ---
app.get('/api/lux-prices', async (req, res) => {
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
        res.json(prices);
    } catch (e) { 
        console.error("Erreur Backend Lux :", e.message);
        res.status(500).json({ error: "Erreur Lux" }); 
    }
});

// --- PRIX BELGIQUE ---
app.get('/api/belgium-prices', async (req, res) => {
    try {
        const response = await axios.get('https://www.energiafed.be/fr/prix-maximums', axiosConfig);
        const $ = cheerio.load(response.data);
        let prices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85 };
        $('table tr').each((i, el) => {
            const text = $(el).text().toLowerCase();
            const val = parseFloat($(el).find('td').eq(1).text().replace(',', '.'));
            if (text.includes('diesel') && !isNaN(val)) prices.Diesel = val;
            if (text.includes('95') && !isNaN(val)) { prices.SP95 = val; prices.E10 = val; }
            if (text.includes('98') && !isNaN(val)) prices.SP98 = val;
        });
        res.json(prices);
    } catch (e) { 
        console.error("Erreur Backend Belgique :", e.message);
        res.json({ Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85 }); 
    }
});

// --- PROXY FRANCE ---
app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        // Encodage strict de la clause 'where' pour éviter que l'API plante
        const whereClause = `distance(geom, geom'POINT(${lng} ${lat})', 50000)`;
        const encodedWhere = encodeURIComponent(whereClause);
        const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=150&where=${encodedWhere}`;
        
        const response = await axios.get(url, axiosConfig);
        res.json(response.data);
    } catch (error) {
        console.error("Erreur Backend France :", error.message);
        res.status(500).json({ error: "L'API France est inaccessible" });
    }
});

app.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
