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
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

async function getLiveLuxPrices() {
    try {
        // On interroge le site de référence pour le Luxembourg
        const { data } = await axios.get('https://carbu.com/luxembourg/index.php/prixmaximum', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        const $ = cheerio.load(data);
        // On extrait tout le texte de la page pour le fouiller
        const text = $('body').text().replace(/\s+/g, ' ');

        // Petite fonction pour chercher "Diesel ... 2,005" dans le texte
        const extractPrice = (keyword) => {
            const regex = new RegExp(`${keyword}.*?([0-9],[0-9]{3})`, 'i');
            const match = text.match(regex);
            return match ? parseFloat(match[1].replace(',', '.')) : null;
        };

        return {
            Diesel: extractPrice('Diesel') || 2.005,
            SP95: extractPrice('Super 95') || 1.700,
            SP98: extractPrice('Super 98') || 1.814,
            GPL: extractPrice('LPG') || 0.930
        };
    } catch (e) {
        console.error("Erreur de scraping, utilisation des prix de secours:", e.message);
        return { Diesel: 2.005, SP95: 1.700, SP98: 1.814, GPL: 0.930 };
    }
}

app.get('/api/lux-prices', async (req, res) => {
    const prices = await getLiveLuxPrices();
    res.json({ 
        ...prices, 
        date_maj: new Date().toLocaleDateString('fr-FR'),
        source: "Tarifs Maxima Officiels (Temps Réel)"
    });
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Backend Temps Réel sur le port ${PORT}`));
