// --- CONFIGURATION ---
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';

// --- VARIABLES GLOBALES ---
let map, tileLayer, userMarker, markersGroup; 
let isDarkMode = true;
let stationsList = [];
let selectedFuel = 'Diesel';
let mapTimeout;

// --- FONCTION DE CALCUL DE DISTANCE (Pour fusionner API FR et TomTom) ---
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
    const R = 6371e3; // Rayon de la terre en mètres
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    map = L.map('map').setView([49.45, 6.15], 10);
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

    markersGroup = L.markerClusterGroup({ disableClusteringAtZoom: 14 });
    map.addLayer(markersGroup);

    map.on('moveend', () => {
        clearTimeout(mapTimeout);
        mapTimeout = setTimeout(() => {
            const center = map.getCenter();
            loadData(center.lat, center.lng);
        }, 1000);
    });

    map.on('locationfound', function(e) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker(e.latlng, {
            radius: 8, fillColor: "#3b82f6", color: "#ffffff", weight: 2, fillOpacity: 1
        }).addTo(map).bindPopup("📍 Vous êtes ici !").openPopup();
        loadData(e.latlng.lat, e.latlng.lng);
    });

    loadData(49.45, 6.15);
});

// --- ACTIONS DES BOUTONS ---
window.toggleTheme = function() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('light-mode', !isDarkMode);
    
    const btn = document.getElementById('theme-btn');
    if (isDarkMode) {
        btn.innerHTML = '☀️ Thème Clair';
        tileLayer.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
    } else {
        btn.innerHTML = '🌙 Thème Sombre';
        tileLayer.setUrl('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png');
    }
};

window.locateUser = function() { 
    map.locate({setView: true, maxZoom: 13}); 
};

window.filterFuel = function(fuel) {
    selectedFuel = fuel;
    document.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${fuel}`).classList.add('active');
    updateDisplay();
};

// --- LOGIQUE MÉTIER ---
async function loadData(lat, lng) {
    document.getElementById('stations-list').innerHTML = '<div style="padding:15px; text-align:center;">Recherche en cours... ⏳</div>';
    stationsList = [];

    let tomtomStations = []; // On va stocker toutes les stations TomTom pour le mappage

    // 1. Récupération GLOBALE TomTom (pour trouver les noms FR, LU et BE)
    try {
        // On enlève le countrySet=LU,BE pour avoir aussi la France
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            ttData.results.forEach(s => {
                tomtomStations.push({
                    name: s.poi.name || s.poi.brands?.[0]?.name || "Station",
                    lat: s.position.lat, lon: s.position.lon,
                    countryCode: s.address.countryCode
                });
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    // 2. LU et BE (Utilisation des données TomTom)
    try {
        const [luxRes, beRes] = await Promise.all([
            fetch('/api/lux-prices'),
            fetch('/api/belgium-prices')
        ]);
        const luxPrices = await luxRes.json();
        const bePrices = await beRes.json();

        tomtomStations.forEach(tt => {
            if (tt.countryCode === 'LU' || tt.countryCode === 'BE') {
                stationsList.push({
                    name: tt.name,
                    lat: tt.lat, lon: tt.lon,
                    country: tt.countryCode,
                    icons: tt.countryCode === 'LU' ? '🇱🇺' : '🇧🇪',
                    prices: tt.countryCode === 'LU' ? luxPrices : bePrices,
                    services: [] // Pas de services dispo pour LU/BE via cette API
                });
            }
        });
    } catch (e) { console.error("Erreur LU/BE:", e); }

    // 3. Électricité
    try {
        const evRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/electric%20vehicle%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100`);
        const evData = await evRes.json();
        if (evData.results) {
            evData.results.forEach(s => {
                stationsList.push({
                    name: s.poi.name || "Borne Recharge",
                    lat: s.position.lat, lon: s.position.lon,
                    country: 'EU', icons: '⚡',
                    prices: { Elec: "Service" },
                    services: []
                });
            });
        }
    } catch (e) { console.error("Erreur EV:", e); }

    // 4. France (Fusion TomTom + Services)
    try {
        const frRes = await fetch(`/api/france-proxy?lat=${lat}&lng=${lng}`);
        const frData = await frRes.json();
        const records = frData.results || frData.records || [];
        
        records.forEach(r => {
            let prices = {};
            try {
                const prixList = typeof r.prix === 'string' ? JSON.parse(r.prix) : r.prix;
                if (Array.isArray(prixList)) {
                    prixList.forEach(p => {
                        if (p['@nom'] === 'Gazole') prices.Diesel = parseFloat(p['@valeur']);
                        if (p['@nom'] === 'E10') prices.E10 = parseFloat(p['@valeur']);
                        if (p['@nom'] === 'SP95') prices.SP95 = parseFloat(p['@valeur']);
                        if (p['@nom'] === 'SP98') prices.SP98 = parseFloat(p['@valeur']);
                    });
                }
            } catch(e) {}
            
            if (!prices.SP95 && prices.E10) prices.SP95 = prices.E10;

            if (Object.keys(prices).length > 0) {
                const frLat = r.geom ? r.geom.lat : null;
                const frLon = r.geom ? r.geom.lon : null;

                // --- LE FAMEUX MAPPAGE AVEC TOMTOM (Amélioré) ---
                let finalName = "";
                if (frLat && frLon) {
                    // On élargit la zone de recherche à 250 mètres (pour les grands supermarchés)
                    const nearestTT = tomtomStations.find(tt => getDistance(tt.lat, tt.lon, frLat, frLon) < 250);
                    
                    if (nearestTT) {
                        // On vérifie que TomTom a un vrai nom, pas un truc générique
                        const badNames = ["station", "gas station", "station service", "station-service"];
                        if (!badNames.includes(nearestTT.name.toLowerCase())) {
                            finalName = nearestTT.name;
                        }
                    }
                }
                
                // Si la station TomTom est introuvable (ou si son nom est nul), on garde la belle adresse
                if (!finalName) {
                    const street = r.adresse || "";
                    const city = r.ville ? r.ville.toUpperCase() : "";
                    finalName = street ? `${street} - ${city}` : "Station FR";
                }

                // --- EXTRACTION DES SERVICES ---
                let extractedServices = [];
                if (r.services_service) {
                    // L'API sépare souvent les services avec " // "
                    if (typeof r.services_service === 'string') {
                        extractedServices = r.services_service.split('//').map(s => s.trim()).filter(s => s !== '');
                    } else if (Array.isArray(r.services_service)) {
                        extractedServices = r.services_service;
                    }
                }

                stationsList.push({
                    name: finalName,
                    lat: frLat, lon: frLon,
                    country: 'FR', icons: '🇫🇷', prices: prices,
                    services: extractedServices
                });
            }
        });
    } catch (e) { console.error("Erreur France:", e); }

    // 5. Allemagne
    try {
        const deRes = await fetch(`/api/germany-proxy?lat=${lat}&lng=${lng}`);
        const deData = await deRes.json();
        if (deData.ok && deData.stations) {
            deData.stations.forEach(s => {
                if (s.isOpen) {
                    stationsList.push({
                        name: s.name || s.brand || "Station DE",
                        lat: s.lat, lon: s.lng,
                        country: 'DE', icons: '🇩🇪',
                        prices: { Diesel: s.diesel, SP95: s.e5 || s.e10, SP98: null },
                        services: [] // Tankerkönig ne donne pas les services dans cette version
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur Allemagne:", e); }

    window.updateDisplay();
}

// --- AFFICHAGE ---
window.updateDisplay = function() {
    markersGroup.clearLayers();
    
    const listContainer = document.getElementById('stations-list');
    listContainer.innerHTML = '';

    let filtered = stationsList.filter(s => s.prices && s.prices[selectedFuel] !== undefined && s.prices[selectedFuel] !== null);

    filtered.sort((a, b) => {
        const priceA = typeof a.prices[selectedFuel] === 'number' ? a.prices[selectedFuel] : 999;
        const priceB = typeof b.prices[selectedFuel] === 'number' ? b.prices[selectedFuel] : 999;
        return priceA - priceB;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = '<div style="padding:15px; text-align:center;">Aucune station trouvée.</div>';
        return;
    }

    filtered.forEach(s => {
        const priceVal = s.prices[selectedFuel];
        const priceText = typeof priceVal === 'number' ? priceVal.toFixed(3) + ' €' : priceVal;

        // Gestion des tendances (LUX)
        let trendIcon = '';
        if (s.country === 'LU' && s.prices.trends && s.prices.trends[selectedFuel]) {
            const trend = s.prices.trends[selectedFuel];
            if (trend === 'hausse') trendIcon = ' <span style="color:#ef4444; font-weight:bold;">↗</span>';
            if (trend === 'baisse') trendIcon = ' <span style="color:#10b981; font-weight:bold;">↘</span>';
            if (trend === 'stable') trendIcon = ' <span style="color:#9ca3af; font-weight:bold;">=</span>';
        }

        // --- GESTION DES SERVICES (AFFICHAGE) ---
        let servicesHtml = '';
        if (s.services && s.services.length > 0) {
            // On affiche les 3 premiers services pour ne pas inonder l'écran
            const displayServices = s.services.slice(0, 3).join(' • ');
            const extra = s.services.length > 3 ? '...' : '';
            servicesHtml = `<br><small style="color:#888; display:block; margin-top:4px; font-size:0.8em;">🛠️ ${displayServices}${extra}</small>`;
        }

        const marker = L.marker([s.lat, s.lon]).bindPopup(`<b>${s.icons} ${s.name}</b><br>${selectedFuel}: <b>${priceText}</b>${trendIcon}${servicesHtml}`);
        markersGroup.addLayer(marker);

        const div = document.createElement('div');
        div.className = 'station-item';
        div.innerHTML = `<strong>${s.icons} ${s.name}</strong><br><small>${selectedFuel}: <b style="color: ${typeof priceVal === 'number' ? 'inherit' : '#8b5cf6'}">${priceText}</b>${trendIcon}</small>${servicesHtml}`;
        
        div.onclick = () => { 
            map.setView([s.lat, s.lon], 15); 
            marker.openPopup(); 
        };
        listContainer.appendChild(div);
    });
};
