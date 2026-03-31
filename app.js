// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.45, SP95: 1.55, SP98: 1.65, GPL: 0.85 }; 
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE (Centrée sur Metz-Lux) ──
const map = L.map('map').setView([49.35, 6.15], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | TomTom | OpenData'
}).addTo(map);

// ── APPARITION DU BOUTON AU DÉPLACEMENT ──
map.on('moveend', () => {
    // Dès que l'utilisateur a fini de bouger la carte, on affiche le bouton
    document.getElementById('search-btn').style.display = 'block';
});

// ── INITIALISATION CLUSTERING ──
const markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true
});

function locateUser() { 
    map.locate({setView: true, maxZoom: 12}); 
    // Quand on trouve l'utilisateur, on lance une recherche automatique autour de lui
    map.once('locationfound', (e) => {
        L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 })
            .addTo(map).bindPopup("Vous êtes ici").openPopup();
        searchArea();
    });
}

function getServicesIcons(servicesData, is24_24) {
    let icons = '';
    if (is24_24 === "Oui" || is24_24 === true) icons += '🕒<span style="font-size:10px">24/7</span> ';
    if (!servicesData) return icons;

    const text = Array.isArray(servicesData) ? servicesData.join(" ").toLowerCase() : servicesData.toLowerCase();
    if (text.includes('toilettes')) icons += '🚻 ';
    if (text.includes('boutique') || text.includes('alimentaire')) icons += '🛒 ';
    if (text.includes('lavage') || text.includes('pression')) icons += '💦 ';
    if (text.includes('gonflage')) icons += '💨 ';
    if (text.includes('colis')) icons += '📦 ';
    if (text.includes('restauration')) icons += '🍔 ';
    return icons;
}

// ── FONCTION DÉCLENCHÉE PAR LE BOUTON ──
async function searchArea() {
    // 1. On cache le bouton
    document.getElementById('search-btn').style.display = 'none';
    
    // 2. On récupère le point central de l'écran actuel
    const center = map.getCenter();
    
    // 3. On lance le chargement des données pour ce point précis
    await loadData(center.lat, center.lng);
}

// ── CHARGEMENT DES DONNÉES DYNAMIQUES ──
async function loadData(lat = 49.35, lng = 6.15) { // Par défaut: Axe Metz-Lux
    try {
        const luxRes = await fetch(API_LUX_URL);
        if (luxRes.ok) luxePrices = await luxRes.json();
        renderLuPrices();
    } catch (e) { console.warn("Backend Lux injoignable."); }

    stationsList = []; 
    const radiusKm = 40; // Rayon de recherche autour de l'écran

    // FRANCE : Recherche uniquement dans un rayon de 40km du centre de l'écran
    try {
        // Syntaxe officielle Opendatasoft v2.1 pour filtrer géographiquement
        const frQuery = `within_distance(geom, GEOMETRY'POINT(${lng} ${lat})', ${radiusKm}km)`;
        const frRes = await fetch(`${FR_API_URL}?limit=300&where=${encodeURIComponent(frQuery)}`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                const sLat = s.geom?.lat || s.latitude;
                const sLon = s.geom?.lon || s.longitude;
                
                if (sLat && sLon) {
                    stationsList.push({
                        name: s.name || s.marque || s.ville || "Station Service",
                        lat: sLat, lon: sLon, country: 'FR',
                        icons: getServicesIcons(s.services_service, s.horaires_automate_24_24),
                        prices: { Diesel: s.gazole_prix, SP95: s.sp95_prix, SP98: s.sp98_prix, GPL: s.gpl_prix, E10: s.e10_prix, E85: s.e85_prix },
                        ruptures: { Diesel: !!s.gazole_rupture_debut, SP95: !!s.sp95_rupture_debut, SP98: !!s.sp98_rupture_debut, GPL: !!s.gpl_rupture_debut, E10: !!s.e10_rupture_debut, E85: !!s.e85_rupture_debut }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur API France:", e); }

    // LUXEMBOURG : TomTom cherche autour du même centre
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=${lat}&lon=${lng}&radius=${radiusKm * 1000}&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name || "Station LUX", lat: poi.position.lat, lon: poi.position.lon, country: 'LU',
                        icons: '', prices: luxePrices, ruptures: {}
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
        const isRupture = s.ruptures && s.ruptures[activeFuel];
        
        if (isRupture) {
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: '#ef4444', color: "#000", weight: 1, fillOpacity: 0.9 })
             .bindPopup(`<b>${s.name}</b><br><span style="color:#ef4444; font-weight:bold;">⚠️ EN RUPTURE</span>`);
            markerCluster.addLayer(m);
            listHTML += `<div class="station-item" style="opacity: 0.5; border-bottom:1px solid #444;"><div class="st-name"><b>${s.name}</b></div><div style="color:#ef4444; font-weight: bold;">⚠️ RUPTURE</div></div>`;
        } 
        else if (price) {
            const luxRefPrice = luxePrices[activeFuel] || 1.5;
            let color = s.country === 'LU' ? '#60a5fa' : (price < luxRefPrice ? '#f0c040' : '#4ade80');
            const src = s.country === 'LU' ? "Luxembourg (National)" : "France (Officiel)";
            
            const popupContent = `<div><b>${s.name}</b><br><span style="font-size:16px; font-weight:bold;">${price.toFixed(3)} €</span><br><small style="color:#666;">${src}</small>${s.icons ? `<div style="margin-top: 8px; font-size: 14px;">${s.icons}</div>` : ''}</div>`;

            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
             .bindPopup(popupContent);
            markerCluster.addLayer(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)" style="cursor:pointer; padding:8px 5px; border-bottom:1px solid #444;">
                    <div style="display:flex; justify-content:space-between;">
                        <div class="st-name"><b>${s.name}</b><div style="font-size: 12px; margin-top: 3px;">${s.icons}</div></div>
                        <div style="color:${color}; font-weight:bold;">${price.toFixed(3)} €</div>
                    </div>
                </div>
            `;
        }
    });

    map.addLayer(markerCluster);
    const listEl = document.getElementById('station-list');
    if (listEl) listEl.innerHTML = listHTML;
}

function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if(btn) btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay(); 
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'E10', 'SP98', 'GPL', 'E85'].map(f => `
        <div class="price-row" style="display:flex; justify-content:space-between;">
            <span>${f}</span><b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>
    `).join('');
}

// ── DÉMARRAGE ──
loadData();
