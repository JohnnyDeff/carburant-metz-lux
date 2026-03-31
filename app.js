// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = {};
let activeFuel = 'Diesel'; 
const map = L.map('map').setView([49.35, 6.15], 10);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; TomTom | &copy; OpenData France & Lux'
}).addTo(map);

// Calcul de distance pour lier TomTom aux données France
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadData() {
    try {
        // 1. Prix Luxembourg
        const luxRes = await fetch(API_LUX_URL);
        luxePrices = await luxRes.json();

        // 2. Prix France (Moselle)
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        const frStations = frData.results || [];

        // 3. Géographie TomTom (Rayon 40km autour de Thionville)
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.35&lon=6.15&radius=40000&limit=100`);
        const ttData = await ttRes.json();

        map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });

        ttData.results.forEach(poi => {
            const lat = poi.position.lat;
            const lon = poi.position.lon;
            const country = poi.address.countryCode;
            let price = null;
            let color = '#4ade80'; // Vert par défaut

            if (country === 'LU') {
                price = luxePrices[activeFuel];
                color = '#60a5fa'; // Bleu pour Luxembourg
                createMarker(lat, lon, poi.poi.name, price, color, "Tarif National LUX");
            } 
            else if (country === 'FR') {
                // Matching avec tes fichiers (gérant geom, latitude ou geometry)
                const match = frStations.find(f => {
                    const fLat = f.geom?.lat || f.latitude || (f.geometry?.coordinates ? f.geometry.coordinates[1] : null);
                    const fLon = f.geom?.lon || f.longitude || (f.geometry?.coordinates ? f.geometry.coordinates[0] : null);
                    return fLat && getDistance(lat, lon, fLat, fLon) < 150;
                });

                if (match) {
                    const fuelKey = activeFuel === 'Diesel' ? 'gazole_prix' : 
                                   activeFuel === 'SP95' ? 'sp95_prix' : 
                                   activeFuel === 'GPL' ? 'gpl_prix' : 'sp98_prix';
                    price = match[fuelKey];
                    if (price) {
                        color = price < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
                        createMarker(lat, lon, poi.poi.name, price, color, "Prix Instantané FR");
                    }
                }
            }
        });
    } catch (e) { console.error("Erreur de chargement:", e); }
}

function createMarker(lat, lon, name, price, color, src) {
    L.circleMarker([lat, lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
     .addTo(map)
     .bindPopup(`<b>${name}</b><br><span style="font-size:16px;">${price.toFixed(3)} €</span><br><small>${src}</small>`);
}

loadData();
