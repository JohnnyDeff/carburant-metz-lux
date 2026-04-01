// --- CONFIGURATION ---
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ'; //

// --- VARIABLES GLOBALES ---
let map, tileLayer, userMarker, markersGroup; // <-- markersGroup ajouté ici
let isDarkMode = true;
let stationsList = [];
let selectedFuel = 'Diesel';
let mapTimeout;

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Création de la carte
    map = L.map('map').setView([49.45, 6.15], 10);
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

    // 2. Initialisation du groupe de Clusters (Regroupement)
    markersGroup = L.markerClusterGroup({
        disableClusteringAtZoom: 14 // Les clusters éclatent si on zoome très près
    });
    map.addLayer(markersGroup);

    // 3. Gestion du Spam (Debounce)
    map.on('moveend', () => {
        clearTimeout(mapTimeout);
        mapTimeout = setTimeout(() => {
            const center = map.getCenter();
            loadData(center.lat, center.lng);
        }, 1000);
    });

    // 4. Géolocalisation
    map.on('locationfound', function(e) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker(e.latlng, {
            radius: 8, fillColor: "#3b82f6", color: "#ffffff", weight: 2, fillOpacity: 1
        }).addTo(map).bindPopup("📍 Vous êtes ici !").openPopup();
        
        loadData(e.latlng.lat, e.latlng.lng);
    });

    // 5. Premier chargement au démarrage
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

    // 1. LU et BE
    try {
        const [luxRes, beRes] = await Promise.all([
            fetch('/api/lux-prices'),
            fetch('/api/belgium-prices')
        ]);
        const luxPrices = await luxRes.json();
        const bePrices = await beRes.json();

        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100&countrySet=LU,BE`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            ttData.results.forEach(s => {
                const country = s.address.countryCode;
                stationsList.push({
                    name: s.poi.name || s.poi.brands?.[0]?.name || "Station",
                    lat: s.position.lat, lon: s.position.lon,
                    country: country,
                    icons: country === 'LU' ? '🇱🇺' : '🇧🇪',
                    prices: country === 'LU' ? luxPrices : bePrices
                });
            });
        }
    } catch (e) { console.error("Erreur LU/BE/TomTom:", e); }

    // 2. Électricité
    try {
        const evRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/electric%20vehicle%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100`);
        const evData = await evRes.json();
        if (evData.results) {
            evData.results.forEach(s => {
                stationsList.push({
                    name: s.poi.name || "Borne Recharge",
                    lat: s.position.lat, lon: s.position.lon,
                    country: 'EU', icons: '⚡',
                    prices: { Elec: "Service" }
                });
            });
        }
    } catch (e) { console.error("Erreur EV:", e); }

    // 3. France
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
                stationsList.push({
                    name: "Station FR",
                    lat: r.geom ? r.geom.lat : null, lon: r.geom ? r.geom.lon : null,
                    country: 'FR', icons: '🇫🇷', prices: prices
                });
            }
        });
    } catch (e) { console.error("Erreur France:", e); }

    // 4. Allemagne
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
                        prices: { Diesel: s.diesel, SP95: s.e5 || s.e10, SP98: null }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur Allemagne:", e); }

    window.updateDisplay();
}

// --- AFFICHAGE ---
window.updateDisplay = function() {
    // Nettoie tous les clusters d'un seul coup (beaucoup plus propre !)
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

        // Création du marqueur et ajout DANS LE CLUSTER
        const marker = L.marker([s.lat, s.lon]).bindPopup(`<b>${s.icons} ${s.name}</b><br>${selectedFuel}: <b>${priceText}</b>`);
        markersGroup.addLayer(marker);

        const div = document.createElement('div');
        div.className = 'station-item';
        div.innerHTML = `<strong>${s.icons} ${s.name}</strong><br><small>${selectedFuel}: <b style="color: ${typeof priceVal === 'number' ? 'inherit' : '#8b5cf6'}">${priceText}</b></small>`;
        
        div.onclick = () => { 
            // On zoome sur le cluster pour l'éclater
            map.setView([s.lat, s.lon], 15); 
            marker.openPopup(); 
        };
        listContainer.appendChild(div);
    });
};
