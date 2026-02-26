// Configuration
const CONFIG = {
    SHEET_BASE_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    SHEET_GIDS: {
        PLAGES: 0,
        METEO: 146047806,
        MAREES: 138428367,
        RECOMMANDATIONS: 2049933385,
        BARS: 1057932141,
        RESTAURANTS: 251951681
    },
    GROIX_CENTER: [47.6389, -3.4523],
    ZOOM_LEVEL: 13,
    MAPBOX_TOKEN: 'pk.eyJ1Ijoicm91eHNlYiIsImEiOiJjbW0xd3dvcTAwMTZzMnJzZXdyYXFpMjBvIn0.Tq3uFh1jH5n-7OXcfm7MtQ',
    MAPBOX_STYLE: 'mapbox://styles/rouxseb/cmm3ifqbu002j01qt60k6f6ws'
};

// État global
let map;
let markers = [];
let plagesData = [];
let mareesData = [];
let meteoData = {};
let barsData = [];
let restaurantsData = [];
let currentDateTime = new Date();
let selectedDateTime = null;
let userPosition = null;

// Système multi-cartes
let currentView = 'plages';
let selectedBeachMarker = null;

// Initialisation
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showLoading(true);
    try {
        initMap();
        await loadData();
        initUI();
        initNavMenu();
        updateView();
        showLoading(false);
    } catch (error) {
        console.error('Erreur d\'initialisation:', error);
        alert('Erreur de chargement des données. Vérifiez votre connexion.');
        showLoading(false);
    }
}

// ✅ Initialisation de la carte avec mapbox-gl-leaflet
function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView(CONFIG.GROIX_CENTER, CONFIG.ZOOM_LEVEL);

    L.mapboxGL({
        accessToken: CONFIG.MAPBOX_TOKEN,
        style: CONFIG.MAPBOX_STYLE
    }).addTo(map);

    console.log('Carte Mapbox GL chargée via mapbox-gl-leaflet');
    addGeolocationButton();
}

function addGeolocationButton() {
    const geoButton = L.control({ position: 'topright' });
    geoButton.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        div.innerHTML = `
            <a href="#" id="geolocate-btn" title="Me localiser" style="
                background: white;
                width: 34px;
                height: 34px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                text-decoration: none;
                color: #333;
                border-radius: 4px;
            ">📍</a>
        `;
        L.DomEvent.on(div.querySelector('#geolocate-btn'), 'click', function(e) {
            e.preventDefault();
            geolocateUser();
        });
        return div;
    };
    geoButton.addTo(map);
}

let userMarker = null;
let watchId = null;

function geolocateUser() {
    if (!navigator.geolocation) {
        alert('La géolocalisation n\'est pas supportée par votre navigateur');
        return;
    }
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
        userPosition = null;
        return;
    }
    showLoading(true);
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            userPosition = { lat, lon };
            if (!userMarker) {
                const userIcon = L.divIcon({
                    html: `<div style="width:20px;height:20px;background:#9c27b0;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(156,39,176,0.5);animation:pulse 2s infinite;"></div>`,
                    className: '', iconSize: [20, 20], iconAnchor: [10, 10]
                });
                userMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map).bindPopup('📍 Vous êtes ici');
                map.setView([lat, lon], 14);
                showLoading(false);
            } else {
                userMarker.setLatLng([lat, lon]);
            }
        },
        (error) => {
            showLoading(false);
            const messages = {
                [error.PERMISSION_DENIED]: 'Vous avez refusé l\'accès à votre position',
                [error.POSITION_UNAVAILABLE]: 'Position indisponible',
                [error.TIMEOUT]: 'La demande de géolocalisation a expiré'
            };
            alert(messages[error.code] || 'Erreur de géolocalisation');
            if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function loadData() {
    try {
        const [plagesCSV, meteoCSV, mareesCSV, recoCSV, barsCSV, restosCSV] = await Promise.all([
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.PLAGES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.METEO}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.MAREES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RECOMMANDATIONS}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.BARS}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RESTAURANTS}`).then(r => r.text())
        ]);
        plagesData = parseCSV(plagesCSV);
        meteoData = parseCSV(meteoCSV)[0] || {};
        mareesData = parseCSV(mareesCSV);
        const recoArray = parseCSV(recoCSV);
        barsData = parseCSV(barsCSV);
        restaurantsData = parseCSV(restosCSV);
        plagesData.forEach((plage, index) => {
            if (recoArray[index]) {
                plage.couleur = recoArray[index].couleur;
                plage.score = parseFloat(recoArray[index].SCORE_FINAL) || 0;
            }
        });
        console.log('Données chargées:', { plages: plagesData.length, marees: mareesData.length, bars: barsData.length, restaurants: restaurantsData.length });
    } catch (error) {
        console.error('Erreur de chargement:', error);
        throw error;
    }
}

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > 0 && values[0]) {
            const row = {};
            headers.forEach((header, index) => { row[header] = values[index] ? values[index].trim().replace(/"/g, '') : ''; });
            data.push(row);
        }
    }
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
        else { current += char; }
    }
    result.push(current);
    return result;
}

function initUI() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    document.getElementById('datetime-display').addEventListener('click', toggleCalendar);
    document.getElementById('btn-now').addEventListener('click', resetToNow);
    document.getElementById('btn-validate').addEventListener('click', validateDateTime);
    document.getElementById('btn-cancel').addEventListener('click', () => toggleCalendar(false));
    generateDateSelector();
    generateHourSelector();
}

function updateDateTime() {
    const now = selectedDateTime || currentDateTime;
    document.getElementById('current-date').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('current-time').textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (!selectedDateTime) currentDateTime = new Date();
}

function toggleCalendar(show = null) {
    const panel = document.getElementById('calendar-panel');
    if (show === null) { panel.classList.toggle('hidden'); }
    else { show ? panel.classList.remove('hidden') : panel.classList.add('hidden'); }
}

function generateDateSelector() {
    const container = document.getElementById('date-selector');
    const today = new Date();
    for (let i = 0; i < 10; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const btn = document.createElement('button');
        btn.className = 'date-btn';
        if (i === 0) btn.classList.add('selected');
        const dayNum = document.createElement('span');
        dayNum.className = 'day-num';
        dayNum.textContent = date.getDate();
        const dayName = document.createElement('span');
        dayName.className = 'day-name';
        dayName.textContent = date.toLocaleDateString('fr-FR', { weekday: 'short' });
        btn.appendChild(dayNum);
        btn.appendChild(dayName);
        btn.dataset.date = date.toISOString().split('T')[0];
        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
        container.appendChild(btn);
    }
}

function generateHourSelector() {
    const select = document.getElementById('hour-selector');
    for (let h = 0; h < 24; h++) {
        const option = document.createElement('option');
        option.value = h;
        option.textContent = `${h.toString().padStart(2, '0')}:00`;
        select.appendChild(option);
    }
    select.value = new Date().getHours();
}

function resetToNow() {
    selectedDateTime = null;
    updateDateTime();
    updateMarkers();
    toggleCalendar(false);
}

function validateDateTime() {
    const selectedDateBtn = document.querySelector('.date-btn.selected');
    const selectedHour = document.getElementById('hour-selector').value;
    if (selectedDateBtn) {
        const date = new Date(selectedDateBtn.dataset.date);
        date.setHours(parseInt(selectedHour), 0, 0, 0);
        selectedDateTime = date;
        updateDateTime();
        updateMarkers();
    }
    toggleCalendar(false);
}

let selectedMarker = null;

function updateMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    plagesData.forEach(plage => {
        const lat = parseFloat(plage.Latitude || plage.latitude);
        const lon = parseFloat(plage.Longitude || plage.longitude);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;
        const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(plage.score || 50);
        const marker = L.marker([lat, lon], { icon: createCustomIcon(color, false) })
            .addTo(map)
            .bindPopup(() => createPopupContent(plage), { autoPan: false, closeButton: false });
        marker.on('click', function() {
            if (selectedMarker && selectedMarker !== marker) selectedMarker.setIcon(createCustomIcon(selectedMarker.plageColor, false));
            marker.setIcon(createCustomIcon(color, true));
            selectedMarker = marker;
            marker.plageColor = color;
        });
        marker.on('popupopen', function() {
            const popupElement = marker.getPopup().getElement();
            if (!popupElement) return;
            popupElement.addEventListener('click', function(e) {
                if (e.target.tagName !== 'CANVAS') {
                    map.closePopup();
                    if (selectedMarker === marker) { marker.setIcon(createCustomIcon(color, false)); selectedMarker = null; }
                }
            });
            let isDragging = false, startX, startY, scrollLeft, scrollTop;
            const popupContent = popupElement.querySelector('.leaflet-popup-content-wrapper');
            if (popupContent) {
                popupContent.style.cursor = 'grab';
                popupContent.addEventListener('mousedown', function(e) {
                    if (e.target.tagName === 'CANVAS') return;
                    isDragging = true; popupContent.style.cursor = 'grabbing';
                    startX = e.clientX; startY = e.clientY;
                    scrollLeft = map.getCenter().lng; scrollTop = map.getCenter().lat;
                    e.preventDefault();
                });
                popupContent.addEventListener('touchstart', function(e) {
                    if (e.target.tagName === 'CANVAS') return;
                    isDragging = true;
                    const touch = e.touches[0];
                    startX = touch.clientX; startY = touch.clientY;
                    scrollLeft = map.getCenter().lng; scrollTop = map.getCenter().lat;
                }, { passive: true });
                document.addEventListener('mousemove', function(e) {
                    if (!isDragging) return;
                    const scale = 0.0001;
                    map.panTo([scrollTop + (e.clientY - startY) * scale, scrollLeft - (e.clientX - startX) * scale], { animate: false });
                });
                document.addEventListener('touchmove', function(e) {
                    if (!isDragging) return;
                    const touch = e.touches[0]; const scale = 0.0001;
                    map.panTo([scrollTop + (touch.clientY - startY) * scale, scrollLeft - (touch.clientX - startX) * scale], { animate: false });
                }, { passive: true });
                document.addEventListener('mouseup', () => { isDragging = false; if (popupContent) popupContent.style.cursor = 'grab'; });
                document.addEventListener('touchend', () => { isDragging = false; });
            }
        });
        marker.plageColor = color;
        markers.push(marker);
    });
    console.log(`${markers.length} marqueurs créés`);
}

function getColorFromName(colorName) {
    return { 'Vert': 'green', 'Bleu': 'blue', 'Orange': 'orange', 'Rouge': 'red' }[colorName] || 'blue';
}

function getColorFromScore(score) {
    if (score >= 75) return 'green';
    if (score >= 60) return 'blue';
    if (score >= 40) return 'orange';
    return 'red';
}

function createCustomIcon(color, selected = false) {
    const colors = { green: '#4caf50', blue: '#2196f3', orange: '#ff9800', red: '#f44336' };
    const borderColor = selected ? '#9c27b0' : 'white';
    const borderWidth = selected ? '2.5' : '1.5';
    const parasol = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <g transform="rotate(15, 16, 20)">
                <ellipse cx="16" cy="30" rx="6" ry="1.5" fill="rgba(0,0,0,0.2)"/>
                <line x1="16" y1="14" x2="16" y2="29" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="16" cy="3" r="1.2" fill="#666"/>
                <path d="M 4 14 Q 4 4, 16 2 Q 28 4, 28 14" fill="${colors[color]}" stroke="${borderColor}" stroke-width="${borderWidth}" stroke-linejoin="round"/>
                <path d="M 16 2 L 16 14" stroke="rgba(255,255,255,0.3)" stroke-width="1.2"/>
                <path d="M 11 4 L 12 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M 21 4 L 20 14" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>
                <path d="M 7 7 L 9 14" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                <path d="M 25 7 L 23 14" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                <path d="M 4 14 L 16 2" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 28 14 L 16 2" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 11 4 L 12 14" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
                <path d="M 21 4 L 20 14" stroke="rgba(0,0,0,0.3)" stroke-width="0.8" fill="none"/>
            </g>
        </svg>`;
    return L.divIcon({ html: parasol, className: '', iconSize: [32, 32], iconAnchor: [16, 30], popupAnchor: [0, -30] });
}

function createPopupContent(plage) {
    const nom = plage.Nom || plage.nom || 'Plage';
    const mareeIdeale = plage['Marée idéale'] || plage.maree_ideale || 'inconnue';
    const score = plage.score || 0;
    const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(score);
    const colorMap = { green: '#4caf50', blue: '#2196f3', orange: '#ff9800', red: '#f44336' };
    const tideInfo = getTideInfo();
    const imageUrl = getPlageImageUrl(nom);
    const imageHtml = imageUrl ? `<img src="${imageUrl}" alt="${nom}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:12px;">` : '';
    const chartId = `tide-chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const content = `
        <div class="popup-header">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:24px;height:24px;background:${colorMap[color]};border:3px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>
                <span>${nom}</span>
            </div>
        </div>
        <div class="popup-body">
            ${imageHtml}
            <div style="font-size:13px;line-height:1.6;margin-bottom:12px;">
                <p style="margin:8px 0;"><strong>Marée idéale :</strong> ${mareeIdeale}</p>
                <p style="margin:8px 0;"><strong>Marée actuelle :</strong> ${tideInfo.arrow} ${tideInfo.status} (${tideInfo.height}m)</p>
            </div>
            <div class="tide-chart-container"><canvas id="${chartId}"></canvas></div>
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#666;font-style:italic;">
                Si c'est pas bien, Allez chez H
            </div>
        </div>`;
    setTimeout(() => { const canvas = document.getElementById(chartId); if (canvas) createTideChartInCanvas(canvas, plage); }, 300);
    return content;
}

function getPlageImageUrl(nomPlage) {
    const images = {
        "Plage des Grands Sables": "images/les-grands-sables.jpg",
        "Les Grands Sables": "images/les-grands-sables.jpg",
        "Port Mélite": "images/port-melite.jpg",
        "Côte d'Héno": "images/cote-d-heno.jpg",
        "Cote d'Héno": "images/cote-d-heno.jpg",
        "Côte d'Heno": "images/cote-d-heno.jpg",
        "Cote d'Heno": "images/cote-d-heno.jpg",
        "Plage d'Héno": "images/cote-d-heno.jpg",
        "Plage d'Heno": "images/cote-d-heno.jpg",
        "Plage de la Côte d'Héno": "images/cote-d-heno.jpg",
        "Poulziorec": "images/poulziorec.jpg",
        "Sables Rouges": "images/les-sables-rouges.jpg",
        "Les Sables Rouges": "images/les-sables-rouges.jpg",
        "Plage du WWF": "images/plage-du-wwf.jpg",
        "Port Coustic": "images/port-coustic.jpg",
        "Port-Coustic": "images/port-coustic.jpg",
        "Plage de Port Coustic": "images/port-coustic.jpg",
        "Port Melin": "images/port-melin.jpg",
        "Port Lay": "images/port-lay.jpg",
        "Porskedoul": "images/porskedoul.jpg",
        "Porh Morvil": "images/port-morvil.jpg",
        "Porzh er Roued": "images/porhzh-er-roed.jpg",
        "Porzh er roued": "images/porhzh-er-roed.jpg",
        "Le Stang": "images/stang.jpg",
        "Stang": "images/stang.jpg",
        "Baie des Curés": "images/baie-des-cures.jpg",
        "Baie des Cures": "images/baie-des-cures.jpg",
        "Port St Nicolas": "images/port-saint-nicolas.jpg",
        "Port Saint Nicolas": "images/port-saint-nicolas.jpg",
        "Port Saint-Nicolas": "images/port-saint-nicolas.jpg",
        "Locmaria": "images/locmaria.jpg",
        "Pointe des Chats": "images/pointe-des-chats.jpg",
        "Pointe des chats": "images/pointe-des-chats.jpg",
        "Chochaï": "images/chochai.jpg",
        "Chochai": "images/chochai.jpg",
        "Kermarec": "images/kermarec.jpg"
    };
    let result = images[nomPlage];
    if (!result && (nomPlage.includes('Héno') || nomPlage.includes('Heno') || nomPlage.includes('héno') || nomPlage.includes('heno'))) {
        result = "images/cote-d-heno.jpg";
    }
    return result || null;
}

function getTideInfo() {
    const now = selectedDateTime || currentDateTime;
    const today = now.toISOString().split('T')[0];
    const todayTide = mareesData.find(m => m.date && m.date.startsWith(today));
    if (!todayTide) return { arrow: '↗️', status: 'Montante', height: '3.5', max_high: '5.3', max_low: '0.9' };
    const hour = now.getHours() + now.getMinutes() / 60;
    const parseHour = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+)h(\d+)/);
        return match ? parseInt(match[1]) + parseInt(match[2]) / 60 : null;
    };
    const bm1 = parseHour(todayTide.bm1_heure || todayTide.bm1);
    const pm1 = parseHour(todayTide.pm1_heure || todayTide.pm1);
    const bm2 = parseHour(todayTide.bm2_heure || todayTide.bm2);
    const pm2 = parseHour(todayTide.pm2_heure || todayTide.pm2);
    const hauteurMax = parseFloat(todayTide.hauteur_max) || 5.3;
    let isRising = true, currentHeight = hauteurMax / 2;
    if (bm1 && pm1) {
        if (hour < pm1) { isRising = true; currentHeight = 0.9 + ((hour - (bm1 || 0)) / (pm1 - (bm1 || 0))) * (hauteurMax - 0.9); }
        else if (bm2 && hour < bm2) { isRising = false; currentHeight = hauteurMax - ((hour - pm1) / (bm2 - pm1)) * (hauteurMax - 0.9); }
        else if (pm2 && hour < pm2) { isRising = true; currentHeight = 0.9 + ((hour - (bm2 || 12)) / (pm2 - (bm2 || 12))) * (hauteurMax - 0.9); }
        else { isRising = false; currentHeight = hauteurMax - ((hour - (pm2 || 18)) / 6) * (hauteurMax - 0.9); }
    }
    return {
        arrow: isRising ? '↗️' : '↘️',
        status: isRising ? 'Montante' : 'Descendante',
        height: Math.max(0.5, Math.min(hauteurMax, currentHeight)).toFixed(1),
        max_high: hauteurMax.toFixed(1),
        max_low: '0.9'
    };
}

function createTideChartInCanvas(canvas, plage) {
    if (typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (canvas.chartInstance) { canvas.chartInstance.destroy(); canvas.chartInstance = null; }
    const now = selectedDateTime || currentDateTime;
    const today = now.toISOString().split('T')[0];
    const todayTide = mareesData.find(m => m.date && m.date.startsWith(today));
    if (!todayTide) return;
    const parseHour = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+)h(\d+)/);
        return match ? parseInt(match[1]) + parseInt(match[2]) / 60 : null;
    };
    const bm1 = parseHour(todayTide.bm1_heure || todayTide.bm1);
    const pm1 = parseHour(todayTide.pm1_heure || todayTide.pm1);
    const bm2 = parseHour(todayTide.bm2_heure || todayTide.bm2);
    const pm2 = parseHour(todayTide.pm2_heure || todayTide.pm2);
    const hauteurMax = parseFloat(todayTide.hauteur_max) || 5.3;
    const hauteurMin = 0.9;
    const labels = [], data = [];
    for (let h = 0; h <= 24; h += 0.25) {
        labels.push(h % 1 === 0 ? `${Math.floor(h)}h` : '');
        let height = hauteurMax / 2;
        if (bm1 && pm1 && bm2 && pm2) {
            if (h < pm1) { const phase = ((h - bm1) / (pm1 - bm1)) * Math.PI; height = hauteurMin + ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase)); }
            else if (h < bm2) { const phase = ((h - pm1) / (bm2 - pm1)) * Math.PI; height = hauteurMax - ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase)); }
            else if (h < pm2) { const phase = ((h - bm2) / (pm2 - bm2)) * Math.PI; height = hauteurMin + ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase)); }
            else { const phase = ((h - pm2) / (24 - pm2 + bm1)) * Math.PI * 0.5; height = hauteurMax - ((hauteurMax - hauteurMin) / 2) * (1 - Math.cos(phase)); }
        }
        data.push(Math.max(hauteurMin * 0.8, Math.min(hauteurMax * 1.1, height)));
    }
    try {
        const currentHour = now.getHours() + now.getMinutes() / 60;
        canvas.chartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Hauteur (m)', data, borderColor: '#1e88e5', backgroundColor: 'rgba(30,136,229,0.1)', fill: true, tension: 0.9, pointRadius: 0, borderWidth: 2.5 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y.toFixed(2)}m` } } },
                scales: {
                    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                    y: { min: 0, max: 6, ticks: { callback: v => v + 'm', stepSize: 1 } }
                }
            },
            plugins: [{
                id: 'currentTimeMarker',
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx, xAxis = chart.scales.x, yAxis = chart.scales.y;
                    const x = xAxis.getPixelForValue(currentHour * 4);
                    ctx.save(); ctx.strokeStyle = '#f44336'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
                    ctx.beginPath(); ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom); ctx.stroke(); ctx.restore();
                }
            }]
        });
    } catch (error) { console.error('Erreur graphique:', error); }
}

// ========================================
// SYSTÈME MULTI-CARTES
// ========================================

function initNavMenu() {
    const menuBurger = document.getElementById('menu-burger');
    const navMenu = document.getElementById('nav-menu');
    const menuOverlay = document.getElementById('menu-overlay');
    const closeMenu = document.getElementById('close-menu');
    if (!menuBurger || !navMenu || !menuOverlay) { console.error('Éléments du menu non trouvés !'); return; }
    menuBurger.addEventListener('click', () => { navMenu.classList.add('show'); menuOverlay.classList.add('show'); });
    const closeMenuFn = () => { navMenu.classList.remove('show'); menuOverlay.classList.remove('show'); };
    closeMenu.addEventListener('click', closeMenuFn);
    menuOverlay.addEventListener('click', closeMenuFn);
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => { switchView(item.getAttribute('data-view')); closeMenuFn(); });
    });
    updateActiveNavItem();
    console.log('Menu initialisé avec succès');
}

function updateActiveNavItem() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.getAttribute('data-view') === currentView ? item.classList.add('active') : item.classList.remove('active');
    });
}

function switchView(view) { currentView = view; updateActiveNavItem(); updateView(); }

function updateView() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    const legend = document.getElementById('legend');
    const calendarPanel = document.getElementById('calendar-panel');
    const datetimeDisplay = document.getElementById('datetime-display');
    switch(currentView) {
        case 'plages':
            legend.style.display = 'flex';
            datetimeDisplay.classList.add('clickable');
            updateMarkers();
            break;
        case 'bars':
            legend.style.display = 'none';
            datetimeDisplay.classList.remove('clickable');
            calendarPanel.classList.add('hidden');
            updateBarsMarkers();
            break;
        case 'restaurants':
            legend.style.display = 'none';
            datetimeDisplay.classList.remove('clickable');
            calendarPanel.classList.add('hidden');
            updateRestaurantsMarkers();
            break;
    }
    if (userMarker) userMarker.addTo(map);
}

function createCocktailIcon(selected = false) {
    const borderColor = selected ? '#9c27b0' : '#1e88e5';
    const borderWidth = selected ? '3' : '2';
    const cocktail = `
        <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="20" cy="38" rx="8" ry="2" fill="rgba(0,0,0,0.2)"/>
            <rect x="18" y="25" width="4" height="10" fill="#666" rx="1"/>
            <ellipse cx="20" cy="35" rx="6" ry="2" fill="#888"/>
            <path d="M 8 8 L 20 25 L 32 8 Z" fill="#4db8ff" fill-opacity="0.7" stroke="${borderColor}" stroke-width="${borderWidth}"/>
            <path d="M 12 10 L 18 20 L 14 12 Z" fill="rgba(255,255,255,0.4)"/>
            <line x1="8" y1="8" x2="32" y2="8" stroke="${borderColor}" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="24" y1="6" x2="24" y2="14" stroke="#ff6b6b" stroke-width="1.5"/>
            <path d="M 20 6 L 24 6 L 28 6 L 24 10 Z" fill="#ff6b6b"/>
        </svg>`;
    return L.divIcon({ html: cocktail, className: '', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
}

function createCouvertsIcon(selected = false) {
    const borderColor = selected ? '#9c27b0' : '#555';
    const borderWidth = selected ? '1.2' : '0.8';
    const couverts = `
        <svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="20" cy="38" rx="8" ry="2" fill="rgba(0,0,0,0.2)"/>
            <g>
                <rect x="13" y="20" width="2" height="15" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="11" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="13" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="15" y="8" width="1.5" height="13" fill="#555" rx="0.5" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <rect x="11" y="18" width="6" height="3" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
            </g>
            <g>
                <rect x="25" y="20" width="2" height="15" fill="#555" rx="1" stroke="${borderColor}" stroke-width="${borderWidth}"/>
                <path d="M 23 8 L 29 8 L 27 20 L 25 20 Z" fill="#888" stroke="${borderColor}" stroke-width="${borderWidth}"/>
            </g>
            <ellipse cx="20" cy="36" rx="10" ry="3" fill="none" stroke="${borderColor}" stroke-width="1.5"/>
        </svg>`;
    return L.divIcon({ html: couverts, className: '', iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
}

function updateBarsMarkers() {
    barsData.forEach(bar => {
        const valide = bar.Valide || bar.Validé || bar.validé || bar.valide || bar.VALIDE;
        if (valide !== '1' && valide !== 1) return;
        const lat = parseFloat(bar.Latitude || bar.latitude || bar.LATITUDE);
        const lon = parseFloat(bar.Longitude || bar.longitude || bar.LONGITUDE);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;
        const marker = L.marker([lat, lon], { icon: createCocktailIcon(false) })
            .addTo(map)
            .bindPopup(() => createSimplePopup(bar, 'bar'), { autoPan: false, closeButton: false });
        marker.on('click', function() {
            if (selectedMarker && selectedMarker !== marker) selectedMarker.setIcon(selectedMarker.markerType === 'bar' ? createCocktailIcon(false) : createCouvertsIcon(false));
            marker.setIcon(createCocktailIcon(true)); selectedMarker = marker;
        });
        marker.on('popupopen', function() {
            const popupElement = marker.getPopup().getElement();
            if (popupElement) makePopupDraggable(popupElement, marker);
        });
        marker.markerType = 'bar';
        markers.push(marker);
    });
    console.log(`${markers.length} bars affichés`);
}

function updateRestaurantsMarkers() {
    restaurantsData.forEach(restaurant => {
        const valide = restaurant.Valide || restaurant.Validé || restaurant.validé || restaurant.valide || restaurant.VALIDE;
        if (valide !== '1' && valide !== 1) return;
        const lat = parseFloat(restaurant.Latitude || restaurant.latitude || restaurant.LATITUDE);
        const lon = parseFloat(restaurant.Longitude || restaurant.longitude || restaurant.LONGITUDE);
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;
        const marker = L.marker([lat, lon], { icon: createCouvertsIcon(false) })
            .addTo(map)
            .bindPopup(() => createSimplePopup(restaurant, 'restaurant'), { autoPan: false, closeButton: false });
        marker.on('click', function() {
            if (selectedMarker && selectedMarker !== marker) selectedMarker.setIcon(selectedMarker.markerType === 'bar' ? createCocktailIcon(false) : createCouvertsIcon(false));
            marker.setIcon(createCouvertsIcon(true)); selectedMarker = marker;
        });
        marker.on('popupopen', function() {
            const popupElement = marker.getPopup().getElement();
            if (popupElement) makePopupDraggable(popupElement, marker);
        });
        marker.markerType = 'restaurant';
        markers.push(marker);
    });
    console.log(`${markers.length} restaurants affichés`);
}

function makePopupDraggable(popupElement, marker) {
    let isDragging = false, startX, startY, scrollLeft, scrollTop;
    const popupContent = popupElement.querySelector('.leaflet-popup-content-wrapper');
    if (!popupContent) return;
    popupContent.style.cursor = 'grab';
    popupContent.addEventListener('mousedown', function(e) {
        isDragging = true; popupContent.style.cursor = 'grabbing';
        startX = e.clientX; startY = e.clientY;
        scrollLeft = map.getCenter().lng; scrollTop = map.getCenter().lat;
        e.preventDefault();
    });
    popupContent.addEventListener('touchstart', function(e) {
        isDragging = true;
        const touch = e.touches[0];
        startX = touch.clientX; startY = touch.clientY;
        scrollLeft = map.getCenter().lng; scrollTop = map.getCenter().lat;
    }, { passive: true });
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        const scale = 0.0001;
        map.panTo([scrollTop + (e.clientY - startY) * scale, scrollLeft - (e.clientX - startX) * scale], { animate: false });
    });
    document.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        const touch = e.touches[0]; const scale = 0.0001;
        map.panTo([scrollTop + (touch.clientY - startY) * scale, scrollLeft - (touch.clientX - startX) * scale], { animate: false });
    }, { passive: true });
    document.addEventListener('mouseup', () => { isDragging = false; if (popupContent) popupContent.style.cursor = 'grab'; });
    document.addEventListener('touchend', () => { isDragging = false; });
}

function createSimplePopup(lieu, type) {
    const nom = lieu.Nom || lieu.nom || lieu.NOM || 'Lieu';
    const adresse = lieu.Adresse || lieu.adresse || lieu.ADRESSE || '';
    const url = lieu.URL || lieu.url || lieu.Url || lieu.Site || lieu.site || lieu.SITE || lieu.Web || lieu.web || '';
    const horairesRaw = lieu.Horaires || lieu.horaires || lieu.HORAIRES || '';
    const horaires = horairesRaw ? horairesRaw.split('|').map(h => h.trim()).join('<br>') : '';
    const telephone = lieu.Téléphone || lieu.Telephone || lieu.telephone || lieu.Tel || lieu.tel || lieu.TEL || '';
    const description = lieu.Description || lieu.description || lieu.DESCRIPTION || lieu.Desciption || lieu.desciption || lieu.Desc || lieu.desc || '';
    const photoFilename = lieu.Photo || lieu.photo || lieu.PHOTO || lieu.Image || lieu.image || lieu.IMAGE || '';
    const photoUrl = photoFilename ? `images/${photoFilename}` : '';
    const icon = type === 'bar' ? '🍸' : '🍴';
    const photoHTML = photoUrl ? `<img src="${photoUrl}" alt="${nom}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:12px;">` : '';
    const siteButton = url && url.trim() !== '' ? `<a href="${url.startsWith('http') ? url : 'https://' + url}" target="_blank" style="display:inline-block;background:#1e88e5;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;">🌐 Site web</a>` : '';
    const telButton = telephone && telephone.trim() !== '' ? `<a href="tel:${telephone.replace(/\s/g, '')}" style="display:inline-block;background:#4caf50;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;">📞 Appeler</a>` : '';
    return `
        <div style="min-width:220px;max-width:280px;">
            ${photoHTML}
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <span style="font-size:24px;">${icon}</span>
                <strong style="font-size:16px;">${nom}</strong>
            </div>
            ${adresse ? `<p style="margin:8px 0;color:#666;font-size:14px;">📍 ${adresse}</p>` : ''}
            ${horaires ? `<div style="margin:12px 0;padding:10px;background:#f5f5f5;border-radius:6px;"><div style="font-weight:600;font-size:13px;margin-bottom:6px;">🕒 Horaires</div><div style="font-size:12px;color:#555;line-height:1.6;">${horaires}</div></div>` : ''}
            ${telephone ? `<p style="margin:8px 0;font-size:14px;color:#555;">📞 ${telephone}</p>` : ''}
            ${description ? `<p style="margin:12px 0;font-size:13px;color:#666;font-style:italic;">${description}</p>` : ''}
            ${siteButton || telButton ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">${siteButton}${telButton}</div>` : ''}
        </div>`;
}

function showLoading(show) {
    const loading = document.getElementById('loading');
    show ? loading.classList.remove('hidden') : loading.classList.add('hidden');
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('Service Worker enregistré'))
        .catch(err => console.log('Erreur Service Worker:', err));
}
