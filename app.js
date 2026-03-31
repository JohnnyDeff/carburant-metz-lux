// ── CONFIGURATION ──
const TOMTOM_KEY = 'CRDxsSiKnAMIpuYJQf3MNs78q25zKLBJ';
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

let luxePrices = { Diesel: 1.55, SP95: 1.65, E10: 1.62, SP98: 1.78, GPL: 0.95, E85: 0.85 };
let activeFuel = 'Diesel';
let stationsList = [];

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.45, 6.15], 10);
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
    try {
        const res = await fetch(API_LUX_URL);
        if (res.ok) luxePrices = await res.json();
    } catch (e) { console.warn("Prix Lux par défaut"); }

    stationsList = [];

    // 1. CHARGEMENT FRANCE (Syntaxe simplifiée pour éviter le HTTP 400)
    try {
        // On utilise distance(geom, point(lon, lat), rayon) qui est plus stable
        const lon = 6.15;
        const lat = 49.45;
        const dist = 50000; // 50km en mètres
        
        const url = `${FR_API_URL}?limit=100&where=distance(geom, geom'POINT(49.45 6.15)', 50000)`;
        
        console.log("Tentative URL France :", url); // Pour vérifier dans la console

        const frRes = await fetch(url);
        
        if (!frRes.ok) {
            throw new Error(`Erreur API France: ${frRes.status}`);
        }

        const frData = await frRes.json();
        console.log("Réponse API France reçue !");

        if (frData.results) {
            frData.results.forEach(s => {
                const sLat = s.geom?.lat || s.latitude;
                const sLon = s.geom?.lon || s.longitude;

                if (sLat && sLon) {
                    stationsList.push({
                        name: s.name || s.marque || s.ville || "Station FR",
                        lat: parseFloat(sLat),
                        lon: parseFloat(sLon),
                        country: 'FR',
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
    } catch (e) { 
        console.error("Détail Erreur France :", e); 
    }

    // 2. CHARGEMENT LUXEMBOURG (TomTom)
    try {
        const ttRes = await fetch(`https://api.tomtom.com/search/2/poiSearch/gas%20station.json?key=${TOMTOM_KEY}&lat=49.45&lon=6.15&radius=50000&limit=100`);
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
    } catch (e) { console.error("Erreur TomTom :", e); }

    console.log("Total stations en mémoire :", stationsList.length);
    updateDisplay();
}

function updateDisplay() {
    markerCluster.clearLayers();
    let listHTML = '';
    const fuelKey = activeFuel;
    const refLux = luxePrices[fuelKey] || 1.6;

    stationsList.forEach(s => {
        const p = s.prices[fuelKey];
        if (s.ruptures[fuelKey]) {
            const m = L.circleMarker([s.lat, s.lon], { radius: 6, color: '#ef4444' })
                      .bindPopup(`<b>${s.name}</b><br>RUPTURE`);
            markerCluster.addLayer(m);
        } else if (p) {
            let col = s.country === 'LU' ? '#60a5fa' : (p < refLux ? '#fbbf24' : '#10b981');
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
    renderLuPrices();
}

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
        <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span>${f}</span><b>${luxePrices[f] ? luxePrices[f].toFixed(3) + '€' : 'NC'}</b>
        </div>`).join('');
}

function locateUser() { map.locate({setView: true, maxZoom: 13}); }

loadData();
