// ── CONFIGURATION ──
const API_LUX_URL = '/api/lux-prices';
const FR_API_URL  = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records';

let stations  = [];
let markers   = [];
let activeFuel = 'Diesel';
let luxePrices = { Diesel: 0, SP95: 0, SP98: 0, GPL: 0 };
let frAverages = { Diesel: 0, SP95: 0, SP98: 0 };

// ── INITIALISATION CARTE ──
const map = L.map('map').setView([49.12, 6.17], 11);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 19
}).addTo(map);

// Marqueur Luxembourg de référence
L.circleMarker([49.6116, 6.1319], {
    radius: 9, color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.35, weight: 2
}).bindPopup('<b>Luxembourg (ref.)</b>').addTo(map);

// ── GÉOLOCALISATION ──
function locateUser() {
    map.locate({ setView: true, maxZoom: 14 });
}
map.on('locationfound', (e) => {
    L.circleMarker(e.latlng, {
        radius: 8, color: '#ffffff', fillColor: '#40bfff', fillOpacity: 0.9
    }).addTo(map).bindPopup('Vous êtes ici').openPopup();
});

// ── CHARGEMENT DATA FRANCE ──
async function getFranceData() {
    const statusEl = document.getElementById('status-text');
    const dot      = document.getElementById('live-dot');

    dot.classList.add('loading');
    statusEl.textContent = 'Chargement stations…';

    try {
        // Vrais noms de champs confirmés dans les exports officiels du dataset :
        // gazole_prix / sp95_prix / sp98_prix  (pas prix_diesel / prix_essence_95)
        // Filtre département : where=code_departement='57'  (pas refine=departement)
        const params = new URLSearchParams({
            limit:  '100',
            where:  "code_departement='57'",
            select: 'id,name,adresse,ville,geom,gazole_prix,sp95_prix,sp98_prix,' +
                    'gazole_maj,sp95_maj,sp98_maj,' +
                    'sp95_rupture_debut,sp98_rupture_debut,gazole_rupture_debut'
        });
        const url = `${FR_API_URL}?${params}`;

        const res  = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.results || !data.results.length) throw new Error('Aucun résultat API France');

        stations = data.results.map(s => {
            // Coordonnées : le champ geom est { lon, lat } ou { coordinates: [lon, lat] }
            const coords = s.geom?.coordinates || [s.geom?.lon, s.geom?.lat] || [null, null];
            const ruptures = [
                s.gazole_rupture_debut && 'Diesel',
                s.sp95_rupture_debut   && 'SP95',
                s.sp98_rupture_debut   && 'SP98',
            ].filter(Boolean);
            return {
                name:    s.name    || 'Station',
                city:    s.ville   || '',
                address: s.adresse || '',
                lat:     parseFloat(coords[1]),
                lon:     parseFloat(coords[0]),
                rupture: ruptures,
                prices: {
                    Diesel: s.gazole_prix || null,
                    SP95:   s.sp95_prix   || null,
                    SP98:   s.sp98_prix   || null,
                }
            };
        });

        calculateAverages();
        updateMarkers();
        renderList();

        dot.classList.remove('loading');
        statusEl.textContent = `${stations.length} stations · ${new Date().toLocaleTimeString('fr-FR')}`;

        const countEl = document.getElementById('count-label');
        if (countEl) countEl.textContent = `${stations.length} stations chargées`;

    } catch (err) {
        console.error('Erreur API France:', err);
        dot.classList.add('error');
        statusEl.textContent = 'Erreur API France — réessai dans 30s';
        setTimeout(getFranceData, 30000);
    }
}

// ── CHARGEMENT DATA LUX (backend) ──
async function getLuxData() {
    try {
        const res = await fetch(API_LUX_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Validation : on accepte que si on a au moins Diesel ou SP95
        if (!data.Diesel && !data.SP95) throw new Error('Données LU vides');

        luxePrices = data;

        // Mettre à jour le nom de la source dans l'UI
        const srcEl = document.getElementById('lu-source-name');
        if (srcEl) srcEl.textContent = data.source || 'data.public.lu';

        renderLuPrices();
        updateSavings();
    } catch (err) {
        console.warn('Backend LU inaccessible — fallback statique:', err.message);
        // Fallback : prix du dernier communiqué connu (à mettre à jour manuellement si besoin)
        luxePrices = {
            Diesel: 1.418,
            SP95:   1.540,
            SP98:   1.684,
            GPL:    0.820,
            date_maj: 'fallback',
            source: 'valeurs codées (backend indisponible)'
        };
        renderLuPrices();
        updateSavings();
    }
}

// ── CALCUL MOYENNES ──
function calculateAverages() {
    ['Diesel', 'SP95', 'SP98'].forEach(fuel => {
        // BUG CORRIGÉ : on filtre les stations ayant bien un prix non-null pour ce carburant
        const valid = stations.filter(s => s.prices[fuel] !== null && s.prices[fuel] > 0);
        frAverages[fuel] = valid.length
            ? valid.reduce((acc, s) => acc + s.prices[fuel], 0) / valid.length
            : 0;
    });
    renderFrPrices();
}

// ── MARQUEURS CARTE ──
function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    stations.forEach(s => {
        const p = s.prices[activeFuel];
        if (!p || isNaN(s.lat) || isNaN(s.lon)) return;

        const hasRupture = s.rupture && s.rupture.length > 0;
        const isCheaper  = luxePrices[activeFuel] && p < luxePrices[activeFuel];

        let color = '#4ade80';
        if (hasRupture) color = '#ff5a5a';
        else if (isCheaper) color = '#f0c040';

        const icon = L.divIcon({
            html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.4);box-shadow:0 0 5px ${color}88"></div>`,
            className: '',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });

        const popup = `<b>${s.name}</b><br>${s.address}<br>${s.city}<br>${activeFuel}: <b>${p.toFixed(3)} €</b>` +
                      (hasRupture ? `<br><span style="color:#ff5a5a">⚠ Rupture: ${s.rupture.join(', ')}</span>` : '');

        const m = L.marker([s.lat, s.lon], { icon })
                   .bindPopup(popup)
                   .addTo(map);
        markers.push(m);
    });
}

// ── FILTRE CARBURANT ──
function setFuel(btn, fuel) {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    activeFuel = fuel;
    updateMarkers();
    renderList();
    updateSavings();
}

// ── AFFICHAGE PRIX LU ──
function renderLuPrices() {
    const el = document.getElementById('lu-prices');
    if (!el) return;

    const fuels = ['Diesel', 'SP95', 'SP98', 'GPL'];
    el.innerHTML = fuels.map(k => {
        const v  = luxePrices[k];
        const fr = frAverages[k];
        let diffHtml = '';
        if (fr && v && fr > 0) {
            const d = (v - fr).toFixed(3);
            const cls = d < 0 ? 'diff-neg' : 'diff-pos';
            diffHtml = `<span class="${cls}">${d > 0 ? '+' : ''}${d}</span>`;
        }
        return `<div class="price-row">
            <span class="fuel-name">${k}</span>
            <span>${v ? `<span class="price-lu">${v.toFixed(3)}€</span>` : 'NC'} ${diffHtml}</span>
        </div>`;
    }).join('');

    const label = document.getElementById('lu-date-label');
    if (label) label.textContent = luxePrices.date_maj ? ` · ${luxePrices.date_maj}` : '';
}

// ── AFFICHAGE PRIX FR ──
function renderFrPrices() {
    const el = document.getElementById('fr-prices');
    if (!el) return;
    el.innerHTML = ['Diesel', 'SP95', 'SP98'].map(k => `
        <div class="price-row">
            <span class="fuel-name">${k}</span>
            <span class="price-fr">${frAverages[k] > 0 ? frAverages[k].toFixed(3) + '€' : '…'}</span>
        </div>
    `).join('');
}

// ── BANNIÈRE ÉCONOMIE ──
function updateSavings() {
    const banner = document.getElementById('savings-banner');
    const valEl  = document.getElementById('savings-val');
    const noteEl = document.getElementById('savings-note');
    if (!banner || !valEl) return;

    const frP = frAverages[activeFuel];
    const luP = luxePrices[activeFuel];

    if (frP > 0 && luP > 0 && frP > luP + 0.005) {
        banner.classList.remove('hidden');
        const diff = frP - luP;
        valEl.textContent = `+${(diff * 50).toFixed(2)} €`;
        if (noteEl) noteEl.textContent = `Plein 50 L · LU moins cher de ${diff.toFixed(3)} €/L`;
    } else {
        banner.classList.add('hidden');
    }
}

// ── LISTE DES STATIONS ──
function renderList() {
    const listEl  = document.getElementById('station-list');
    const countEl = document.getElementById('count-label');
    if (!listEl) return;

    const search = (document.getElementById('search')?.value || '').toLowerCase().trim();

    // BUG CORRIGÉ : garde-fou sur city/name null + filtre sur prix disponible
    const filtered = stations
        .filter(s => {
            const cityMatch = s.city.toLowerCase().includes(search);
            const nameMatch = s.name.toLowerCase().includes(search);
            return (!search || cityMatch || nameMatch) && s.prices[activeFuel] !== null;
        })
        .sort((a, b) => (a.prices[activeFuel] || 9999) - (b.prices[activeFuel] || 9999));

    if (countEl) countEl.textContent = `${filtered.length} stations`;

    if (!filtered.length) {
        listEl.innerHTML = '<div class="empty">Aucune station trouvée.</div>';
        return;
    }

    const luRef = luxePrices[activeFuel];
    listEl.innerHTML = filtered.slice(0, 40).map((s, i) => {
        const p = s.prices[activeFuel];
        const isCheaper = luRef && p < luRef;
        const hasRupture = s.rupture && s.rupture.length > 0;
        let tag = '';
        if (hasRupture)       tag = '<div class="st-tag tag-rupture">⚠ Rupture</div>';
        else if (i === 0)     tag = '<div class="st-tag tag-top">★ Moins cher</div>';
        else if (isCheaper)   tag = '<div class="st-tag tag-cheap">↓ &lt; LU</div>';

        return `<div class="station-item${isCheaper && !hasRupture ? ' selected' : ''}"
                     onclick="map.setView([${s.lat}, ${s.lon}], 15)">
            <div>
                <div class="st-name">${s.name}</div>
                <div class="st-addr">${s.address}${s.address && s.city ? ' · ' : ''}${s.city}</div>
                ${tag}
            </div>
            <div class="st-price${isCheaper ? ' cheaper' : ''}">${p.toFixed(3)} €</div>
        </div>`;
    }).join('');
}

// ── LANCEMENT ──
getLuxData();
getFranceData();
// Rafraîchissement auto toutes les 10 min
setInterval(getFranceData, 600000);
