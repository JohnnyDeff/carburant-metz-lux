// ── CONFIGURATION & ÉTAT ──
const API_LUX_URL = '/api/lux-prices'; 

let stations = [];
let markers = [];
let frAverages = {};
let activeFuel = 'Diesel';
let selectedId = null;
let userMarker = null;

// Données par défaut pour le Luxembourg (en attendant le chargement)
let luxePrices = {
  "Diesel": 0, "SP95": 0, "SP98": 0, "GPL": 0,
  "date_maj": "Chargement...", "source": "Vérification..."
};

// ── INITIALISATION DE LA CARTE ──
const map = L.map('map', { zoomControl: true }).setView([49.12, 6.3], 10);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CartoDB</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

// Marqueur de référence Luxembourg-Ville
L.circleMarker([49.6116, 6.1319], {
  radius: 10, color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.3, weight: 2
}).bindPopup('<b>Luxembourg (Zone de référence)</b>').addTo(map);

// ── FONCTION : GÉOLOCALISATION ──
function locateUser() {
  if (!navigator.geolocation) {
    alert("La géolocalisation n'est pas supportée par votre navigateur.");
    return;
  }

  const statusEl = document.getElementById('status-text');
  statusEl.textContent = "Localisation en cours...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      if (userMarker) map.removeLayer(userMarker);

      userMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: '#ffffff',
        fillColor: '#40bfff',
        fillOpacity: 0.9,
        weight: 3
      }).addTo(map).bindPopup("<b>Vous êtes ici</b>").openPopup();

      map.setView([latitude, longitude], 13, { animate: true });
      statusEl.textContent = "Position trouvée";
      setTimeout(() => loadData(), 500); // Rafraîchir pour voir les stations autour
    },
    (error) => {
      alert("Erreur de localisation : " + error.message);
      statusEl.textContent = "Localisation échouée";
    }
  );
}

// ── RÉCUPÉRATION PRIX LUXEMBOURG (BACKEND) ──
async function fetchLuxPrices() {
  try {
    const res = await fetch(API_LUX_URL);
    if (!res.ok) throw new Error();
    luxePrices = await res.json();
    console.log("Prix Lux chargés depuis le backend");
  } catch (err) {
    console.warn("Backend inaccessible, utilisation des valeurs par défaut");
  }
  renderLuPrices();
  updateSavings();
}

// ── CHARGEMENT DONNÉES FRANCE (API GOUV) ──
async function loadData() {
  const dot = document.getElementById('live-dot');
  const statusEl = document.getElementById('status-text');
  dot.className = 'live-dot loading';

  try {
    const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records'
      + '?where=departement%3D%2257%22'
      + '&limit=100'
      + '&select=name,address,city,latitude,longitude,prix_diesel,prix_essence_95,prix_essence_98,rupture,id';
    
    const res = await fetch(url);
    const data = await res.json();
    stations = (data.results || []).map(r => ({ fields: r }));

    // Calcul des moyennes Moselle
    const sums = { Diesel: 0, SP95: 0, SP98: 0 }, counts = { Diesel: 0, SP95: 0, SP98: 0 };
    stations.forEach(s => {
      const f = s.fields;
      if (f.prix_diesel) { sums.Diesel += f.prix_diesel; counts.Diesel++; }
      if (f.prix_essence_95) { sums.SP95 += f.prix_essence_95; counts.SP95++; }
      if (f.prix_essence_98) { sums.SP98 += f.prix_essence_98; counts.SP98++; }
    });
    
    ['Diesel', 'SP95', 'SP98'].forEach(k => {
      frAverages[k] = counts[k] ? sums[k] / counts[k] : null;
    });

    dot.className = 'live-dot';
    statusEl.textContent = `${stations.length} stations · ${new Date().toLocaleTimeString('fr-FR')}`;

    renderFrPrices();
    renderLuPrices();
    updateSavings();
    renderList();
    updateMarkers();
  } catch (err) {
    dot.className = 'live-dot error';
    statusEl.textContent = 'Erreur API France';
    console.error(err);
  }
}

// ── LOGIQUE D'AFFICHAGE (MÊME QUE VOTRE CODE INITIAL) ──

function getPrice(fields, fuel) {
  if (fuel === 'Diesel') return fields.prix_diesel;
  if (fuel === 'SP95') return fields.prix_essence_95;
  if (fuel === 'SP98') return fields.prix_essence_98;
  return null;
}

function setFuel(btn, fuel) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  activeFuel = fuel;
  updateSavings();
  renderList();
  updateMarkers();
}

function renderLuPrices() {
  const el = document.getElementById('lu-prices');
  const fuels = ['Diesel', 'SP95', 'SP98', 'GPL'];
  el.innerHTML = fuels.map(k => {
    const v = luxePrices[k];
    const fr = frAverages[k];
    let diffHtml = '';
    if (fr && v) {
      const d = (v - fr).toFixed(3);
      diffHtml = `<span class="${d < 0 ? 'diff-neg' : 'diff-pos'}">${d > 0 ? '+' : ''}${d}</span>`;
    }
    return `<div class="price-row"><span class="fuel-name">${k}</span><span>${v ? v.toFixed(3) + '€' : 'NC'} ${diffHtml}</span></div>`;
  }).join('');
  document.getElementById('lu-date-label').textContent = ' · ' + luxePrices.date_maj;
}

function renderFrPrices() {
  const el = document.getElementById('fr-prices');
  el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => {
    const v = frAverages[k];
    return `<div class="price-row"><span class="fuel-name">${k}</span><span class="price-fr">${v ? v.toFixed(3) + '€' : 'NC'}</span></div>`;
  }).join('');
}

function updateSavings() {
  const banner = document.getElementById('savings-banner');
  const frP = frAverages[activeFuel], luP = luxePrices[activeFuel];
  if (activeFuel === 'Tous' || !frP || !luP || (frP - luP) <= 0.005) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  document.getElementById('savings-val').textContent = '+' + ((frP - luP) * 50).toFixed(2) + ' €';
}

function renderList() {
  const el = document.getElementById('station-list');
  const search = document.getElementById('search').value.toLowerCase();
  let filtered = stations.filter(s => {
    const matchSearch = (s.fields.city || '').toLowerCase().includes(search) || (s.fields.name || '').toLowerCase().includes(search);
    const hasFuel = activeFuel === 'Tous' || getPrice(s.fields, activeFuel);
    return matchSearch && hasFuel;
  });

  filtered.sort((a, b) => (getPrice(a.fields, activeFuel) || 99) - (getPrice(b.fields, activeFuel) || 99));
  
  el.innerHTML = filtered.slice(0, 50).map(s => {
    const p = getPrice(s.fields, activeFuel);
    const isCheaper = p && luxePrices[activeFuel] && p < luxePrices[activeFuel];
    return `
      <div class="station-item ${selectedId === s.fields.id ? 'selected' : ''}" onclick="selectStation('${s.fields.id}', ${s.fields.latitude}, ${s.fields.longitude})">
        <div><div class="st-name">${s.fields.name || 'Station'}</div><div class="st-addr">${s.fields.city}</div></div>
        <div class="st-price ${isCheaper ? 'cheaper' : ''}">${p ? p.toFixed(3) + ' €' : '—'}</div>
      </div>`;
  }).join('');
}

function updateMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
  stations.forEach(s => {
    const p = getPrice(s.fields, activeFuel);
    const color = (s.fields.rupture && s.fields.rupture.length) ? '#ff5a5a' : (p && p < luxePrices[activeFuel] ? '#f0c040' : '#4ade80');
    const marker = L.circleMarker([s.fields.latitude, s.fields.longitude], { radius: 6, color, fillOpacity: 0.8 }).addTo(map);
    marker.bindPopup(`<b>${s.fields.name}</b><br>${s.fields.city}<br>Prix : ${p ? p.toFixed(3) : 'NC'}`);
    markers.push(marker);
  });
}

function selectStation(id, lat, lon) {
  selectedId = id;
  map.setView([lat, lon], 15);
  renderList();
}

// ── LANCEMENT ──
fetchLuxPrices();
loadData();
setInterval(loadData, 600000); // Update toutes les 10 min
