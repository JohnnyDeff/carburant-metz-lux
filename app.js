// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// Variables globales pour l'état de l'application
let luxePrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78, GPL: 0.95, E85: 0.85 };
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE (Axe Metz-Lux) ──
const map = L.map('map').setView([49.45, 6.15], 10);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap | CartoDB | TomTom'
}).addTo(map);

// Initialisation du groupe de clusters
const markerCluster = L.markerClusterGroup({ 
    chunkedLoading: true,
    spiderfyOnMaxZoom: true 
});

// ── FONCTIONS UTILITAIRES ──

// Géolocalisation
function locateUser() {
    map.locate({setView: true, maxZoom: 13});
}

map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, { radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9 })
        .addTo(map)
        .bindPopup("Vous êtes ici").openPopup();
});

// Traducteur de services
function getIcons(serv, h24) {
    let icons = (h24 === "Oui" || h24 === true) ? '🕒 ' : '';
    if (!serv) return icons;
    const s = Array.isArray(serv) ? serv.join(" ").toLowerCase() : serv.toLowerCase();
    if (s.includes('toilettes')) icons += '🚻 ';
    if (s.includes('boutique')) icons += '🛒 ';
    if (s.includes('lavage')) icons += '💦 ';
    if (s.includes('gonflage')) icons += '💨 ';
    return icons;
}

// ── CHARGEMENT DES DONNÉES (Rayon 50km) ──
async function loadData() {
    // 1. Récupération Prix Luxembourg
    try {
        const res = await fetch(API_LUX_URL);
        if (res.ok) luxePrices = await res.json();
    } catch (e) { console.warn("Prix Lux par défaut"); }

    stationsList = [];

    // 2. Récupération France (Correction du filtre et des noms de champs)
    try {
        // On centre sur 49.45, 6.15 (Axe Thionville-Lux)
        const geo = encodeURIComponent(`within_distance(geom, GEOMETRY'POINT(6.15 49.45)', 50km)`);
        const frRes = await fetch(`${FR_API_URL}?limit=300&where=${geo}`);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                // SÉCURITÉ : L'API peut renvoyer 'lon' ou 'lng' selon les versions
                const longitude = s.geom?.lon || s.geom?.lng || s.longitude;
                const latitude = s.geom?.lat || s.latitude;

                if (latitude && longitude) {
                    stationsList.push({
                        name: s.name || s.marque || s.ville || "Station FR",
                        lat: parseFloat(latitude), 
                        lon: parseFloat(longitude), 
                        country: 'FR',
                        icons: getIcons(s.services_service, s.horaires_automate_24_24),
                        // On s'assure que les prix sont bien des nombres
                        prices: { 
                            Diesel: parseFloat(s.gazole_prix), 
                            SP95: parseFloat(s.sp95_prix), 
                            SP98: parseFloat(s.sp98_prix), 
                            GPL: parseFloat(s.gpl_prix), 
                            E10: parseFloat(s.e10_prix), 
                            E85: parseFloat(s.e85_prix) 
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
    } catch (e) { console.error("Erreur France:", e); }

    // 3. Récupération TomTom (Luxembourg)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.45&lon=6.15&radius=50000&limit=100`);
        const ttData = await ttRes.json();
        if (ttData.results) {
            ttData.results.forEach(poi => {
                if (poi.address.countryCode === 'LU') {
                    stationsList.push({
                        name: poi.poi.name, 
                        lat: poi.position.lat, 
                        lon: poi.position.lon, 
                        country: 'LU',
                        icons: '🕒', 
                        prices: luxePrices, 
                        ruptures: {}
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom:", e); }

    updateDisplay();
}

// ── MISE À JOUR DE L'INTERFACE ──
function updateDisplay() {
    markerCluster.clearLayers();
    let listHTML = '';
    const fuelKey = activeFuel;
    const refPriceLux = luxePrices[fuelKey] || 1.6;

    stationsList.forEach(s => {
        const price = s.prices[fuelKey];
        const isRupture = s.ruptures[fuelKey];
        
        if (isRupture) {
            const m = L.circleMarker([s.lat, s.lon], { radius: 6, fillColor: '#ef4444', color: '#000', weight: 1, fillOpacity: 0.8 })
                      .bindPopup(`<b>${s.name}</b><br><b style="color:#ef4444">RUPTURE DE STOCK</b>`);
            markerCluster.addLayer(m);
        } 
        else if (price) {
            // Couleurs : Lux = Bleu, FR (moins cher que Lux) = Jaune, FR (plus cher que Lux) = Vert
            let color = s.country === 'LU' ? '#60a5fa' : (price < refPriceLux ? '#fbbf24' : '#10b981');
            
            const popup = `
                <div style="font-family:sans-serif;">
                    <b>${s.name}</b><br>
                    <span style="font-size:16px; font-weight:bold;">${price.toFixed(3)} €</span><br>
                    <small>${s.icons}</small>
                </div>`;

            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: color, color: '#000', weight: 1, fillOpacity: 0.9 })
                      .bindPopup(popup);
            
            markerCluster.addLayer(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 14)" style="cursor:pointer;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="st-name"><b>${s.name}</b><br><small>${s.icons}</small></div>
                        <div style="color:${color}; font-weight:bold; font-size:15px;">${price.toFixed(3)}€</div>
                    </div>
                </div>`;
        }
    });

    map.addLayer(markerCluster);
    document.getElementById('station-list').innerHTML = listHTML;
    renderLuPrices();
}

// Boutons Carburants
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay();
}

// Mise à jour du panneau latéral Lux
function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    const fuels = ['Diesel', 'SP95', 'E10', 'SP98', 'GPL', 'E85'];
    el.innerHTML = fuels.map(f => `
        <div style="display:flex; justify-content:space-between; font-size:13px; margin:2px 0;">
            <span>${f}</span><b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>`).join('');
}

// Lancement au démarrage
loadData();
