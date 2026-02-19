// Configuration
const CONFIG = {
    SHEET_BASE_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJyHbc7PkwrZCNp4pk4yRIwskOUu27oWjYt_IBxNYtYG7aAWB2S1leol5nHITv29wUCYEiAczyTY9s/pub?output=csv',
    SHEET_GIDS: {
        PLAGES: 0,
        METEO: 146047806,
        MAREES: 138428367,
        RECOMMANDATIONS: 2049933385
    },
    GROIX_CENTER: [47.6389, -3.4523],
    ZOOM_LEVEL: 13
};

// État global
let map;
let markers = [];
let plagesData = [];
let mareesData = [];
let meteoData = {};
let currentDateTime = new Date();
let selectedDateTime = null;

// Initialisation
document.addEventListener('DOMContentLoaded', init);

async function init() {
    showLoading(true);
    
    try {
        // Initialiser la carte
        initMap();
        
        // Charger les données
        await loadData();
        
        // Initialiser l'UI
        initUI();
        
        // Afficher les marqueurs
        updateMarkers();
        
        showLoading(false);
    } catch (error) {
        console.error('Erreur d\'initialisation:', error);
        alert('Erreur de chargement des données. Vérifiez votre connexion.');
        showLoading(false);
    }
}

// Initialisation de la carte
function initMap() {
    map = L.map('map', {
        zoomControl: true,
        attributionControl: false
    }).setView(CONFIG.GROIX_CENTER, CONFIG.ZOOM_LEVEL);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        minZoom: 11
    }).addTo(map);
}

// Chargement des données depuis Google Sheets
async function loadData() {
    try {
        // Charger les 4 onglets en parallèle
        const [plagesCSV, meteoCSV, mareesCSV, recoCSV] = await Promise.all([
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.PLAGES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.METEO}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.MAREES}`).then(r => r.text()),
            fetch(`${CONFIG.SHEET_BASE_URL}&gid=${CONFIG.SHEET_GIDS.RECOMMANDATIONS}`).then(r => r.text())
        ]);
        
        // Parser les données
        plagesData = parseCSV(plagesCSV);
        const meteoArray = parseCSV(meteoCSV);
        meteoData = meteoArray[0] || {};
        mareesData = parseCSV(mareesCSV);
        const recoArray = parseCSV(recoCSV);
        
        // Enrichir plagesData avec les couleurs des recommandations
        plagesData.forEach((plage, index) => {
            if (recoArray[index]) {
                plage.couleur = recoArray[index].couleur;
                plage.score = parseFloat(recoArray[index].SCORE_FINAL) || 0;
            }
        });
        
        console.log('Données chargées:', { plages: plagesData.length, marees: mareesData.length });
        
    } catch (error) {
        console.error('Erreur de chargement:', error);
        throw error;
    }
}

// Parser CSV simple
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > 0 && values[0]) { // Ignorer les lignes vides
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
            });
            data.push(row);
        }
    }
    
    return data;
}

// Parser une ligne CSV (gère les virgules dans les guillemets)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    
    return result;
}

// Initialisation de l'UI
function initUI() {
    // Date/Heure actuelle
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Événements
    document.getElementById('datetime-display').addEventListener('click', toggleCalendar);
    document.getElementById('btn-now').addEventListener('click', resetToNow);
    document.getElementById('btn-validate').addEventListener('click', validateDateTime);
    document.getElementById('btn-cancel').addEventListener('click', () => toggleCalendar(false));
    
    // Générer le sélecteur de dates
    generateDateSelector();
    
    // Générer le sélecteur d'heures
    generateHourSelector();
}

function updateDateTime() {
    const now = selectedDateTime || currentDateTime;
    
    const dateOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = now.toLocaleDateString('fr-FR', dateOptions);
    
    const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    document.getElementById('current-date').textContent = dateStr;
    document.getElementById('current-time').textContent = timeStr;
    
    if (!selectedDateTime) {
        currentDateTime = new Date();
    }
}

function toggleCalendar(show = null) {
    const panel = document.getElementById('calendar-panel');
    if (show === null) {
        panel.classList.toggle('hidden');
    } else {
        if (show) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    }
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

// Mise à jour des marqueurs
function updateMarkers() {
    // Supprimer les anciens marqueurs
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    // Créer un marqueur pour chaque plage
    plagesData.forEach(plage => {
        // Utiliser les coordonnées du sheet
        const lat = parseFloat(plage.Latitude || plage.latitude);
        const lon = parseFloat(plage.Longitude || plage.longitude);
        
        if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
            console.warn(`Coordonnées invalides pour ${plage.Nom || plage.nom}`, lat, lon);
            return;
        }
        
        // Utiliser la couleur des recommandations ou calculer le score
        const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(plage.score || 50);
        const icon = createCustomIcon(color);
        
        const marker = L.marker([lat, lon], { icon })
            .addTo(map)
            .bindPopup(() => createPopupContent(plage));
        
        markers.push(marker);
    });
    
    console.log(`${markers.length} marqueurs créés`);
}

function getColorFromName(colorName) {
    const colorMap = {
        'Vert': 'green',
        'Bleu': 'blue',
        'Orange': 'orange',
        'Rouge': 'red'
    };
    return colorMap[colorName] || 'blue';
}

function calculateBeachScore(plage) {
    // Calcul simplifié du score
    // Dans la version complète, on utilisera les vraies formules du Google Sheet
    
    const scoreVent = calculateWindScore(plage, meteoData.direction_vent);
    const scoreMaree = calculateTideScore(plage);
    const scoreSoleil = 8; // Fixe pour l'instant
    
    return (scoreVent * 0.5 + scoreMaree * 0.3 + scoreSoleil * 0.2) * 10;
}

function calculateWindScore(plage, windDirection) {
    // Score de 0 à 10 basé sur la direction du vent
    // Plus le vent est aligné avec l'orientation idéale, meilleur le score
    return Math.random() * 10; // Simplifié pour le moment
}

function calculateTideScore(plage) {
    // Score basé sur la marée actuelle vs idéale
    const currentTide = getCurrentTideState();
    
    if (plage.maree_ideale.includes(currentTide)) {
        return 10;
    } else if (plage.maree_ideale.length === 3) {
        return 9; // Bonne à toutes marées
    } else {
        return 5;
    }
}

function getCurrentTideState() {
    // Détermine si on est en marée basse, mi, ou haute
    // Basé sur l'heure actuelle et les horaires de marée
    
    const now = selectedDateTime || currentDateTime;
    const hour = now.getHours() + now.getMinutes() / 60;
    
    // Simplifié : on considère des cycles de 6h
    const cycle = hour % 12;
    
    if (cycle < 2 || cycle > 10) return "haute";
    if (cycle > 4 && cycle < 8) return "basse";
    return "mi";
}

function getColorFromScore(score) {
    if (score >= 75) return 'green';
    if (score >= 60) return 'blue';
    if (score >= 40) return 'orange';
    return 'red';
}

function createCustomIcon(color) {
    const colors = {
        green: '#4caf50',
        blue: '#2196f3',
        orange: '#ff9800',
        red: '#f44336'
    };
    
    const html = `
        <div style="
            width: 24px;
            height: 24px;
            background: ${colors[color]};
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        "></div>
    `;
    
    return L.divIcon({
        html,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function createPopupContent(plage) {
    const nom = plage.Nom || plage.nom || 'Plage';
    const mareeIdeale = plage['Marée idéale'] || plage.maree_ideale || 'inconnue';
    const score = plage.score || 0;
    const color = plage.couleur ? getColorFromName(plage.couleur) : getColorFromScore(score);
    const emoji = { green: '😃', blue: '🙂', orange: '😐', red: '☹️' }[color];
    
    const tideInfo = getTideInfo();
    
    const content = `
        <div class="popup-header">
            ${emoji} ${nom}
        </div>
        <div class="popup-body">
            <div class="popup-section">
                <h4>Marée idéale</h4>
                <p>${mareeIdeale}</p>
            </div>
            
            <div class="popup-section">
                <h4>Marée actuelle</h4>
                <div class="tide-status">
                    <span class="tide-arrow">${tideInfo.arrow}</span>
                    <span>${tideInfo.status} (${tideInfo.height}m)</span>
                </div>
            </div>
            
            <div class="popup-section">
                <p>🔺 Max haut: ${tideInfo.max_high}m</p>
                <p>🔻 Max bas: ${tideInfo.max_low}m</p>
            </div>
            
            <div class="tide-chart-container">
                <canvas id="tide-chart-${nom.replace(/\s/g, '').replace(/'/g, '')}"></canvas>
            </div>
        </div>
    `;
    
    // Créer le graphique après un court délai
    setTimeout(() => createTideChart(plage), 100);
    
    return content;
}

function getTideInfo() {
    const now = selectedDateTime || currentDateTime;
    
    // Trouver les données de marée du jour
    const today = now.toISOString().split('T')[0];
    const todayTide = mareesData.find(m => m.date && m.date.startsWith(today));
    
    if (!todayTide) {
        // Fallback si pas de données
        return {
            arrow: '↗️',
            status: 'Montante',
            height: '3.5',
            max_high: '5.3',
            max_low: '0.9'
        };
    }
    
    const hour = now.getHours() + now.getMinutes() / 60;
    
    // Parser les heures de marée
    const parseHour = (timeStr) => {
        if (!timeStr) return null;
        const match = timeStr.match(/(\d+)h(\d+)/);
        if (match) {
            return parseInt(match[1]) + parseInt(match[2]) / 60;
        }
        return null;
    };
    
    const bm1 = parseHour(todayTide.bm1_heure || todayTide.bm1);
    const pm1 = parseHour(todayTide.pm1_heure || todayTide.pm1);
    const bm2 = parseHour(todayTide.bm2_heure || todayTide.bm2);
    const pm2 = parseHour(todayTide.pm2_heure || todayTide.pm2);
    
    const hauteurMax = parseFloat(todayTide.hauteur_max) || 5.3;
    
    // Déterminer si marée montante ou descendante
    let isRising = true;
    let currentHeight = hauteurMax / 2;
    
    if (bm1 && pm1) {
        if (hour < pm1) {
            isRising = true;
            currentHeight = 0.9 + ((hour - (bm1 || 0)) / (pm1 - (bm1 || 0))) * (hauteurMax - 0.9);
        } else if (bm2 && hour < bm2) {
            isRising = false;
            currentHeight = hauteurMax - ((hour - pm1) / (bm2 - pm1)) * (hauteurMax - 0.9);
        } else if (pm2 && hour < pm2) {
            isRising = true;
            currentHeight = 0.9 + ((hour - (bm2 || 12)) / (pm2 - (bm2 || 12))) * (hauteurMax - 0.9);
        } else {
            isRising = false;
            currentHeight = hauteurMax - ((hour - (pm2 || 18)) / 6) * (hauteurMax - 0.9);
        }
    }
    
    return {
        arrow: isRising ? '↗️' : '↘️',
        status: isRising ? 'Montante' : 'Descendante',
        height: Math.max(0.5, Math.min(hauteurMax, currentHeight)).toFixed(1),
        max_high: hauteurMax.toFixed(1),
        max_low: '0.9'
    };
}

function createTideChart(plage) {
    const canvasId = `tide-chart-${plage.nom.replace(/\s/g, '')}`;
    const canvas = document.getElementById(canvasId);
    
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Données du graphique (courbe sinusoïdale simplifiée)
    const labels = [];
    const data = [];
    
    for (let h = 0; h < 24; h += 2) {
        labels.push(`${h}h`);
        data.push(3 + Math.sin((h / 6) * Math.PI) * 2);
    }
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Hauteur (m)',
                data,
                borderColor: '#1e88e5',
                backgroundColor: 'rgba(30, 136, 229, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    min: 0,
                    max: 6,
                    ticks: { callback: value => value + 'm' }
                }
            }
        }
    });
}

// Utilitaires
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

// Service Worker (pour PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('Service Worker enregistré'))
        .catch(err => console.log('Erreur Service Worker:', err));
}
