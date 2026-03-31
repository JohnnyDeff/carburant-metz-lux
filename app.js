// ── CONFIGURATION ──
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let stations = [];
let markers = [];
let activeFuel = 'Diesel';
let luxePrices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0 };
let frAverages = { Diesel: 0, SP95: 0, SP98: 0 };

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.12, 6.17], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 19
}).addTo(map);

// ── GÉOLOCALISATION ──
function locateUser() {
    map.locate({setView: true, maxZoom: 14});
}
map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 }).addTo(map)
        .bindPopup("Vous êtes ici").openPopup();
});

// ── CHARGEMENT DATA FRANCE (METZ/57) ──
async function getFranceData() {
    const statusEl = document.getElementById('status-text');
    const dot = document.getElementById('live-dot');
    
    try {
        // Utilisation de refine:57 pour contourner les erreurs de filtrage classiques
        const response = await fetch(`${FR_API_URL}?limit=100&refine=departement%3A57`);
        const data = await response.json();
        
        if (!data.results) throw new Error("Données France indisponibles");

        stations = data.results.map(s => ({
            name: s.name || "Station",
            city: s.city,
            lat: s.latitude,
            lon: s.longitude,
            prices: {
                Diesel: s.prix_diesel,
                SP95: s.prix_essence_95,
                SP98: s.prix_essence_98
            }
        }));

        calculateAverages();
        updateMarkers();
        renderList();
        
        if (dot) dot.classList.remove('loading');
        if (statusEl) statusEl.textContent = `${stations.length} stations chargées (57)`;
    } catch (error) {
        console.error("Erreur API France:", error);
        if (statusEl) statusEl.textContent = "Erreur API France";
    }
}

// ── CHARGEMENT DATA LUX (STATEC) ──
async function getLuxData() {
    try {
        const res = await fetch(API_LUX_URL);
        luxePrices = await res.json();
        renderLuPrices();
        updateSavings();
    } catch (e) {
        console.error("Erreur Backend Lux:", e);
    }
}

// ── CALCULS & AFFICHAGE ──
function calculateAverages() {
    ['Diesel', 'SP95', 'SP98'].forEach(fuel => {
        const fuelKey = fuel === 'Diesel' ? 'Diesel' : fuel;
        const validStations = stations.filter(s => s.prices[fuelKey]);
        const sum = validStations.reduce((acc, s) => acc + s.prices[fuelKey], 0);
        frAverages[fuel] = validStations.length ? sum / validStations.length : 0;
    });
    renderFrPrices();
}

function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    stations.forEach(s => {
        const p = s.prices[activeFuel];
        if (!p || !s.lat || !s.lon) return;

        // Jaune si moins cher que Lux, Vert sinon
        const color = p < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
        const m = L.circleMarker([s.lat, s.lon], {
            radius: 7, color: color, fillOpacity: 0.9, weight: 1
        }).addTo(map);
        
        m.bindPopup(`<b>${s.name}</b><br>${s.city}<br>${activeFuel}: ${p.toFixed(3)}€`);
        markers.push(m);
    });
}

function setFuel(btn, fuel) {
    if (fuel === 'Tous') return; // Option non gérée pour l'instant
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateMarkers();
    renderList();
    updateSavings();
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row"><span>${k}</span> <b>${luxePrices[k].toFixed(3)}€</b></div>
    `).join('');
    const label = document.getElementById('lu-date-label');
    if (label) label.textContent = ` (Maj: ${luxePrices.date_maj})`;
}

function renderFrPrices() {
    const el = document.getElementById('fr-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row"><span>${k}</span> <b>${frAverages[k].toFixed(3)}€</b></div>
    `).join('');
}

function updateSavings() {
    const banner = document.getElementById('savings-banner');
    const valEl = document.getElementById('savings-val');
    const frP = frAverages[activeFuel], luP = luxePrices[activeFuel];

    if (frP && luP && frP > luP) {
        banner.classList.remove('hidden');
        valEl.textContent = `+${((frP - luP) * 50).toFixed(2)} €`;
    } else {
        banner.classList.add('hidden');
    }
}

function renderList() {
    const listEl = document.getElementById('station-list');
    const search = document.getElementById('search').value.toLowerCase();
    
    const filtered = stations
        .filter(s => s.city.toLowerCase().includes(search) && s.prices[activeFuel])
        .sort((a, b) => a.prices[activeFuel] - b.prices[activeFuel]);

    listEl.innerHTML = filtered.slice(0, 30).map(s => `
        <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)">
            <div class="st-name">${s.name}</div>
            <div class="st-price">${s.prices[activeFuel].toFixed(3)} €</div>
        </div>
    `).join('');
}

// ── LANCEMENT ──
getLuxData();
getFranceData();
