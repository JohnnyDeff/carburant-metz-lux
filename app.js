const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = {};
let activeFuel = 'Diesel'; 
const map = L.map('map').setView([49.35, 6.15], 10); // Centré entre Metz et Lux

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

async function loadData() {
    try {
        // 1. Récupérer les prix LUX depuis ton backend
        const luxRes = await fetch(API_LUX_URL);
        luxePrices = await luxRes.json();

        // Nettoyer la carte avant de dessiner
        map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });

        // ---------------------------------------------------------
        // 2. DESSINER LA FRANCE (En direct via l'API du gouvernement)
        // ---------------------------------------------------------
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                // Extraction sécurisée des coordonnées
                const lat = s.geom?.lat || (s.geometry?.coordinates ? s.geometry.coordinates[1] : null);
                const lon = s.geom?.lon || (s.geometry?.coordinates ? s.geometry.coordinates[0] : null);
                
                // Sélection du bon prix
                const fuelKey = activeFuel === 'Diesel' ? 'gazole_prix' : 
                               activeFuel === 'SP95' ? 'sp95_prix' : 
                               activeFuel === 'GPL' ? 'gpl_prix' : 'sp98_prix';
                const price = s[fuelKey];

                if (lat && lon && price) {
                    const color = price < luxePrices[activeFuel] ? '#f0c040' : '#4ade80'; // Jaune si moins cher que Lux, sinon Vert
                    createMarker(lat, lon, s.name || "Station France", price, color, "FR (Réel)");
                }
            });
        }

        // ---------------------------------------------------------
        // 3. DESSINER LE LUXEMBOURG (En direct via TomTom)
        // ---------------------------------------------------------
        // On centre TomTom directement sur Luxembourg-Ville (49.61, 6.13)
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.61&lon=6.13&radius=30000&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    const price = luxePrices[activeFuel];
                    if (price) {
                        createMarker(poi.position.lat, poi.position.lon, poi.poi.name, price, '#60a5fa', "LU (National)");
                    }
                }
            });
        }

    } catch (e) { 
        console.error("Erreur générale:", e); 
    }
}

function createMarker(lat, lon, name, price, color, src) {
    L.circleMarker([lat, lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
     .addTo(map)
     .bindPopup(`<b>${name}</b><br><span style="font-size:16px;">${price.toFixed(3)} €</span><br><small>${src}</small>`);
}

// Lancement
loadData();const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = {};
let activeFuel = 'Diesel'; 
const map = L.map('map').setView([49.45, 6.10], 10); // Vue large Metz -> Lux

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

// Aide au matching géographique
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadData() {
    try {
        // 1. Charger les prix LUX
        const luxRes = await fetch(API_LUX_URL);
        luxePrices = await luxRes.json();

        // 2. Charger TOUTES les stations Moselle (limit=1000 pour ne rien rater)
        // On utilise les champs gazole_prix, sp95_prix, sp98_prix et gpl_prix confirmés
        const frRes = await fetch(`${FR_API_URL}?limit=1000&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        const frStations = frData.results || [];

        // 3. Chercher les stations physiques (TomTom) sur tout l'axe
        // Rayon 50km pour couvrir Metz + Thionville + Luxembourg
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.45&lon=6.10&radius=50000&limit=100`);
        const ttData = await ttRes.json();

        map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });

        ttData.results.forEach(poi => {
            const lat = poi.position.lat;
            const lon = poi.position.lon;
            const country = poi.address.countryCode;
            let price = null;
            let color = '#4ade80';

            if (country === 'LU') {
                price = luxePrices[activeFuel];
                color = '#60a5fa'; // Bleu pour Lux
                createMarker(lat, lon, poi.poi.name, price, color, "LU (National)");
            } 
            else {
                // Matching avec le JSON France
                const match = frStations.find(f => {
                    const fLat = f.geom?.lat || f.latitude;
                    const fLon = f.geom?.lon || f.longitude;
                    return fLat && getDistance(lat, lon, fLat, fLon) < 200;
                });

                if (match) {
                    const fuelKey = activeFuel === 'Diesel' ? 'gazole_prix' : 
                                   activeFuel === 'SP95' ? 'sp95_prix' : 
                                   activeFuel === 'GPL' ? 'gpl_prix' : 'sp98_prix';
                    price = match[fuelKey];
                    if (price) {
                        color = price < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
                        createMarker(lat, lon, poi.poi.name, price, color, "FR (Réel)");
                    }
                }
            }
        });
    } catch (e) { console.error(e); }
}

function createMarker(lat, lon, name, price, color, src) {
    L.circleMarker([lat, lon], { radius: 9, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
     .addTo(map)
     .bindPopup(`<b>${name}</b><br><span style="font-size:16px;">${price.toFixed(3)} €</span><br><small>${src}</small>`);
}

loadData();
