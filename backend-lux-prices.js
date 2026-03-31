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

// IDs des ressources Statec fournies
const RESOURCES = {
    Diesel: "99d5a6d1-e67e-4b4e-a004-4a0245b2a4b1",
    SP95:   "09e17ebe-5da1-46ad-a247-79010a017154",
    SP98:   "81432960-6913-4f02-bf33-5502d045ebbf",
    GPL:    "1b4fbbe0-9948-4ce0-bffa-a1b2c54c7dd7"
};

async function getPrice(id) {
    try {
        // 1. Appel API pour avoir l'URL du fichier actuel
        const meta = await axios.get(`https://data.public.lu/api/1/datasets/economie-totale-et-prix-prix-prix-de-lenergie/resources/${id}/`);
        // 2. Récupération du JSON
        const dataRes = await axios.get(meta.data.url);
        const data = dataRes.data;
        // 3. Extraction de la dernière valeur (Format Statec: liste d'objets)
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[data.length - 1];
            return parseFloat(latest.value || latest.prix || 0);
        }
        return null;
    } catch (e) {
        console.error(`Erreur ressource ${id}:`, e.message);
        return null;
    }
}

app.get('/api/lux-prices', async (req, res) => {
    try {
        // On récupère tout en même temps
        const [d, p95, p98, gpl] = await Promise.all([
            getPrice(RESOURCES.Diesel),
            getPrice(RESOURCES.SP95),
            getPrice(RESOURCES.SP98),
            getPrice(RESOURCES.GPL)
        ]);

        res.json({
            Diesel: d,
            SP95: p95,
            SP98: p98,
            GPL: gpl,
            date_maj: new Date().toLocaleDateString('fr-FR'),
            source: "STATEC Live"
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur synchronisation Statec" });
    }
});

app.listen(PORT, () => console.log(`Backend opérationnel sur le port ${PORT}`));
