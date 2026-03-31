// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.45, SP95: 1.55, SP98: 1.65, GPL: 0.85 }; // Prix de secours
let activeFuel = 'Diesel';
let markers = []; // Stocke les points sur la carte
let stationsList = []; // Stocke les données pour la liste HTML

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.35, 6.15], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | TomTom | OpenData'
}).addTo(map);

// ── GÉOLOCALISATION ──
function locateUser() {
    map.locate({setView: true, maxZoom: 14});
}
map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup("Vous êtes ici").openPopup();
});

// ── CHARGEMENT DES DONNÉES ──
async function loadData() {
    // 1. LUXEMBOURG (Via ton Backend)
    try {
        const luxRes = await fetch(API_LUX_URL);
        if (luxRes.ok) luxePrices = await luxRes.json();
        renderLuPrices();
    } catch (e) { console.warn("Backend Lux injoignable, utilisation des prix par défaut."); }

    stationsList = []; 

    // 2. FRANCE (Via API Gouv)
    try {
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                const lat = s.geom?.lat || (s.geometry?.coordinates ? s.geometry.coordinates[1] : null) || s.latitude;
                const lon = s.geom?.lon || (s.geometry?.coordinates ? s.geometry.coordinates[0] : null) || s.longitude;
                
                if (lat && lon) {
                    stationsList.push({
                        name: s.name || s.ville || "Station FR",
                        lat: lat, lon: lon, country: 'FR',
                        prices: {
                            Diesel: s.gazole_prix,
                            SP95: s.sp95_prix,
                            SP98: s.sp98_prix,
                            GPL: s.gpl_prix
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur API France:", e); }

    // 3. LUXEMBOURG PHYSIQUE (Via TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.61&lon=6.13&radius=30000&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name || "Station LUX",
                        lat: poi.position.lat, lon: poi.position.lon, country: 'LU',
                        prices: luxePrices 
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    updateDisplay();
}

// ── AFFICHAGE CARTE ET LISTE INTERACTIVE ──
function updateDisplay() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const listEl = document.getElementById('station-list');
    let listHTML = '';

    stationsList.forEach(s => {
        const price = s.prices[activeFuel];
        
        if (price) {
            const luxRefPrice = luxePrices[activeFuel] || 1.5;
            let color = s.country === 'LU' ? '#60a5fa' : (price < luxRefPrice ? '#f0c040' : '#4ade80');
            const src = s.country === 'LU' ? "Luxembourg (National)" : "France (Officiel)";
            
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
             .addTo(map)
             .bindPopup(`<b>${s.name}</b><br><span style="font-size:16px;">${price.toFixed(3)} €</span><br><small>${src}</small>`);
            
            markers.push(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)" style="cursor:pointer; padding:5px; border-bottom:1px solid #444;">
                    <div class="st-name"><b>${s.name}</b></div>
                    <div class="st-price" style="color:${color}">${price.toFixed(3)} €</div>
                </div>
            `;
        }
    });

    if (listEl) listEl.innerHTML = listHTML;
}

// ── FONCTIONS UI (BOUTONS CARBURANTS) ──
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if(btn) btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay(); 
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    const fuels = ['Diesel', 'SP95', 'SP98', 'GPL'];
    el.innerHTML = fuels.map(f => `
        <div class="price-row" style="display:flex; justify-content:space-between;">
            <span>${f}</span>
            <b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>
    `).join('');
}

// ── DÉMARRAGE ──
loadData();
