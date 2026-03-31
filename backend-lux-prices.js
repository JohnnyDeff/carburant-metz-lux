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
app.use(express.static('public')); // Pour servir ton index.html, app.js, etc.

// --- ROUTE LUXEMBOURG ---
app.get('/api/lux-prices', async (req, res) => {
    try {
        const response = await axios.get('https://familiale.lu/petrol-prices');
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
    } catch (e) { res.status(500).json({ error: "Erreur Lux" }); }
});

// --- ROUTE BELGIQUE ---
app.get('/api/belgium-prices', async (req, res) => {
    try {
        const response = await axios.get('https://www.energiafed.be/fr/prix-maximums');
        const $ = cheerio.load(response.data);
        let prices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85, GPL: 0.80 };
        $('table tr').each((i, el) => {
            const text = $(el).text().toLowerCase();
            const val = parseFloat($(el).find('td').eq(1).text().replace(',', '.'));
            if (text.includes('diesel') && !isNaN(val)) prices.Diesel = val;
            if (text.includes('95') && !isNaN(val)) { prices.SP95 = val; prices.E10 = val; }
            if (text.includes('98') && !isNaN(val)) prices.SP98 = val;
        });
        res.json(prices);
    } catch (e) { res.json(prices); } // Renvoie les prix par défaut en cas d'erreur
});

// --- PROXY FRANCE (Le tunnel anti-blocage) ---
app.get('/api/france-proxy', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        // Syntaxe exacte pour Opendatasoft
        const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=150&where=distance(geom, geom'POINT(${lng} ${lat})', 50000)`;
        
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: "L'API France ne répond pas" });
    }
});

app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
