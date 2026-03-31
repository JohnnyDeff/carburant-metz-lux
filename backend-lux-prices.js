/**
 * backend-lux-prices.js
 * ─────────────────────────────────────────────────────────────
 * Backend Node.js — Scraper prix carburant Luxembourg (V2)
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

// IDs des ressources officielles STATEC (Luxembourg)
const RESOURCES = {
    Diesel: "99d5a6d1-e67e-4b4e-a004-4a0245b2a4b1",
    SP95:   "09e17ebe-5da1-46ad-a247-79010a017154",
    SP98:   "81432960-6913-4f02-bf33-5502d045ebbf",
    GPL:    "1b4fbbe0-9948-4ce0-bffa-a1b2c54c7dd7"
};

/**
 * Récupère le prix le plus récent d'une ressource Statec
 */
async function fetchStatecPrice(resourceId) {
    try {
        // 1. Obtenir l'URL de téléchargement via l'API metadata
        const metaUrl = `https://data.public.lu/api/1/datasets/economie-totale-et-prix-prix-prix-de-lenergie/resources/${resourceId}/`;
        const meta = await axios.get(metaUrl);
        
        // 2. Télécharger le fichier de données (format JSON attendu)
        const fileRes = await axios.get(meta.data.url);
        const data = fileRes.data;

        // 3. Extraire la dernière valeur (le format Statec est une liste chronologique)
        if (Array.isArray(data) && data.length > 0) {
            const lastEntry = data[data.length - 1];
            return parseFloat(lastEntry.value || lastEntry.prix || 0);
        }
        return 0;
    } catch (e) {
        console.error(`Erreur Statec (Res: ${resourceId}):`, e.message);
        return null;
    }
}

/**
 * Route API pour le Frontend
 */
app.get('/api/lux-prices', async (req, res) => {
    try {
        // Exécution parallèle pour plus de rapidité
        const [d, p95, p98, gpl] = await Promise.all([
            fetchStatecPrice(RESOURCES.Diesel),
            fetchStatecPrice(RESOURCES.SP95),
            fetchStatecPrice(RESOURCES.SP98),
            fetchStatecPrice(RESOURCES.GPL)
        ]);

        res.json({
            Diesel: d || 1.421, // Valeurs de secours si l'API est injoignable
            SP95: p95 || 1.542,
            SP98: p98 || 1.685,
            GPL: gpl || 0.820,
            date_maj: new Date().toLocaleDateString('fr-FR'),
            source: "STATEC Luxembourg (Officiel)"
        });
    } catch (error) {
        res.status(500).json({ error: "Erreur agrégation Statec" });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Serveur démarré sur le port ${PORT}`);
});
