// ── CONFIGURATION ──
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL  = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

let stations = [];
let markers = [];
let activeFuel = 'Diesel';
let luxePrices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0 };
let frAverages = { Diesel: 0, SP95: 0, SP98: 0 };

const map = L.map('map').setView([49.12, 6.17], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 19
}).addTo(map);

async function getFranceData() {
    const statusEl = document.getElementById('status-text');
    const dot = document.getElementById('live-dot');
    try {
        dot.classList.add('loading');
        const params = new URLSearchParams({
            limit: '100',
            where: "code_departement='57'",
            select: 'name,adresse,ville,geom,gazole_prix,sp95_prix,sp98_prix,gazole_rupture_debut'
        });

        const res = await fetch(`${FR_API_URL}?${params}`);
        const data = await res.json();

        stations = data.results.map(s => ({
            name: s.name || 'Station',
            city: s.ville || '',
            address: s.adresse || '',
            lat: s.geom?.lat || s.geom?.coordinates[1],
            lon: s.geom?.lon || s.geom?.coordinates[0],
            prices: {
                Diesel: s.gazole_prix || null,
                SP95: s.sp95_prix || null,
                SP98: s.sp98_prix || null
            }
        }));

        calculateAverages();
        updateMarkers();
        renderList();
        dot.classList.remove('loading');
        statusEl.textContent = `${stations.length} stations chargées`;
    } catch (err) {
        dot.classList.add('error');
        statusEl.textContent = 'Erreur API France';
    }
}

async function getLuxData() {
    try {
        const res = await fetch(API_LUX_URL);
        luxePrices = await res.json();
        renderLuPrices();
        updateSavings();
    } catch (err) {
        console.error("Erreur Lux", err);
    }
}

function calculateAverages() {
    ['Diesel', 'SP95', 'SP98'].forEach(f => {
        const valid = stations.filter(s => s.prices[f] > 0);
        frAverages[f] = valid.length ? valid.reduce((a, b) => a + b.prices[f], 0) / valid.length : 0;
    });
    renderFrPrices();
}

function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    stations.forEach(s => {
        const p = s.prices[activeFuel];
        if (!p || !s.lat) return;
        const color = p < luxePrices[activeFuel] ? '#f0c040' : '#4ade80';
        const m = L.circleMarker([s.lat, s.lon], { radius: 6, color: color, fillOpacity: 0.8 }).addTo(map);
        markers.push(m);
    });
}

function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateMarkers();
    renderList();
    updateSavings();
}

function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row"><span>${k}</span> <b>${luxePrices[k].toFixed(3)}€</b></div>
    `).join('');
}

function renderFrPrices() {
    const el = document.getElementById('fr-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row"><span>${k}</span> <b>${frAverages[k].toFixed(3)}€</b></div>
    `).join('');
}

function updateSavings() {
    const valEl = document.getElementById('savings-val');
    const frP = frAverages[activeFuel], luP = luxePrices[activeFuel];
    if (valEl && frP > luP) {
        document.getElementById('savings-banner').classList.remove('hidden');
        valEl.textContent = `+${((frP - luP) * 50).toFixed(2)} €`;
    }
}

function renderList() {
    const listEl = document.getElementById('station-list');
    if (!listEl) return;
    listEl.innerHTML = stations
        .filter(s => s.prices[activeFuel] > 0)
        .sort((a, b) => a.prices[activeFuel] - b.prices[activeFuel])
        .slice(0, 20)
        .map(s => `
            <div class="station-item" onclick="map.setView([${s.lat}, ${s.lon}], 15)">
                <div class="st-name">${s.name}</div>
                <div class="st-price">${s.prices[activeFuel].toFixed(3)} €</div>
            </div>
        `).join('');
}

getLuxData();
getFranceData();
