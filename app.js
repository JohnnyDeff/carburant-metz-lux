// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const API_BE_URL = '/api/belgium-prices'; // Nouvelle route backend pour la Belgique
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// Variables globales pour l'état de l'application
let luxePrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78, GPL: 0.95, E85: 0.85 };
let bePrices = { Diesel: 1.75, SP95: 1.70, E10: 1.70, SP98: 1.85, GPL: 0.80, E85: 0.90 }; // Valeurs secours BE
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.45, 6.15], 10); // Centré sur le tripoint FR-LU-BE

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap | CartoDB | TomTom'
}).addTo(map);

// Groupe de clusters
const markerCluster = L.markerClusterGroup({ 
    chunkedLoading: true,
    spiderfyOnMaxZoom: true 
});

// ── FONCTIONS UTILITAIRES ──

function getIcons(serv, h24) {
    let icons = (h24 === "Oui" || h24 === true) ? '🕒 ' : '';
    if (!serv) return icons;
    const s = Array.isArray(serv) ? serv.join(" ").toLowerCase() : serv.toLowerCase();
    if (s.includes('toilettes')) icons += '🚻 ';
    if (s.includes('boutique')) icons += '🛒 ';
    if (s.includes('lavage')) icons += '💦 ';
    return icons;
}

// ── CHARGEMENT DES DONNÉES ──

async function loadData() {
    // 1. Récupération Prix LUX et BE (Parallèle pour gagner du temps)
    try {
        const [luxRes, beRes] = await Promise.all([
            fetch(API_LUX_URL).catch(() => null),
            fetch(API_BE_URL).catch(() => null)
        ]);
        
        if (luxRes && luxRes.ok) luxePrices = await luxRes.json();
        if (beRes && beRes.ok) bePrices = await beRes.json();
        
        console.log("Prix nationaux chargés (LU & BE)");
    } catch (e) { console.warn("Utilisation des prix par défaut pour LU/BE"); }

    stationsList = [];

    // 2. CHARGEMENT FRANCE (Filtre départemental 54/57)
    try {
        const urlFR = `${FR_API_URL}?limit=300&where=code_departement in ('57','54','55')`;
        const frRes = await fetch(urlFR);
        const frData = await frRes.json();
        
        if (frData.results) {
            frData.results.forEach(s => {
                const lat = s.geom?.lat || s.latitude;
                const lon = s.geom?.lon || s.longitude;
                if (lat && lon) {
                    stationsList.push({
                        name: s.name || s.marque || s.ville || "Station FR",
                        lat: parseFloat(lat), lon: parseFloat(lon), country: 'FR',
                        icons: getIcons(s.services_service, s.horaires_automate_24_24),
                        prices: { 
                            Diesel: s.gazole_prix, SP95: s.sp95_prix, SP98: s.sp98_prix, 
                            GPL: s.gpl_prix, E10: s.e10_prix, E85: s.e85_prix 
                        },
                        ruptures: { 
                            Diesel: !!s.gazole_rupture_debut, SP95: !!s.sp95_rupture_debut, 
                            SP98: !!s.sp98_rupture_debut, GPL: !!s.gpl_rupture_debut, 
                            E10: !!s.e10_rupture_debut, E85: !!s.e85_rupture_debut 
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur API France :", e); }

    // 3. CHARGEMENT LU & BE (Via TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.45&lon=6.15&radius=50000&limit=200`);
        const ttData = await ttRes.json();
        
        if (ttData.results) {
            ttData.results.forEach(poi => {
                const cCode = poi.address.countryCode;
                if (cCode === 'LU' || cCode === 'BE') {
                    stationsList.push({
                        name: poi.poi.name,
                        lat: poi.position.lat,
                        lon: poi.position.lon,
                        country: cCode,
                        icons: '🕒', 
                        prices: (cCode === 'LU') ? luxePrices : bePrices, 
                        ruptures: {}
                    });
                }
            });
        }
    } catch (e) { console.error("Erreur TomTom :", e); }

    console.log("Total stations chargées :", stationsList.length);
    updateDisplay();
}

// ── AFFICHAGE ──

function updateDisplay() {
    markerCluster.clearLayers();
    let listHTML = '';
    const refLux = luxePrices[activeFuel] || 1.6;

    stationsList.forEach(s => {
        const p = s.prices[activeFuel];
        const isRupture = s.ruptures[activeFuel];
        
        if (isRupture) {
            const m = L.circleMarker([s.lat, s.lon], { radius: 6, fillColor: '#ef4444', color: '#000', weight: 1, fillOpacity: 0.8 })
                      .bindPopup(`<b>${s.name}</b><br><b style="color:#ef4444">RUPTURE</b>`);
            markerCluster.addLayer(m);
        } 
        else if (p) {
            // LOGIQUE DES COULEURS
            let col;
            if (s.country === 'LU') {
                col = '#60a5fa'; // BLEU LUX
            } else if (s.country === 'BE') {
                col = '#f97316'; // ORANGE BELGIQUE
            } else {
                // FRANCE : JAUNE SI MOINS CHER QUE LUX, VERT SINON
                col = (p < refLux) ? '#fbbf24' : '#10b981';
            }
            
            const popup = `<div><b>${s.name}</b><br><span style="font-size:15px; font-weight:bold;">${p.toFixed(3)} €</span><br>${s.icons}</div>`;

            const m = L.circleMarker([s.lat, s.lon], { radius: 8, fillColor: col, color: '#000', weight: 1, fillOpacity: 0.9 })
                      .bindPopup(popup);
            markerCluster.addLayer(m);

            listHTML += `
                <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 14)" style="cursor:pointer;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="st-name"><b>${s.name}</b><br><small>${s.icons}</small></div>
                        <div style="color:${col}; font-weight:bold;">${p.toFixed(3)}€</div>
                    </div>
                </div>`;
        }
    });

    map.addLayer(markerCluster);
    document.getElementById('station-list').innerHTML = listHTML;
    renderPricesPanel();
}

// ── UI ──

function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateDisplay();
}

function renderPricesPanel() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    
    // On affiche les deux pays dans le panneau latéral
    el.innerHTML = `
        <div style="margin-bottom:10px; border-bottom:1px solid #444; padding-bottom:5px;">
            <small style="color:#60a5fa; font-weight:bold;">🇱🇺 LUXEMBOURG</small>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
                <span>${activeFuel}</span><b>${luxePrices[activeFuel]?.toFixed(3)}€</b>
            </div>
        </div>
        <div>
            <small style="color:#f97316; font-weight:bold;">🇧🇪 BELGIQUE</small>
            <div style="display:flex; justify-content:space-between; font-size:12px;">
                <span>${activeFuel}</span><b>${bePrices[activeFuel]?.toFixed(3)}€</b>
            </div>
        </div>
    `;
}

function locateUser() { map.locate({setView: true, maxZoom: 13}); }

// GO !
loadData();
