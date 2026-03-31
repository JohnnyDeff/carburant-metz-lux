// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const API_BE_URL = '/api/belgium-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78, GPL: 0.95, E85: 0.85 };
let bePrices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85, GPL: 0.80, E85: 0.90 };
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.45, 6.15], 9); 
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
const markerCluster = L.markerClusterGroup({ chunkedLoading: true });

function getIcons(serv, h24) {
    let i = (h24 === "Oui" || h24 === true) ? '🕒 ' : '';
    if (!serv) return i;
    const s = Array.isArray(serv) ? serv.join(" ").toLowerCase() : serv.toLowerCase();
    if (s.includes('toilettes')) i += '🚻 ';
    if (s.includes('boutique')) i += '🛒 ';
    if (s.includes('lavage')) i += '💦 ';
    return i;
}

// ── CHARGEMENT ──
async function loadData() {
    // 1. PRIX NATIONAUX
    try {
        const resL = await fetch(API_LUX_URL);
        if (resL.ok) luxePrices = await resL.json();
        const resB = await fetch(API_BE_URL);
        if (resB.ok) bePrices = await resB.json();
        console.log("✅ Prix nationaux chargés");
    } catch (e) { console.log("⚠️ Utilisation prix secours"); }

    stationsList = [];

    // 2. APPEL FRANCE (On simplifie pour debug)
    try {
        // Test avec 2 départements seulement pour voir si ça débloque
        const urlFR = `${FR_API_URL}?limit=100&where=code_departement%20in%20('57','54')`;
        console.log("📡 Appel France sur :", urlFR);
        
        const frRes = await fetch(urlFR);
        const frData = await frRes.json();
        
        if (frData.results && frData.results.length > 0) {
            console.log("🇫🇷 Stations FR reçues :", frData.results.length);
            frData.results.forEach(s => {
                // On récupère les coordonnées de manière très souple
                const lat = s.geom?.lat || s.latitude;
                const lon = s.geom?.lon || s.longitude;
                
                if (lat && lon) {
                    stationsList.push({
                        name: s.name || s.marque || s.ville || "Station FR",
                        lat: parseFloat(lat),
                        lon: parseFloat(lon),
                        country: 'FR',
                        icons: getIcons(s.services_service, s.horaires_automate_24_24),
                        prices: { Diesel: s.gazole_prix, SP95: s.sp95_prix, SP98: s.sp98_prix, GPL: s.gpl_prix, E10: s.e10_prix, E85: s.e85_prix },
                        ruptures: { Diesel: !!s.gazole_rupture_debut, SP95: !!s.sp95_rupture_debut, SP98: !!s.sp98_rupture_debut, GPL: !!s.gpl_rupture_debut, E10: !!s.e10_rupture_debut, E85: !!s.e85_rupture_debut }
                    });
                }
            });
        } else {
            console.log("❌ L'API France a répondu mais la liste est VIDE");
        }
    } catch (e) { console.error("🔥 Erreur critique France:", e); }

    // 3. APPEL TOMTOM (LUX & BE)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.45&lon=6.15&radius=50000&limit=100`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            console.log("🌍 Stations TomTom reçues :", ttData.results.length);
            ttData.results.forEach(poi => {
                const c = poi.address.countryCode;
                if (c === 'LU' || c === 'BE') {
                    stationsList.push({
                        name: poi.poi.name, lat: poi.position.lat, lon: poi.position.lon, country: c,
                        icons: '🕒', prices: (c === 'LU' ? luxePrices : bePrices), ruptures: {}
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    console.log("🏁 Total final stations :", stationsList.length);
    updateDisplay();
}

function updateDisplay() {
    markerCluster.clearLayers();
    let listHTML = '';
    const refLux = luxePrices[activeFuel] || 1.6;

    stationsList.forEach(s => {
        const p = s.prices[activeFuel];
        if (p && !s.ruptures[activeFuel]) {
            let col = (s.country === 'LU') ? '#60a5fa' : (s.country === 'BE' ? '#f97316' : (p < refLux ? '#fbbf24' : '#10b981'));
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: col, color: '#000', weight: 1, fillOpacity: 0.9 })
                      .bindPopup(`<b>${s.name}</b><br>${p.toFixed(3)}€<br>${s.icons}`);
            markerCluster.addLayer(m);
            
            listHTML += `<div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 14)">
                <div style="display:flex; justify-content:space-between;">
                    <span><b>${s.name}</b><br><small>${s.icons}</small></span>
                    <b style="color:${col}">${p.toFixed(3)}€</b>
                </div></div>`;
        }
    });
    map.addLayer(markerCluster);
    document.getElementById('station-list').innerHTML = listHTML;
    
    // Mise à jour visuelle du panneau
    const el = document.getElementById('lu-prices');
    if (el) {
        el.innerHTML = `
            <div style="font-size:12px; margin-bottom:5px;"><span style="color:#60a5fa">🇱🇺 Lux:</span> <b>${luxePrices[activeFuel]?.toFixed(3)}€</b></div>
            <div style="font-size:12px;"><span style="color:#f97316">🇧🇪 Bel:</span> <b>${bePrices[activeFuel]?.toFixed(3)}€</b></div>
        `;
    }
}

function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay();
}

function locateUser() { map.locate({setView: true, maxZoom: 13}); }

loadData();
