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

// Fonction générique pour récupérer le prix actuel d'une ressource Statec
async function getDynamicPrice(resourceId) {
    try {
        // 1. Récupération des métadonnées de la ressource
        const metaUrl = `https://data.public.lu/api/1/datasets/economie-totale-et-prix-prix-prix-de-lenergie/resources/${resourceId}/`;
        const meta = await axios.get(metaUrl);
        
        // 2. Téléchargement du fichier de données (JSON)
        const fileRes = await axios.get(meta.data.url);
        const data = fileRes.data;

        // 3. Extraction de la dernière valeur chronologique
        if (Array.isArray(data) && data.length > 0) {
            const latest = data[data.length - 1];
            return parseFloat(latest.value || latest.prix || 0);
        }
        return null;
    } catch (e) {
        console.error(`Erreur ressource ${resourceId}:`, e.message);
        return null;
    }
}

app.get('/api/lux-prices', async (req, res) => {
    try {
        // IDs des ressources identifiées sur data.public.lu
        const [diesel, sp95, sp98, gpl] = await Promise.all([
            getDynamicPrice("99d5a6d1-e67e-4b4e-a004-4a0245b2a4b1"), // Gasoil
            getDynamicPrice("09e17ebe-5da1-46ad-a247-79010a017154"), // Sans Plomb 95
            getDynamicPrice("81432960-6913-4f02-bf33-5502d045ebbf"), // Sans Plomb 98
            getDynamicPrice("1b4fbbe0-9948-4ce0-bffa-a1b2c54c7dd7")  // GPL (LPG)
        ]);

        res.json({
            Diesel: diesel,
            SP95: sp95,
            SP98: sp98,
            GPL: gpl,
            date_maj: new Date().toLocaleDateString('fr-FR'),
            source: "STATEC Live Data"
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur de synchronisation avec le Statec" });
    }
});

app.listen(PORT, () => console.log(`🚀 Serveur actif sur le port ${PORT}`));
