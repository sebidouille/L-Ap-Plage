// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    SHEET_BASE_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    SHEET_GIDS: {
        PLAGES:          0,
        MAREES:          138428367,
        RECOMMANDATIONS: 2049933385,
        METEO:           146047806,
        BARS:            1057932141,
        RESTOS:          251951681
    },
    GROIX_CENTER: [47.6389, -3.4523],
    ZOOM_LEVEL: 13,
    MAPBOX_TOKEN: 'pk.eyJ1Ijoicm91eHNlYiIsImEiOiJjbW0xd3dvcTAwMTZzMnJzZXdyYXFpMjBvIn0.Tq3uFh1jH5n-7OXcfm7MtQ',
    MAPBOX_STYLE: 'mapbox://styles/mapbox/outdoors-v12'
};

// ============================================
// ÉTAT GLOBAL
// ============================================
let map;
let glLayer;
let plagesData = [];
let mareesData = [];
let plagesMarkers = [];
let selectedMarker = null;
let selectedDate = null; // null = maintenant
let meteoData = [];
let barsData = [];
let barsMarkers = [];
let showBars = false;
let restosData = [];
let restosMarkers = [];
let showRestos = false;

// ============================================
// INIT
// ============================================


// ============================================
// CARTE
// ============================================
function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView(CONFIG.GROIX_CENTER, CONFIG.ZOOM_LEVEL);

    glLayer = L.mapboxGL({
        accessToken: CONFIG.MAPBOX_TOKEN,
        style: CONFIG.MAPBOX_STYLE
    }).addTo(map);

    // Suppression des POI
    setTimeout(function hidePOI() {
        const glMap = glLayer._glMap;
        if (!glMap) { setTimeout(hidePOI, 200); return; }
        if (!glMap.isStyleLoaded()) {
            glMap.on('load', function() { removePOI(glMap); });
            return;
        }
        removePOI(glMap);
    }, 500);
}

function removePOI(glMap) {
    glMap.getStyle().layers.forEach(function(layer) {
        if (layer.id.includes('poi') || layer.id.includes('transit-label') ||
            layer.id.includes('airport-label') || layer.id.includes('ferry')) {
            try { glMap.setLayoutProperty(layer.id, 'visibility', 'none'); } catch(e) {}
        }
    });
    console.log('POI masqués');
}

// ============================================
// CHARGEMENT DONNÉES
// ============================================
async function loadData() {
    const [plagesCSV, mareesCSV, recoCSV, meteoCsv, barsCSV, restosCSV] = await Promise.all([
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.PLAGES}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.MAREES}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RECOMMANDATIONS}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.METEO}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.BARS}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RESTOS}`).then(r => r.text())
    ]);

    plagesData = parseCSV(plagesCSV);
    mareesData = parseCSV(mareesCSV);
    meteoData  = parseCSV(meteoCsv);
    barsData   = parseCSV(barsCSV).filter(b => b.Validé === '1' || b.Valide === '1');
    restosData = parseCSV(restosCSV).filter(r => r.Validé === '1' || r.Valide === '1');
    const recoData = parseCSV(recoCSV);

    // Associer couleur et score à chaque plage
    plagesData.forEach((plage, i) => {
        if (recoData[i]) {
            plage.couleur = recoData[i].couleur;
            plage.score   = parseFloat(recoData[i].SCORE_FINAL) || 0;
        }
    });

    console.log(`${plagesData.length} plages chargées`);
}

// ============================================
// MARQUEURS PLAGES
// ============================================
function addPlagesMarkers() {
    plagesData.forEach(function(plage) {
        const lat = parseFloat(plage.Latitude || plage.latitude);
        const lon = parseFloat(plage.Longitude || plage.longitude);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

        const color = getColor(plage);
        const marker = L.marker([lat, lon], { icon: createParasolIcon(color, false) })
            .addTo(map)
            .bindPopup(() => createPopup(plage), { maxWidth: 280, closeButton: true });

        marker.on('click', function() {
            if (selectedMarker && selectedMarker !== marker) {
                selectedMarker.setIcon(createParasolIcon(selectedMarker._color, false));
            }
            marker.setIcon(createParasolIcon(color, true));
            selectedMarker = marker;
        });

        marker.on('popupopen', function() {
            // Détruire tous les charts existants avant d'en créer un nouveau
            Chart.helpers.each(Chart.instances, function(instance) {
                instance.destroy();
            });
            setTimeout(function() {
                const canvas = document.querySelector('.tide-canvas');
                if (canvas) drawTideChart(canvas);

                // Clic sur popup → ferme
                const wrapper = document.querySelector('.leaflet-popup-content-wrapper');
                if (!wrapper) return;

                wrapper.addEventListener('click', function(e) {
                    if (e.target.tagName !== 'CANVAS') {
                        map.closePopup();
                    }
                });

                // Drag sur popup → déplace la carte
                let dragging = false, startX, startY, startLng, startLat;

                wrapper.addEventListener('mousedown', function(e) {
                    if (e.target.tagName === 'CANVAS') return;
                    dragging = true;
                    startX = e.clientX; startY = e.clientY;
                    const c = map.getCenter();
                    startLng = c.lng; startLat = c.lat;
                    wrapper.style.cursor = 'grabbing';
                    e.preventDefault();
                });

                wrapper.addEventListener('touchstart', function(e) {
                    if (e.target.tagName === 'CANVAS') return;
                    dragging = true;
                    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
                    const c = map.getCenter();
                    startLng = c.lng; startLat = c.lat;
                }, { passive: true });

                document.addEventListener('mousemove', function(e) {
                    if (!dragging) return;
                    const scale = 0.0001;
                    map.panTo([startLat + (e.clientY - startY) * scale, startLng - (e.clientX - startX) * scale], { animate: false });
                });

                document.addEventListener('touchmove', function(e) {
                    if (!dragging) return;
                    const scale = 0.0001;
                    map.panTo([startLat + (e.touches[0].clientY - startY) * scale, startLng - (e.touches[0].clientX - startX) * scale], { animate: false });
                }, { passive: true });

                document.addEventListener('mouseup', function() {
                    dragging = false;
                    if (wrapper) wrapper.style.cursor = 'grab';
                });
                document.addEventListener('touchend', function() { dragging = false; });

                wrapper.style.cursor = 'grab';
            }, 200);
        });

        marker._color = color;
        plagesMarkers.push(marker);
    });

    console.log(`${plagesMarkers.length} marqueurs plages ajoutés`);
}

function getMeteoAtDate(date) {
    // Trouver la ligne météo la plus proche de la date/heure choisie
    if (!meteoData || meteoData.length === 0) return null;
    const target = date.getTime();
    let best = null, bestDiff = Infinity;
    meteoData.forEach(row => {
        if (!row.timestamp) return;
        const t = new Date(row.timestamp).getTime();
        const diff = Math.abs(t - target);
        if (diff < bestDiff) { bestDiff = diff; best = row; }
    });
    return best;
}

function getScoreMaree(plage, tide, date) {
    if (!tide) return 5;
    const { events, hMax, hMin } = getTideEvents(tide);
    const hour   = date.getHours() + date.getMinutes() / 60;
    const height = tideHeightAt(hour, events, hMin, hMax);
    const ratio  = (height - hMin) / (hMax - hMin); // 0=basse mer, 1=haute mer
    const ideale = (plage['Marée idéale'] || '').toLowerCase();

    // Calcul score 0-10 selon correspondance
    if (ideale.includes('haute') && ideale.includes('basse')) return 10;
    if (ideale.includes('haute') && ideale.includes('mi'))    return 5 + ratio * 5;
    if (ideale.includes('basse') && ideale.includes('mi'))    return 5 + (1 - ratio) * 5;
    if (ideale.includes('haute'))  return ratio * 10;
    if (ideale.includes('basse'))  return (1 - ratio) * 10;
    if (ideale.includes('mi'))     return 10 - Math.abs(ratio - 0.5) * 10;
    return 5;
}

function getScoreVent(plage, meteo) {
    if (!meteo) return 5;
    const dirVent   = parseFloat(meteo.direction_vent) || 0;
    const forceKmh  = parseFloat((meteo.force_vent_kmh || '').replace(',', '.')) || 0;
    const orientIdeal = plage['Orientation vent idéal'] || plage['Orientation vent ideal'] || '';

    // Score force : vent faible = bon, fort = mauvais
    let scoreForce = 10;
    if (forceKmh > 50) scoreForce = 0;
    else if (forceKmh > 35) scoreForce = 2;
    else if (forceKmh > 25) scoreForce = 5;
    else if (forceKmh > 15) scoreForce = 7;
    else scoreForce = 10;

    // Score direction : comparer avec orientation idéale
    let scoreDir = 7; // neutre par défaut
    if (orientIdeal) {
        const idealDeg = parseFloat(orientIdeal);
        if (!isNaN(idealDeg)) {
            let diff = Math.abs(dirVent - idealDeg);
            if (diff > 180) diff = 360 - diff;
            scoreDir = diff < 30 ? 10 : diff < 60 ? 7 : diff < 90 ? 5 : diff < 135 ? 3 : 1;
        }
    }

    return (scoreForce * 0.6 + scoreDir * 0.4);
}

function getColor(plage) {
    const now   = getDisplayDate();
    const today = now.toISOString().split('T')[0];
    const tide  = mareesData.find(m => m.date && m.date.startsWith(today));
    const meteo = getMeteoAtDate(now);

    if (tide && meteo) {
        // Recalcul complet marée + vent
        const sMaree = getScoreMaree(plage, tide, now);
        const sVent  = getScoreVent(plage, meteo);
        const score  = sMaree * 5 + sVent * 5; // sur 100
        if (score >= 75) return 'green';
        if (score >= 60) return 'blue';
        if (score >= 40) return 'orange';
        return 'red';
    }
    if (tide && !meteo) {
        // Recalcul marée seule
        const sMaree = getScoreMaree(plage, tide, now);
        const score  = sMaree * 10;
        if (score >= 75) return 'green';
        if (score >= 60) return 'blue';
        if (score >= 40) return 'orange';
        return 'red';
    }

    // Fallback : couleur du sheet
    const colorMap = { 'Vert': 'green', 'Bleu': 'blue', 'Orange': 'orange', 'Rouge': 'red' };
    const couleur = plage.Couleur || plage.couleur || '';
    if (couleur && colorMap[couleur]) return colorMap[couleur];
    const score = plage.score || 50;
    if (score >= 75) return 'green';
    if (score >= 60) return 'blue';
    if (score >= 40) return 'orange';
    return 'red';
}

function createParasolIcon(color, selected) {
    const colors = { green: '#4caf50', blue: '#2196f3', orange: '#ff9800', red: '#f44336' };
    const border = selected ? '#9c27b0' : 'white';
    const bw     = selected ? '2.5' : '1.5';
    const svg = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(15,16,20)">
                <ellipse cx="16" cy="30" rx="6" ry="1.5" fill="rgba(0,0,0,0.2)"/>
                <line x1="16" y1="14" x2="16" y2="29" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="16" cy="3" r="1.2" fill="#666"/>
                <path d="M4 14 Q4 4,16 2 Q28 4,28 14"
                      fill="${colors[color]}" stroke="${border}" stroke-width="${bw}" stroke-linejoin="round"/>
                <path d="M16 2 L16 14" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
                <path d="M11 4 L12 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M21 4 L20 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M4 14 L16 2"  stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M28 14 L16 2" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
            </g>
        </svg>`;
    return L.divIcon({ html: svg, className: '', iconSize: [32,32], iconAnchor: [16,30], popupAnchor: [0,-30] });
}

// ============================================
// UTILITAIRES CSV
// ============================================
function parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (!values[0]) continue;
        const row = {};
        headers.forEach((h, j) => { row[h] = (values[j] || '').trim().replace(/"/g, ''); });
        data.push(row);
    }
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let cur = '', inQ = false;
    for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
        else { cur += ch; }
    }
    result.push(cur);
    return result;
}

// ============================================
// HEADER DATE/HEURE
// ============================================
function getDisplayDate() {
    return selectedDate || new Date();
}

function updateHeader() {
    const d = getDisplayDate();
    const isNow = !selectedDate;
    document.getElementById('current-date').textContent =
        d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('current-time').textContent =
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('header').style.background =
        isNow ? 'rgba(255,255,255,0.85)' : 'rgba(255,220,100,0.92)';
}

function initHeader() {
    updateHeader();
    // Mise à jour automatique seulement si "maintenant"
    setInterval(function() {
        if (!selectedDate) updateHeader();
    }, 1000);

    document.getElementById('header').addEventListener('click', openCalendar);
}

// ============================================
// CALENDRIER
// ============================================
function openCalendar() {
    const panel = document.getElementById('calendar-panel');
    panel.classList.remove('hidden');
    buildDateSelector();
    buildHourSelector();
}

function closeCalendar() {
    document.getElementById('calendar-panel').classList.add('hidden');
}

function buildDateSelector() {
    const container = document.getElementById('date-selector');
    container.innerHTML = '';
    const now = new Date();
    const current = getDisplayDate();

    for (let i = 0; i < 10; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() + i);
        const btn = document.createElement('button');
        btn.className = 'date-btn';
        const isSameDay = d.toDateString() === current.toDateString();
        if (isSameDay) btn.classList.add('selected');

        const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
        btn.innerHTML = `<span class="day-num">${d.getDate()}</span><span class="day-name">${dayName}</span>`;
        btn.dataset.date = d.toISOString().split('T')[0];

        btn.addEventListener('click', function() {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
        container.appendChild(btn);
    }
}

function buildHourSelector() {
    const sel = document.getElementById('hour-selector');
    sel.innerHTML = '';
    const current = getDisplayDate();
    for (let h = 0; h < 24; h++) {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h.toString().padStart(2,'0') + 'h00';
        if (h === current.getHours()) opt.selected = true;
        sel.appendChild(opt);
    }
}

function initCalendar() {
    document.getElementById('btn-cancel-cal').addEventListener('click', closeCalendar);

    document.getElementById('btn-now').addEventListener('click', function() {
        selectedDate = null;
        updateHeader();
        refreshMarkers();
        closeCalendar();
    });

    document.getElementById('btn-validate').addEventListener('click', function() {
        const selectedBtn = document.querySelector('.date-btn.selected');
        if (!selectedBtn) return;
        const dateStr  = selectedBtn.dataset.date;
        const hour     = parseInt(document.getElementById('hour-selector').value);
        const d        = new Date(dateStr);
        d.setHours(hour, 0, 0, 0);
        selectedDate = d;
        updateHeader();
        refreshMarkers();
        closeCalendar();
    });
}

// ============================================
// ACTUALISATION MARQUEURS SELON DATE
// ============================================
function refreshMarkers() {
    // Supprimer marqueurs actuels
    plagesMarkers.forEach(m => map.removeLayer(m));
    plagesMarkers = [];
    addPlagesMarkers();
}



// ============================================
// APPEL INIT COMPLET
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    initMap();
    initHeader();
    initCalendar();
    initMenu();
    await loadData();
    addPlagesMarkers();
});


// ============================================
// IMAGE PLAGE
// ============================================
function getImagePath(nom) {
    // Cas particuliers
    const overrides = {
        'le-stang': 'stang',
        'stang': 'stang',
        'port-st-nicolas': 'port-saint-nicolas',
        'port-saint-nicolas': 'port-saint-nicolas'
    };

    // Normalise le nom en nom de fichier
    const filename = nom
        .toLowerCase()
        // Remplacer accents et caractères spéciaux
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // supprime les diacritiques
        .replace(/[àáâãäå]/g, 'a')
        .replace(/[èéêë]/g, 'e')
        .replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõö]/g, 'o')
        .replace(/[ùúûü]/g, 'u')
        .replace(/[ýÿ]/g, 'y')
        .replace(/[ç]/g, 'c')
        .replace(/[ñ]/g, 'n')
        .replace(/[œ]/g, 'oe')
        .replace(/[æ]/g, 'ae')
        // Remplacer apostrophes et tirets par tiret
        .replace(/[''`'\s]+/g, '-')
        .replace(/[-]+/g, '-')
        // Supprimer caractères non alphanumériques sauf tirets
        .replace(/[^a-z0-9-]/g, '')
        // Nettoyer tirets en début/fin
        .replace(/^-+|-+$/g, '');

    const final = overrides[filename] || filename;
    return `images/${final}.jpg`;
}

// ============================================
// POPUPS PLAGES
// ============================================
function createPopup(plage) {
    const nom         = plage.Nom || plage.nom || 'Plage';
    const mareeIdeale = plage['Marée idéale'] || plage.maree_ideale || '-';
    const imgPath     = getImagePath(nom);

    return `
        <div class="popup-wrap">
            <div class="popup-header">${nom}</div>
            <div class="popup-body">
                <img src="${imgPath}" alt="${nom}"
                     onerror="this.style.display='none'"
                     style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:10px;">
                <p><strong>Marée idéale :</strong> ${mareeIdeale}</p>
                <div class="popup-chart"><canvas class="tide-canvas"></canvas></div>
            </div>
        </div>`;
}


// ============================================
// ÉVÉNEMENTS MARÉE TRIÉS
// ============================================
function getTideEvents(tide) {
    const ph = t => { if (!t) return null; const m = t.match(/(\d+)h(\d+)/); return m ? +m[1] + +m[2]/60 : null; };
    const hMax = parseFloat((tide.hauteur_max || '').replace(',', '.')) || 5.3;
    const hMin = 0.9;

    // Construire la liste des événements avec leur type et heure
    const events = [
        { h: ph(tide.bm1_heure), type: 'low',  val: hMin },
        { h: ph(tide.pm1_heure), type: 'high', val: hMax },
        { h: ph(tide.bm2_heure), type: 'low',  val: hMin },
        { h: ph(tide.pm2_heure), type: 'high', val: hMax }
    ].filter(e => e.h !== null).sort((a, b) => a.h - b.h);

    return { events, hMax, hMin };
}

function tideHeightAt(hour, events, hMin, hMax) {
    if (events.length < 2) return (hMax + hMin) / 2;

    // Avant le premier événement
    if (hour <= events[0].h) {
        // Extrapoler depuis un événement fictif 12h avant
        const prev = { h: events[events.length-1].h - 24, val: events[events.length-1].val };
        const ratio = Math.max(0, Math.min(1, (hour - prev.h) / (events[0].h - prev.h)));
        const range = Math.abs(events[0].val - prev.val);
        return prev.val + (events[0].val - prev.val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
    }

    // Après le dernier événement
    if (hour >= events[events.length-1].h) {
        const last = events[events.length-1];
        const next = { h: events[0].h + 24, val: events[0].val };
        const ratio = Math.max(0, Math.min(1, (hour - last.h) / (next.h - last.h)));
        return last.val + (next.val - last.val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
    }

    // Entre deux événements
    for (let i = 0; i < events.length - 1; i++) {
        if (hour >= events[i].h && hour <= events[i+1].h) {
            const ratio = (hour - events[i].h) / (events[i+1].h - events[i].h);
            return events[i].val + (events[i+1].val - events[i].val) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
        }
    }
    return (hMax + hMin) / 2;
}
// ============================================
// INFO MARÉE ACTUELLE
// ============================================
function getTideInfo() {
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const tide  = mareesData.find(m => m.date && m.date.startsWith(today));

    if (!tide) return { arrow: '↗️', status: 'Montante', height: '—' };

    const hour = now.getHours() + now.getMinutes() / 60;
    const ph   = t => { if (!t) return null; const m = t.match(/(\d+)h(\d+)/); return m ? +m[1] + +m[2]/60 : null; };

    const bm1 = ph(tide.bm1_heure); const pm1 = ph(tide.pm1_heure);
    const bm2 = ph(tide.bm2_heure); const pm2 = ph(tide.pm2_heure);
    const hMax = parseFloat((tide.hauteur_max || "").replace(",", ".")) || 5.3;
    const hMin = 0.9;

    let isRising = true, h = hMax / 2;

    if (bm1 && pm1 && bm2) {
        if (hour <= pm1) {
            isRising = true;
            h = hMin + (hMax - hMin) * (0.5 - 0.5 * Math.cos(Math.min(1,(hour-bm1)/(pm1-bm1)) * Math.PI));
        } else if (hour <= bm2) {
            isRising = false;
            h = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(Math.min(1,(hour-pm1)/(bm2-pm1)) * Math.PI));
        } else if (pm2 && hour <= pm2) {
            isRising = true;
            h = hMin + (hMax - hMin) * (0.5 - 0.5 * Math.cos(Math.min(1,(hour-bm2)/(pm2-bm2)) * Math.PI));
        } else if (pm2) {
            isRising = false;
            h = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(Math.min(1,(hour-pm2)/(24-pm2)) * Math.PI));
        } else {
            isRising = hour < bm2 + (24 - bm2) / 2;
            h = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(Math.min(1,(hour-bm2)/(24-bm2)) * Math.PI));
        }
    }

    return {
        arrow:  isRising ? '↗️' : '↘️',
        status: isRising ? 'Montante' : 'Descendante',
        height: Math.max(hMin * 0.8, Math.min(hMax * 1.1, h)).toFixed(1)
    };
}

// ============================================
// GRAPHIQUE MARÉE
// ============================================
function drawTideChart(canvas) {
    if (typeof Chart === 'undefined') return;

    const now   = getDisplayDate();
    const today = now.toISOString().split('T')[0];
    const tide  = mareesData.find(m => m.date && m.date.startsWith(today));
    if (!tide) return;

    const { events, hMax, hMin } = getTideEvents(tide);

    const labels = [];
    const data   = [];

    for (let i = 0; i <= 24; i++) {
        labels.push(i + 'h');
        data.push(parseFloat(tideHeightAt(i, events, hMin, hMax).toFixed(2)));
    }

    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Détruire tout chart existant sur ce canvas
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    canvas._chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data, borderColor: '#1e88e5',
                backgroundColor: 'rgba(30,136,229,0.1)',
                fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 13, font: { size: 10 } } },
                y: { min: 0, max: Math.ceil(hMax) + 1, ticks: { callback: v => v + 'm', stepSize: 1, font: { size: 10 } } }
            }
        },
        plugins: [{
            id: 'nowLine',
            afterDatasetsDraw(chart) {
                const { ctx, scales: { x, y } } = chart;
                const px = x.getPixelForValue(currentHour);
                ctx.save();
                ctx.strokeStyle = '#f44336'; ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);
                ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke();
                ctx.restore();
            }
        }]
    });
}

// ============================================
// MARQUEURS BARS
// ============================================
function createBarIcon() {
    const html = `<img src="images/bar.png" style="width:36px;height:36px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">`;
    return L.divIcon({ html: html, className: '', iconSize: [36,36], iconAnchor: [18,36], popupAnchor: [0,-36] });
}

function createBarPopup(bar) {
    const nom       = bar.Nom || '';
    const adresse   = bar.Adresse || '';
    const horaires  = bar.Horaires || '';
    const tel       = bar.telephone || '';
    const desc      = bar.Description || '';
    const photo     = bar.Photo || '';
    const imgPath   = photo ? `images/${photo}` : '';

    return `
        <div class="popup-wrap">
            <div class="popup-header" style="background:linear-gradient(135deg,#9c27b0,#6a1b9a);">${nom}</div>
            <div class="popup-body popup-scroll">
                ${imgPath ? `<img src="${imgPath}" alt="${nom}" onerror="this.style.display='none'"
                     style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:10px;">` : ''}
                ${adresse  ? `<p>📍 ${adresse}</p>` : ''}
                ${horaires ? `<p>🕐 ${horaires}</p>` : ''}
                ${tel      ? `<p>📞 ${tel}</p>` : ''}
                ${desc     ? `<p style="color:#666;font-style:italic;">${desc}</p>` : ''}
            </div>
        </div>`;
}

function addBarsMarkers() {
    barsData.forEach(function(bar) {
        const lat = parseFloat(bar.Latitude);
        const lon = parseFloat(bar.Longitude);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

        const marker = L.marker([lat, lon], { icon: createBarIcon() })
            .addTo(map)
            .bindPopup(createBarPopup(bar), { maxWidth: 280, closeButton: true });

        marker._nomLieu = bar.Nom || '';

        marker.on('popupopen', function() {
            setTimeout(function() {
                const wrapper = document.querySelector('.leaflet-popup-content-wrapper');
                if (!wrapper) return;
                wrapper.addEventListener('click', function() { map.closePopup(); });
            }, 150);
        });

        barsMarkers.push(marker);
    });
}

function removeBarsMarkers() {
    barsMarkers.forEach(function(m) { map.removeLayer(m); });
    barsMarkers = [];
}

// ============================================
// TOGGLE BARS DANS LE MENU
// ============================================
function initMenu() {
    const burger  = document.getElementById('menu-burger');
    const menu    = document.getElementById('nav-menu');
    const overlay = document.getElementById('menu-overlay');
    const close   = document.getElementById('close-menu');

    const open = () => { menu.classList.add('show'); overlay.classList.add('show'); };
    const shut = () => { menu.classList.remove('show'); overlay.classList.remove('show'); };

    burger.addEventListener('click', open);
    close.addEventListener('click', shut);
    overlay.addEventListener('click', shut);

    document.querySelectorAll('.nav-item').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const toggle = btn.getAttribute('data-toggle');
            if (toggle === 'bars') {
                showBars = !showBars;
                btn.classList.toggle('active', showBars);
                showBars ? addBarsMarkers() : removeBarsMarkers();
            } else if (toggle === 'restaurants') {
                showRestos = !showRestos;
                btn.classList.toggle('active', showRestos);
                showRestos ? addRestosMarkers() : removeRestosMarkers();
            }
            shut();
        });
    });
}

// ============================================
// MARQUEURS RESTOS
// ============================================
function createRestoIcon() {
    const html = `<img src="images/resto.png" style="width:36px;height:36px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">`;
    return L.divIcon({ html: html, className: '', iconSize: [36,36], iconAnchor: [18,36], popupAnchor: [0,-36] });
}

function createRestoPopup(resto) {
    const nom      = resto.Nom || '';
    const adresse  = resto.Adresse || '';
    const horaires = resto.Horaires || '';
    const tel      = resto.telephone || '';
    const desc     = resto.Description || '';
    const photo    = resto.Photo || '';
    const url      = resto.URL || '';
    const imgPath  = photo ? `images/${photo}` : '';

    return `
        <div class="popup-wrap">
            <div class="popup-header" style="background:linear-gradient(135deg,#e53935,#b71c1c);">${nom}</div>
            <div class="popup-body popup-scroll">
                ${imgPath ? `<img src="${imgPath}" alt="${nom}" onerror="this.style.display='none'"
                     style="width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:10px;">` : ''}
                ${adresse  ? `<p>📍 ${adresse}</p>` : ''}
                ${horaires ? `<p>🕐 ${horaires}</p>` : ''}
                ${url      ? `<p>🔗 <a href="${url}" target="_blank">Voir la page</a></p>` : ''}
                ${desc     ? `<p style="color:#666;font-style:italic;">${desc}</p>` : ''}
                ${tel      ? `<a href="tel:${tel}" class="btn-call">📞 Appeler</a>` : ''}
            </div>
        </div>`;
}

function addRestosMarkers() {
    restosData.forEach(function(resto) {
        const lat = parseFloat(resto.Latitude);
        const lon = parseFloat(resto.Longitude);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

        const nom = resto.Nom || '';

        // Si un bar avec le même nom est affiché, le retirer de la carte
        if (showBars) {
            barsMarkers.forEach(function(m) {
                if (m._nomLieu === nom) map.removeLayer(m);
            });
        }

        const marker = L.marker([lat, lon], { icon: createRestoIcon() })
            .addTo(map)
            .bindPopup(createRestoPopup(resto), { maxWidth: 280, closeButton: true });

        marker._nomLieu = nom;

        marker.on('popupopen', function() {
            setTimeout(function() {
                const wrapper = document.querySelector('.leaflet-popup-content-wrapper');
                if (!wrapper) return;
                wrapper.addEventListener('click', function(e) {
                    if (e.target.tagName !== 'A') map.closePopup();
                });
            }, 150);
        });

        restosMarkers.push(marker);
    });
}

function removeRestosMarkers() {
    restosMarkers.forEach(function(m) { map.removeLayer(m); });
    restosMarkers = [];

    // Réafficher les marqueurs bars qui avaient été masqués
    if (showBars) {
        const nomsRestos = restosData.map(r => r.Nom || '');
        barsMarkers.forEach(function(m) {
            if (nomsRestos.includes(m._nomLieu)) map.addLayer(m);
        });
    }
}
