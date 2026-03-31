// ── CONFIGURATION & ÉTAT ──
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let stations = [];
let markers = [];
let activeFuel = 'Diesel'; // 'Diesel', 'SP95' ou 'SP98'
let luxePrices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0 };

// ── INITIALISATION DE LA CARTE ──
const map = L.map('map').setView([49.12, 6.17], 11); // Centré sur Metz
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CartoDB</a>',
    maxZoom: 19
}).addTo(map);

// ── GÉOLOCALISATION ──
function locateUser() {
    map.locate({setView: true, maxZoom: 14});
}

map.on('locationfound', (e) => {
    const radius = e.accuracy / 2;
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 }).addTo(map)
        .bindPopup("Vous êtes ici").openPopup();
});

map.on('locationerror', () => {
    alert("La géolocalisation a échoué. Vérifiez vos permissions HTTPS.");
});

// ── CHARGEMENT DONNÉES FRANCE (METZ/MOSELLE) ──
async function getFranceData() {
    const statusEl = document.getElementById('status-text');
    try {
        // Filtrage SQL-like sur le département 57 (Moselle)
        const response = await fetch(`${FR_API_URL}?where=departement%3D'57'&limit=100`);
        if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
        
        const data = await response.json();
        
        // Mapping propre des données API v2.1
        stations = data.results.map(s => ({
            name: s.name || "Station Sans Nom",
            city: s.city || "Moselle",
            address: s.address,
            lat: s.latitude,
            lon: s.longitude,
            prices: {
                Diesel: s.prix_diesel,
                SP95: s.prix_essence_95,
                SP98: s.prix_essence_98
            }
        }));

        updateMarkers();
        renderList();
        if (statusEl) statusEl.textContent = `${stations.length} stations chargées`;
    } catch (error) {
        console.error("Erreur API France:", error);
        if (statusEl) statusEl.textContent = "Erreur API France";
    }
}

// ── CHARGEMENT DONNÉES LUXEMBOURG ──
async function getLuxData() {
    try {
        const res = await fetch(API_LUX_URL);
        luxePrices = await res.json();
        renderLuPrices();
    } catch (e) {
        console.error("Erreur Backend Lux:", e);
    }
}

// ── AFFICHAGE ──
function updateMarkers() {
    // Nettoyer les anciens marqueurs
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    stations.forEach(s => {
        const p = s.prices[activeFuel];
        if (!p || !s.lat || !s.lon) return;

        // Couleur : Jaune si moins cher que le Lux, Vert sinon
        const isCheaperThanLux = p < luxePrices[activeFuel];
        const color = isCheaperThanLux ? '#f0c040' : '#4ade80';

        const marker = L.circleMarker([s.lat, s.lon], {
            radius: 7,
            fillColor: color,
            color: '#000',
            weight: 1,
            fillOpacity: 0.9
        }).addTo(map);

        marker.bindPopup(`
            <b>${s.name}</b><br>
            ${s.city}<br>
            <hr>
            ${activeFuel} : <b>${p.toFixed(3)} €</b><br>
            <small>Luxembourg : ${luxePrices[activeFuel]} €</small>
        `);
        markers.push(marker);
    });
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = `
        <div class="price-row"><span>Diesel</span> <b>${luxePrices.Diesel.toFixed(3)}€</b></div>
        <div class="price-row"><span>SP95</span> <b>${luxePrices.SP95.toFixed(3)}€</b></div>
        <div class="price-row"><span>SP98</span> <b>${luxePrices.SP98.toFixed(3)}€</b></div>
        <div style="font-size: 10px; margin-top: 5px; opacity: 0.7;">Source: ${luxePrices.source}</div>
    `;
}

function renderList() {
    const listEl = document.getElementById('station-list');
    if (!listEl) return;
    
    // Tri par prix croissant
    const sorted = [...stations].sort((a, b) => (a.prices[activeFuel] || 9) - (b.prices[activeFuel] || 9));
    
    listEl.innerHTML = sorted.slice(0, 20).map(s => {
        const p = s.prices[activeFuel];
        return `
            <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)">
                <div class="st-name">${s.name}</div>
                <div class="st-price">${p ? p.toFixed(3) + ' €' : 'NC'}</div>
            </div>
        `;
    }).join('');
}

// ── LANCEMENT ──
getLuxData();
getFranceData();

// Rafraîchissement toutes les 10 minutes
setInterval(getFranceData, 600000);
