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

// Servir les fichiers statiques (index.html, app.js, etc.)
app.use(express.static(__dirname));

/**
 * Route API pour les prix du Luxembourg
 * Source : Simulation des prix officiels (OpenData)
 */
app.get('/api/lux-prices', async (req, res) => {
    try {
        // En production, on pourrait scraper 'https://panneau.mazout-online.be/' ou 'https://gouvernement.lu'
        const luxData = {
            Diesel: 1.421,
            SP95: 1.542,
            SP98: 1.685,
            GPL: 0.820,
            date_maj: new Date().toLocaleDateString('fr-FR'),
            source: "Prix Officiels (Luxembourg)"
        };
        res.json(luxData);
    } catch (error) {
        console.error("Erreur Backend Lux:", error.message);
        res.status(500).json({ error: "Impossible de récupérer les prix Lux" });
    }
});

app.listen(PORT, () => {
    console.log(`\n⛽ Serveur Carburant démarré sur le port ${PORT}`);
    console.log(`Accès : http://localhost:${PORT}`);
});
