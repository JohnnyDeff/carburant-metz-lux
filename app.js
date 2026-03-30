// ── CONFIGURATION ──
const API_LUX_URL = '/api/lux-prices';
let stations = [];
let markers = [];
let frAverages = {};
let activeFuel = 'Diesel';
let luxePrices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0, date_maj: "Chargement..." };

// ── CARTE ──
const map = L.map('map').setView([49.12, 6.17], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB'
}).addTo(map);

// ── DATA FRANCE (METZ) ──
async function loadFranceData() {
    const statusEl = document.getElementById('status-text');
    try {
        // URL sécurisée avec guillemets simples pour éviter l'erreur 400
        const url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?where=departement%3D'57'&limit=100";
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.results) throw new Error("Format API France invalide");
        
        stations = data.results.map(r => ({ fields: r }));
        calculateAverages();
        updateMarkers();
        renderList();
        
        if (statusEl) statusEl.textContent = `${stations.length} stations chargées (Moselle)`;
    } catch (err) {
        console.error("Erreur API France:", err);
        if (statusEl) statusEl.textContent = "Erreur chargement Metz";
    }
}

// ── DATA LUXEMBOURG ──
async function loadLuxData() {
    try {
        const res = await fetch(API_LUX_URL);
        luxePrices = await res.json();
        renderLuPrices();
    } catch (err) {
        console.warn("Erreur Backend Lux");
    }
}

// ── LOGIQUE MÉTIER ──
function calculateAverages() {
    const sums = { Diesel: 0, SP95: 0, SP98: 0 }, counts = { Diesel: 0, SP95: 0, SP98: 0 };
    stations.forEach(s => {
        const f = s.fields;
        if (f.prix_diesel) { sums.Diesel += f.prix_diesel; counts.Diesel++; }
        if (f.prix_essence_95) { sums.SP95 += f.prix_essence_95; counts.SP95++; }
        if (f.prix_essence_98) { sums.SP98 += f.prix_essence_98; counts.SP98++; }
    });
    Object.keys(sums).forEach(k => frAverages[k] = counts[k] ? sums[k] / counts[k] : null);
}

function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    stations.forEach(s => {
        const p = s.fields[`prix_${activeFuel.toLowerCase().replace('sp', 'essence_')}`];
        if (!p) return;
        
        const color = p < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
        const m = L.circleMarker([s.fields.latitude, s.fields.longitude], {
            radius: 7, color: color, fillOpacity: 0.8
        }).addTo(map);
        
        m.bindPopup(`<b>${s.fields.name}</b><br>${activeFuel}: ${p.toFixed(3)}€`);
        markers.push(m);
    });
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row">
            <span>${k}</span>
            <b>${luxePrices[k] ? luxePrices[k].toFixed(3) : 'NC'}€</b>
        </div>
    `).join('');
}

// Lancement
loadLuxData();
loadFranceData();
