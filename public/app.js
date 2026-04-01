// --- CONFIGURATION ---
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ'; // 

// --- VARIABLES GLOBALES ---
let map, tileLayer, userMarker;
let isDarkMode = true;
let stationsList = [];
let markers = []; // Pour garder une trace et effacer les points sur la carte
let selectedFuel = 'Diesel';
let mapTimeout; // Pour le Debounce (anti-spam)

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialise la carte centrée sur Metz
    map = L.map('map').setView([49.45, 6.15], 10);
    tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

    // Écouteur de mouvement avec DEBOUNCE (1 seconde)
    map.on('moveend', () => {
        clearTimeout(mapTimeout);
        mapTimeout = setTimeout(() => {
            const center = map.getCenter();
            loadData(center.lat, center.lng);
        }, 1000);
    });

    // Premier chargement
    loadData(49.45, 6.15);
});

// --- ACTIONS GLOBALES (Attachées à window pour le HTML) ---

window.toggleTheme = function() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('light-mode', !isDarkMode);
    
    const btn = document.getElementById('theme-btn');
    if (isDarkMode) {
        btn.innerHTML = '☀️ Thème Clair';
        tileLayer.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
    } else {
        btn.innerHTML = '🌙 Thème Sombre';
        // Le thème "voyager" est magnifique en mode clair
        tileLayer.setUrl('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png');
    }
};

window.locateUser = function() { 
    map.locate({setView: true, maxZoom: 13}); 
};

// Géolocalisation réussie (Point bleu)
map.on('locationfound', function(e) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circleMarker(e.latlng, {
        radius: 8, fillColor: "#3b82f6", color: "#ffffff", weight: 2, fillOpacity: 1
    }).addTo(map).bindPopup("📍 Vous êtes ici !").openPopup();
    
    loadData(e.latlng.lat, e.latlng.lng);
});

window.filterFuel = function(fuel) {
    selectedFuel = fuel;
    
    // Met à jour la couleur des boutons
    document.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${fuel}`).classList.add('active');
    
    // Rafraîchit l'affichage
    window.updateDisplay();
};

// --- CHARGEMENT DES DONNÉES ---
async function loadData(lat, lng) {
    document.getElementById('stations-list').innerHTML = '<div style="padding:15px; text-align:center;">Recherche en cours... ⏳</div>';
    stationsList = []; // On vide la liste

    try {
        // 1. Récupérer les prix nationaux LU et BE
        const luxRes = await fetch('/api/lux-prices');
        const luxPrices = await luxRes.json();
        const beRes = await fetch('/api/belgium-prices');
        const bePrices = await beRes.json();

        // 2. TomTom (Stations Essence LU et BE)
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100&countrySet=LU,BE`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            ttData.results.forEach(s => {
                const country = s.address.countryCode; // 'LU' ou 'BE'
                stationsList.push({
                    name: s.poi.name || s.poi.brands?.[0]?.name || "Station",
                    lat: s.position.lat, lon: s.position.lon,
                    country: country,
                    icons: country === 'LU' ? '🇱🇺' : '🇧🇪',
                    prices: country === 'LU' ? luxPrices : bePrices
                });
            });
        }
    } catch (e) { console.error("Erreur LU/BE:", e); }

    try {
        // 3. TomTom (BORNES ÉLECTRIQUES)
        const evRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/electric%20vehicle%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=50000&limit=100`);
        const evData = await evRes.json();
        if (evData.results) {
            evData.results.forEach(s => {
                stationsList.push({
                    name: s.poi.name || "Borne de Recharge",
                    lat: s.position.lat, lon: s.position.lon,
                    country: 'EU', icons: '⚡',
                    prices: { Elec: "Service" } // Pas de vrai prix numérique
                });
            });
        }
    } catch (e) { console.error("Erreur EV:", e); }

    try {
        // 4. API France
        const frRes = await fetch(`/api/france-proxy?lat=${lat}&lng=${lng}`);
        const frData = await frRes.json();
        const records = frData.results || frData.records || [];
        
        records.forEach(r => {
            let prices = {};
            // Parse le JSON interne de l'API française
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
            
            // Simplification SP95 / E10
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

    try {
        // 5. API Allemagne (Tankerkönig)
        const deRes = await fetch(`/api/germany-proxy?lat=${lat}&lng=${lng}`);
        const deData = await deRes.json();
        if (deData.ok && deData.stations) {
            deData.stations.forEach(s => {
                if (s.isOpen) {
                    stationsList.push({
                        name: s.name || s.brand || "Station DE",
                        lat: s.lat, lon: s.lng,
                        country: 'DE', icons: '🇩🇪',
                        prices: { 
                            Diesel: s.diesel, 
                            SP95: s.e5 || s.e10, // Tankerkönig donne e5 et e10
                            SP98: null // Pas de SP98 en Allemagne via cette API
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur Allemagne:", e); }

    window.updateDisplay();
}

// --- AFFICHAGE ---
window.updateDisplay = function() {
    // 1. Nettoyer la carte
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    const listContainer = document.getElementById('stations-list');
    listContainer.innerHTML = '';

    // 2. Filtrer les stations qui ont le carburant sélectionné
    let filtered = stationsList.filter(s => {
        return s.prices && s.prices[selectedFuel] !== undefined && s.prices[selectedFuel] !== null;
    });

    // 3. Trier par prix (les bornes électriques "Service" iront en bas)
    filtered.sort((a, b) => {
        const priceA = typeof a.prices[selectedFuel] === 'number' ? a.prices[selectedFuel] : 999;
        const priceB = typeof b.prices[selectedFuel] === 'number' ? b.prices[selectedFuel] : 999;
        return priceA - priceB;
    });

    if (filtered.length === 0) {
        listContainer.innerHTML = '<div style="padding:15px; text-align:center;">Aucune station trouvée dans cette zone pour ce carburant.</div>';
        return;
    }

    // 4. Créer les points sur la carte et la liste
    filtered.forEach(s => {
        const priceVal = s.prices[selectedFuel];
        // Si c'est un chiffre, on met le sigle €, sinon on écrit le texte direct ("Service")
        const priceText = typeof priceVal === 'number' ? priceVal.toFixed(3) + ' €' : priceVal;

        // Marqueur Carte
        const marker = L.marker([s.lat, s.lon]).bindPopup(`<b>${s.icons} ${s.name}</b><br>${selectedFuel}: <b>${priceText}</b>`);
        marker.addTo(map);
        markers.push(marker);

        // Élément dans la liste gauche
        const div = document.createElement('div');
        div.className = 'station-item';
        div.innerHTML = `<strong>${s.icons} ${s.name}</strong><br><small>${selectedFuel}: <b style="color: ${typeof priceVal === 'number' ? 'inherit' : '#8b5cf6'}">${priceText}</b></small>`;
        
        // Clic sur la liste = focus sur la carte
        div.onclick = () => {
            map.setView([s.lat, s.lon], 14);
            marker.openPopup();
        };
        listContainer.appendChild(div);
    });
};
