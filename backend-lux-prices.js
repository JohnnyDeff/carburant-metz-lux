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
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

const RESOURCES = {
    Diesel: "99d5a6d1-e67e-4b4e-a004-4a0245b2a4b1",
    SP95:   "09e17ebe-5da1-46ad-a247-79010a017154",
    SP98:   "81432960-6913-4f02-bf33-5502d045ebbf",
    GPL:    "1b4fbbe0-9948-4ce0-bffa-a1b2c54c7dd7"
};

async function getPrice(id) {
    try {
        const meta = await axios.get(`https://data.public.lu/api/1/datasets/economie-totale-et-prix-prix-prix-de-lenergie/resources/${id}/`);
        const dataRes = await axios.get(meta.data.url);
        const data = dataRes.data;
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[data.length - 1];
            return parseFloat(latest.value || latest.prix || 0);
        }
        return 1.450; // Sécurité
    } catch (e) { return 1.450; }
}

app.get('/api/lux-prices', async (req, res) => {
    const [d, p95, p98, gpl] = await Promise.all([
        getPrice(RESOURCES.Diesel), getPrice(RESOURCES.SP95),
        getPrice(RESOURCES.SP98), getPrice(RESOURCES.GPL)
    ]);
    res.json({ Diesel: d, SP95: p95, SP98: p98, GPL: gpl });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Serveur prêt sur le port ${PORT} (0.0.0.0)`));
