// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.45, SP95: 1.55, SP98: 1.65, GPL: 0.85 }; // Prix de secours
let activeFuel = 'Diesel';
let stationsList = []; // Stocke les données pour la liste HTML

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.35, 6.15], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB | TomTom | OpenData'
}).addTo(map);

// ── INITIALISATION CLUSTERING ──
// Ce groupe va automatiquement regrouper les stations trop proches
const markerCluster = L.markerClusterGroup({
    chunkedLoading: true,
    spiderfyOnMaxZoom: true // Déploie les stations en toile d'araignée si on zoome au maximum
});

// ── GÉOLOCALISATION ──
function locateUser() { map.locate({setView: true, maxZoom: 14}); }
map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup("Vous êtes ici").openPopup();
});

// ── TRADUCTEUR DE SERVICES EN EMOJIS ──
function getServicesIcons(servicesData, is24_24) {
    let icons = '';
    // Gestion de l'automate 24/24
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

// ── CHARGEMENT DES DONNÉES ──
async function loadData() {
    // 1. LUXEMBOURG (Via ton Backend)
    try {
        const luxRes = await fetch(API_LUX_URL);
        if (luxRes.ok) luxePrices = await luxRes.json();
        renderLuPrices();
    } catch (e) { console.warn("Backend Lux injoignable, utilisation des prix par défaut."); }

    stationsList = []; 

    // 2. FRANCE (Via API Gouv)
    try {
        const frRes = await fetch(`${FR_API_URL}?limit=100&where=code_departement%3D'57'`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                const lat = s.geom?.lat || (s.geometry?.coordinates ? s.geometry.coordinates[1] : null) || s.latitude;
                const lon = s.geom?.lon || (s.geometry?.coordinates ? s.geometry.coordinates[0] : null) || s.longitude;
                
                if (lat && lon) {
                    const finalName = s.name || s.marque || s.adresse || s.ville || "Station Service";
                    const iconsHTML = getServicesIcons(s.services_service, s.horaires_automate_24_24);

                    stationsList.push({
                        name: finalName,
                        lat: lat, lon: lon, country: 'FR',
                        icons: iconsHTML,
                        prices: {
                            Diesel: s.gazole_prix,
                            SP95: s.sp95_prix,
                            SP98: s.sp98_prix,
                            GPL: s.gpl_prix,
                            E10: s.e10_prix,
                            E85: s.e85_prix
                        },
                        ruptures: {
                            Diesel: !!s.gazole_rupture_debut,
                            SP95: !!s.sp95_rupture_debut,
                            SP98: !!s.sp98_rupture_debut,
                            GPL: !!s.gpl_rupture_debut,
                            E10: !!s.e10_rupture_debut,
                            E85: !!s.e85_rupture_debut
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur API France:", e); }

    // 3. LUXEMBOURG PHYSIQUE (Via TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.61&lon=6.13&radius=30000&limit=100`);
        const ttData = await ttRes.json();

        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name || "Station LUX",
                        lat: poi.position.lat, lon: poi.position.lon, country: 'LU',
                        icons: '', 
                        prices: luxePrices,
                        ruptures: {}
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    updateDisplay();
}

// ── AFFICHAGE CARTE ET LISTE (AVEC CLUSTERING) ──
function updateDisplay() {
    // On vide le groupe de clusters (remplace la boucle sur markers)
    markerCluster.clearLayers();
    
    let listHTML = '';

    stationsList.forEach(s => {
        const price = s.prices[activeFuel];
        const isRupture = s.ruptures && s.ruptures[activeFuel];
        
        if (isRupture) {
            // Création du point RUPTURE (On ne l'ajoute pas à la map, on le garde en mémoire)
            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: '#ef4444', color: "#000", weight: 1, fillOpacity: 0.9 })
             .bindPopup(`<b>${s.name}</b><br><span style="color:#ef4444; font-weight:bold; font-size:14px;">⚠️ EN RUPTURE</span>`);
            
            // ON AJOUTE AU CLUSTER
            markerCluster.addLayer(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)" style="cursor:pointer; padding:5px; border-bottom:1px solid #444; opacity: 0.5;">
                    <div class="st-name"><b>${s.name}</b></div>
                    <div class="st-price" style="color:#ef4444; font-size: 12px; font-weight: bold;">⚠️ RUPTURE</div>
                </div>
            `;
        } 
        else if (price) {
            // Création du point NORMAL
            const luxRefPrice = luxePrices[activeFuel] || 1.5;
            let color = s.country === 'LU' ? '#60a5fa' : (price < luxRefPrice ? '#f0c040' : '#4ade80');
            const src = s.country === 'LU' ? "Luxembourg (National)" : "France (Officiel)";
            
            const popupContent = `
                <div style="font-family: sans-serif;">
                    <b>${s.name}</b><br>
                    <span style="font-size:16px; font-weight:bold;">${price.toFixed(3)} €</span><br>
                    <small style="color: #666;">${src}</small>
                    ${s.icons ? `<div style="margin-top: 8px; font-size: 14px; background: rgba(0,0,0,0.05); padding: 4px; border-radius: 4px;">${s.icons}</div>` : ''}
                </div>
            `;

            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: color, color: "#000", weight: 1, fillOpacity: 0.9 })
             .bindPopup(popupContent);
            
            // ON AJOUTE AU CLUSTER
            markerCluster.addLayer(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)" style="cursor:pointer; padding:8px 5px; border-bottom:1px solid #444;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="st-name">
                            <b>${s.name}</b>
                            ${s.icons ? `<div style="font-size: 12px; margin-top: 3px;">${s.icons}</div>` : ''}
                        </div>
                        <div class="st-price" style="color:${color}; font-weight:bold;">${price.toFixed(3)} €</div>
                    </div>
                </div>
            `;
        }
    });

    // Ajout du cluster entier à la carte en une seule fois
    map.addLayer(markerCluster);

    const listEl = document.getElementById('station-list');
    if (listEl) listEl.innerHTML = listHTML;
}

// ── FONCTIONS UI ──
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if(btn) btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay(); 
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    const fuels = ['Diesel', 'SP95', 'E10', 'SP98', 'GPL', 'E85'];
    el.innerHTML = fuels.map(f => `
        <div class="price-row" style="display:flex; justify-content:space-between;">
            <span>${f}</span>
            <b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>
    `).join('');
}

// ── DÉMARRAGE ──
loadData();
