// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// On met des prix de secours au cas où le backend met du temps à démarrer sur Render
let luxePrices = { Diesel: 1.45, SP95: 1.55, SP98: 1.65, GPL: 0.85 }; 
let activeFuel = 'Diesel'; 

// ── INITIALISATION CARTE (S'affichera toujours, même sans données) ──
const map = L.map('map').setView([49.35, 6.15], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

async function loadData() {
    // 1. CHARGEMENT LUXEMBOURG (Backend)
    try {
        const luxRes = await fetch(API_LUX_URL);
        if (luxRes.ok) {
            luxePrices = await luxRes.json();
            console.log("Prix Lux chargés :", luxePrices);
        }
    } catch (e) {
        console.warn("Backend Lux injoignable, utilisation des prix de secours.", e);
    }

    // 2. CHARGEMENT FRANCE (API Officielle)
    try {
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                // Extraction ultra-sécurisée des coordonnées
                const lat = s.geom?.lat || (s.geometry?.coordinates ? s.geometry.coordinates[1] : null) || s.latitude;
                const lon = s.geom?.lon || (s.geometry?.coordinates ? s.geometry.coordinates[0] : null) || s.longitude;
                
                const fuelKey = activeFuel === 'Diesel' ? 'gazole_prix' : 
                               activeFuel === 'SP95' ? 'sp95_prix' : 
                               activeFuel === 'GPL' ? 'gpl_prix' : 'sp98_prix';
                const price = s[fuelKey];

                if (lat && lon && price) {
                    const luxPrice = luxePrices[activeFuel] || 1.5;
                    const color = price < luxPrice ? '#f0c040' : '#4ade80';
                    createMarker(lat, lon, s.name || s.ville || "Station FR", price, color, "France (Officiel)");
                }
            });
        }
    } catch (e) {
        console.error("Erreur lors du chargement de la France :", e);
    }

    // 3. CHARGEMENT TOMTOM (Luxembourg Physique)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.61&lon=6.13&radius=30000&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    const price = luxePrices[activeFuel];
                    if (price) {
                        createMarker(poi.position.lat, poi.position.lon, poi.poi.name, price, '#60a5fa', "Luxembourg (National)");
                    }
                }
            });
        }
    } catch (e) {
        console.error("Erreur lors du chargement de TomTom :", e);
    }
}

// Fonction de dessin sur la carte
function createMarker(lat, lon, name, price, color, src) {
    L.circleMarker([lat, lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
     .addTo(map)
     .bindPopup(`<b>${name}</b><br><span style="font-size:16px;">${price.toFixed(3)} €</span><br><small>${src}</small>`);
}

// Démarrage de la machine
loadData();
