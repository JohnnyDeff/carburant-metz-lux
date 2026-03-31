// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.45, SP95: 1.55, SP98: 1.65, GPL: 0.85 };
let activeFuel = 'Diesel';
let markers = [];
let stationsList = [];

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.35, 6.15], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | TomTom | OpenData'
}).addTo(map);

function locateUser() { map.locate({setView: true, maxZoom: 14}); }
map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 }).addTo(map).bindPopup("Vous êtes ici").openPopup();
});

// ── CHARGEMENT DES DONNÉES ──
async function loadData() {
    try {
        const luxRes = await fetch(API_LUX_URL);
        if (luxRes.ok) luxePrices = await luxRes.json();
        renderLuPrices();
    } catch (e) { console.warn("Backend Lux injoignable."); }

    stationsList = []; 

    // FRANCE
    try {
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                const lat = s.geom?.lat || (s.geometry?.coordinates ? s.geometry.coordinates[1] : null) || s.latitude;
                const lon = s.geom?.lon || (s.geometry?.coordinates ? s.geometry.coordinates[0] : null) || s.longitude;
                
                if (lat && lon) {
                    // CORRECTION NOM : Si name est vide, on prend la marque, l'adresse ou la ville
                    const finalName = s.name || s.marque || s.adresse || s.ville || "Station Service";

                    stationsList.push({
                        name: finalName,
                        lat: lat, lon: lon, country: 'FR',
                        prices: {
                            Diesel: s.gazole_prix,
                            SP95: s.sp95_prix,
                            SP98: s.sp98_prix,
                            GPL: s.gpl_prix
                            E10: s.e10_prix,
                            E85: s.e85_prix
                        },
                        // CORRECTION RUPTURE : On vérifie si une date de début de rupture existe
                        ruptures: {
                            Diesel: !!s.gazole_rupture_debut,
                            SP95: !!s.sp95_rupture_debut,
                            SP98: !!s.sp98_rupture_debut,
                            GPL: !!s.gpl_rupture_debut
                            E10: !!s.e10_rupture_debut,
                            E85: !!s.e85_rupture_debut
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur API France:", e); }

    // LUXEMBOURG (TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.61&lon=6.13&radius=30000&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name || "Station LUX",
                        lat: poi.position.lat, lon: poi.position.lon, country: 'LU',
                        prices: luxePrices,
                        ruptures: {} // TomTom ne donne pas les ruptures
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    updateDisplay();
}

// ── AFFICHAGE CARTE ET LISTE (Gestion des Ruptures) ──
function updateDisplay() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    let listHTML = '';

    stationsList.forEach(s => {
        const price = s.prices[activeFuel];
        const isRupture = s.ruptures && s.ruptures[activeFuel];
        
        if (isRupture) {
            // Affichage en ROUGE pour les ruptures de stock
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: '#ef4444', color: "#000", weight: 1, fillOpacity: 0.9 })
             .addTo(map)
             .bindPopup(`<b>${s.name}</b><br><span style="color:#ef4444; font-weight:bold; font-size:14px;">⚠️ EN RUPTURE</span>`);
            markers.push(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)" style="cursor:pointer; padding:5px; border-bottom:1px solid #444; opacity: 0.5;">
                    <div class="st-name"><b>${s.name}</b></div>
                    <div class="st-price" style="color:#ef4444; font-size: 12px; font-weight: bold;">⚠️ RUPTURE</div>
                </div>
            `;
        } 
        else if (price) {
            // Affichage normal pour les stations ouvertes
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

    const listEl = document.getElementById('station-list');
    if (listEl) listEl.innerHTML = listHTML;
}

// ── FONCTIONS UI ──
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
