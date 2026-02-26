// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    SHEET_BASE_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    SHEET_GIDS: {
        PLAGES:          0,
        MAREES:          138428367,
        RECOMMANDATIONS: 2049933385
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
    const [plagesCSV, mareesCSV, recoCSV] = await Promise.all([
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.PLAGES}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.MAREES}`).then(r => r.text()),
        fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RECOMMANDATIONS}`).then(r => r.text())
    ]);

    plagesData = parseCSV(plagesCSV);
    mareesData = parseCSV(mareesCSV);
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
            .bindPopup(createPopup(plage), { maxWidth: 280, closeButton: true });

        marker.on('click', function() {
            if (selectedMarker && selectedMarker !== marker) {
                selectedMarker.setIcon(createParasolIcon(selectedMarker._color, false));
            }
            marker.setIcon(createParasolIcon(color, true));
            selectedMarker = marker;
        });

        marker.on('popupopen', function() {
            setTimeout(function() {
                const canvas = document.querySelector('.tide-canvas');
                if (canvas) drawTideChart(canvas);
            }, 300);
        });

        marker._color = color;
        plagesMarkers.push(marker);
    });

    console.log(`${plagesMarkers.length} marqueurs plages ajoutés`);
}

function getColor(plage) {
    const map = { 'Vert': 'green', 'Bleu': 'blue', 'Orange': 'orange', 'Rouge': 'red' };
    if (plage.couleur && map[plage.couleur]) return map[plage.couleur];
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
function initHeader() {
    function update() {
        const now = new Date();
        document.getElementById('current-date').textContent =
            now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        document.getElementById('current-time').textContent =
            now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    update();
    setInterval(update, 1000);
}

// ============================================
// MENU BURGER
// ============================================
function initMenu() {
    const burger  = document.getElementById('menu-burger');
    const menu    = document.getElementById('nav-menu');
    const overlay = document.getElementById('menu-overlay');
    const close   = document.getElementById('close-menu');

    const open  = () => { menu.classList.add('show'); overlay.classList.add('show'); };
    const shut  = () => { menu.classList.remove('show'); overlay.classList.remove('show'); };

    burger.addEventListener('click', open);
    close.addEventListener('click', shut);
    overlay.addEventListener('click', shut);
}

// ============================================
// APPEL INIT COMPLET
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    initMap();
    initHeader();
    initMenu();
    await loadData();
    addPlagesMarkers();
});

// ============================================
// POPUPS PLAGES
// ============================================
function createPopup(plage) {
    const nom         = plage.Nom || plage.nom || 'Plage';
    const mareeIdeale = plage['Marée idéale'] || plage.maree_ideale || '-';
    const tideInfo    = getTideInfo();
    const chartId     = 'chart-' + Math.random().toString(36).substr(2, 8);

    return `
        <div class="popup-wrap">
            <div class="popup-header">${nom}</div>
            <div class="popup-body">
                <p><strong>Marée idéale :</strong> ${mareeIdeale}</p>
                <p><strong>Marée actuelle :</strong> ${tideInfo.arrow} ${tideInfo.status} — ${tideInfo.height}m</p>
                <div class="popup-chart"><canvas class="tide-canvas"></canvas></div>
            </div>
        </div>`;
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

    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const tide  = mareesData.find(m => m.date && m.date.startsWith(today));
    if (!tide) return;

    const ph   = t => { if (!t) return null; const m = t.match(/(\d+)h(\d+)/); return m ? +m[1] + +m[2]/60 : null; };
    const bm1  = ph(tide.bm1_heure); const pm1 = ph(tide.pm1_heure);
    const bm2  = ph(tide.bm2_heure); const pm2 = ph(tide.pm2_heure);
    const hMax = parseFloat((tide.hauteur_max || "").replace(",", ".")) || 5.3;
    const hMin = 0.9;

    // 1 point par heure = 25 points, plus lisible
    const labels = [];
    const data   = [];

    for (let i = 0; i <= 24; i++) {
        const h = i;
        labels.push(h + 'h');
        let height = hMax / 2;
        if (bm1 !== null && pm1 !== null && bm2 !== null) {
            if (h <= pm1) {
                const ratio = Math.min(1, Math.max(0, (h - bm1) / (pm1 - bm1)));
                height = hMin + (hMax - hMin) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            } else if (h <= bm2) {
                const ratio = Math.min(1, Math.max(0, (h - pm1) / (bm2 - pm1)));
                height = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            } else if (pm2 !== null && h <= pm2) {
                const ratio = Math.min(1, Math.max(0, (h - bm2) / (pm2 - bm2)));
                height = hMin + (hMax - hMin) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            } else if (pm2 !== null) {
                const ratio = Math.min(1, Math.max(0, (h - pm2) / (24 - pm2)));
                height = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            } else {
                // pm2 absent : descente depuis bm2 jusqu'à minuit
                const ratio = Math.min(1, Math.max(0, (h - bm2) / (24 - bm2)));
                height = hMax - (hMax - hMin) * (0.5 - 0.5 * Math.cos(ratio * Math.PI));
            }
        }
        data.push(parseFloat(Math.max(0, Math.min(hMax, height)).toFixed(2)));
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
