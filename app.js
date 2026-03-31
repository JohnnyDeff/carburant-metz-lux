// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// Coordonnées pivot (entre Thionville et Luxembourg pour un équilibre parfait)
const CENTER_LAT = 49.45; 
const CENTER_LNG = 6.15;
const SEARCH_RADIUS = 50; // Rayon de 50km demandé

let luxePrices = { Diesel: 1.50, SP95: 1.60, SP98: 1.70, GPL: 0.90 }; 
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([CENTER_LAT, CENTER_LNG], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | TomTom'
}).addTo(map);

// Groupe de clusters pour la performance visuelle
const markerCluster = L.markerClusterGroup({ chunkedLoading: true });

// ── FONCTIONS UTILITAIRES ──
function getServicesIcons(services, is24h) {
    let icons = is24h === "Oui" ? '🕒 ' : '';
    if (!services) return icons;
    const s = Array.isArray(services) ? services.join(" ").toLowerCase() : services.toLowerCase();
    if (s.includes('toilettes')) icons += '🚻 ';
    if (s.includes('boutique')) icons += '🛒 ';
    if (s.includes('lavage')) icons += '💦 ';
    if (s.includes('gonflage')) icons += '💨 ';
    return icons;
}

// ── MOTEUR DE RECHERCHE ──
async function loadData(lat = CENTER_LAT, lng = CENTER_LNG) {
    console.log("Initialisation zone Metz-Lux...");
    
    // 1. Récupération prix LUX (Backend)
    try {
        const res = await fetch(API_LUX_URL);
        if (res.ok) luxePrices = await res.json();
        renderLuPrices();
    } catch (e) { console.warn("Mode dégradé: Prix Lux par défaut."); }

    stationsList = [];

    // 2. Récupération France (API Gouv) - Limitée au rayon de 50km
    try {
        const geoFilter = encodeURIComponent(`within_distance(geom, GEOMETRY'POINT(${lng} ${lat})', ${SEARCH_RADIUS}km)`);
        const frRes = await fetch(`${FR_API_URL}?limit=250&where=${geoFilter}`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                stationsList.push({
                    name: s.name || s.marque || s.ville || "Station",
                    lat: s.geom.lat, lon: s.geom.lon, country: 'FR',
                    icons: getServicesIcons(s.services_service, s.horaires_automate_24_24),
                    prices: { Diesel: s.gazole_prix, SP95: s.sp95_prix, SP98: s.sp98_prix, GPL: s.gpl_prix, E10: s.e10_prix, E85: s.e85_prix },
                    ruptures: { Diesel: !!s.gazole_rupture_debut, SP95: !!s.sp95_rupture_debut, SP98: !!s.sp98_rupture_debut, GPL: !!s.gpl_rupture_debut, E10: !!s.e10_rupture_debut, E85: !!s.e85_rupture_debut }
                });
            });
        }
    } catch (e) { console.error("Erreur France:", e); }

    // 3. Récupération Luxembourg (TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=${SEARCH_RADIUS * 1000}&limit=100`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name, lat: poi.position.lat, lon: poi.position.lon, country: 'LU',
                        icons: '🕒', prices: luxePrices, ruptures: {}
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    updateDisplay();
}

function updateDisplay() {
    markerCluster.clearLayers();
    let listHTML = '';

    stationsList.forEach(s => {
        const price = s.prices[activeFuel];
        const isRupture = s.ruptures[activeFuel];
        const luxRef = luxePrices[activeFuel] || 1.6;
        
        if (isRupture) {
            const m = L.circleMarker([s.lat, s.lon], { radius: 7, fillColor: '#ef4444', color: '#000', weight: 1, fillOpacity: 0.8 })
                      .bindPopup(`<b>${s.name}</b><br><b style="color:#ef4444">RUPTURE</b>`);
            markerCluster.addLayer(m);
        } else if (price) {
            let color = s.country === 'LU' ? '#60a5fa' : (price < luxRef ? '#fbbf24' : '#10b981');
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: color, color: '#000', weight: 1, fillOpacity: 0.9 })
                      .bindPopup(`<b>${s.name}</b><br><span style="font-size:15px; font-weight:bold;">${price.toFixed(3)} €</span><br>${s.icons}`);
            markerCluster.addLayer(m);
            
            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 14)" style="cursor:pointer; padding:10px; border-bottom:1px solid #374151;">
                    <div style="display:flex; justify-content:space-between;">
                        <span><b>${s.name}</b><br><small>${s.icons}</small></span>
                        <b style="color:${color}">${price.toFixed(3)}€</b>
                    </div>
                </div>`;
        }
    });

    map.addLayer(markerCluster);
    document.getElementById('station-list').innerHTML = listHTML;
}

// UI
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay();
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'E10', 'SP98', 'GPL', 'E85'].map(f => `
        <div style="display:flex; justify-content:space-between; font-size:13px; padding:2px 0;">
            <span>${f}</span><b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>`).join('');
}

// Chargement initial immédiat
loadData();
