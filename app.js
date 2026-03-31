// ── CONFIGURATION & ÉTAT ──
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let stations = [];
let activeFuel = 'Diesel'; 
let luxePrices = {};

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.12, 6.17], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 19
}).addTo(map);

// ── LOGIQUE PRINCIPALE ──
async function initApp() {
    try {
        // 1. Récupération des prix LUX via ton Backend
        const luxRes = await fetch(API_LUX_URL);
        luxePrices = await luxRes.json();
        renderLuPrices();

        // 2. Récupération des données France (Moselle)
        // Filtrage strict sur le code département 57
        const frUrl = `${FR_API_URL}?limit=100&where=code_departement%3D'57'`;
        const frRes = await fetch(frUrl);
        const frData = await frRes.json();

        if (frData.results) {
            stations = frData.results;
            updateDisplay();
        }
    } catch (e) {
        console.error("Erreur lors de l'initialisation:", e);
    }
}

function updateDisplay() {
    // Nettoyage des anciens marqueurs
    map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) map.removeLayer(layer);
    });

    stations.forEach(s => {
        // Mapping des champs de l'API v2.1
        const fuelMap = {
            'Diesel': s.gazole_prix,
            'SP95': s.sp95_prix,
            'SP98': s.sp98_prix,
            'GPL': s.gpl_prix
        };

        const currentPrice = fuelMap[activeFuel];
        const lat = s.geom?.lat || s.latitude;
        const lon = s.geom?.lon || s.longitude;

        if (currentPrice && lat && lon) {
            // Comparaison dynamique avec le prix Lux correspondant
            const isCheaperThanLux = currentPrice < luxePrices[activeFuel];
            const color = isCheaperThanLux ? '#f0c040' : '#4ade80';

            L.circleMarker([lat, lon], {
                radius: 7,
                color: color,
                fillOpacity: 0.8,
                weight: 1
            })
            .addTo(map)
            .bindPopup(`
                <b>${s.name || 'Station'}</b><br>
                ${s.ville}<br>
                <hr>
                Prix FR (${activeFuel}): <b>${currentPrice.toFixed(3)}€</b><br>
                Prix LUX (${activeFuel}): <b>${luxePrices[activeFuel]?.toFixed(3) || 'NC'}€</b>
            `);
        }
    });
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    const fuels = ['Diesel', 'SP95', 'SP98', 'GPL'];
    el.innerHTML = fuels.map(f => `
        <div class="price-row">
            <span>${f}</span>
            <b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>
    `).join('');
}

// Fonction liée aux clics sur les boutons de carburant
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay();
}

initApp();
