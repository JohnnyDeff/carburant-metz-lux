// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = {};
let activeFuel = 'Diesel';
const map = L.map('map').setView([49.35, 6.15], 10); // Centré sur l'axe A31

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | &copy; TomTom'
}).addTo(map);

// ── FONCTION DE CALCUL DE PROXIMITÉ (Matching France) ──
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadFullNetwork() {
    try {
        // 1. Récupérer les prix LUX (Dynamiques via ton backend Statec)
        const luxRes = await fetch(API_LUX_URL);
        luxePrices = await luxRes.json();

        // 2. Récupérer les prix FRANCE (Flux Instantané v2)
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        const frStations = frData.results || [];

        // 3. Chercher la géographie des stations via TomTom (Rayon 40km autour de Thionville)
        const ttUrl = `https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.35&lon=6.15&radius=40000&limit=100`;
        const ttRes = await fetch(ttUrl);
        const ttData = await ttRes.json();

        // Nettoyage de la carte
        map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });

        ttData.results.forEach(poi => {
            const lat = poi.position.lat;
            const lon = poi.position.lon;
            const country = poi.address.countryCode; // 'FR' ou 'LU'
            const brand = poi.poi.name;
            let price = null;
            let info = "";

            if (country === 'LU') {
                // Stratégie LUX : On applique le prix national Statec
                price = luxePrices[activeFuel];
                info = "Prix Officiel Luxembourg";
                createMarker(lat, lon, brand, price, '#60a5fa', info);
            } 
            else if (country === 'FR') {
                // Stratégie FR : Matching géographique avec le flux v2 (si < 100m)
                const match = frStations.find(f => getDistance(lat, lon, f.geom.lat, f.geom.lon) < 100);
                
                if (match) {
                    const fuelKey = activeFuel === 'Diesel' ? 'gazole_prix' : 
                                   activeFuel === 'SP95' ? 'sp95_prix' : 'sp98_prix';
                    price = match[fuelKey];
                    
                    if (price) {
                        const color = price < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
                        info = "Flux Instantané v2";
                        createMarker(lat, lon, brand, price, color, info);
                    }
                }
            }
        });

    } catch (e) {
        console.error("Erreur lors du chargement des données:", e);
    }
}

function createMarker(lat, lon, name, price, color, source) {
    L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: color,
        color: "#000",
        weight: 1,
        fillOpacity: 0.9
    }).addTo(map).bindPopup(`
        <div style="font-family: 'Syne', sans-serif;">
            <b style="font-size:14px;">${name}</b><br>
            <span style="font-size:18px; font-weight:bold;">${price.toFixed(3)} €</span><br>
            <small style="opacity:0.7;">${source}</small>
        </div>
    `);
}

// Lancement
loadFullNetwork();
