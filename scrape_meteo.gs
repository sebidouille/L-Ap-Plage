/**
 * SCRAPING MÉTÉO MARINE — Île de Groix
 * Sources :
 *   - Open-Meteo Forecast API  → vent (force, direction, rafales)
 *   - Open-Meteo Marine API    → vagues (hauteur, direction, période)
 *
 * INSTALLATION :
 *   1. Dans votre Google Sheet, aller dans Extensions > Apps Script
 *   2. Ajouter un nouveau fichier (.gs) et coller ce code
 *   3. Exécuter scrapeMeteoGroix() une première fois
 *   4. Exécuter createMeteoTrigger() pour automatiser toutes les 6h
 */

var LAT        = 47.6389;
var LON        = -3.4523;
var TIMEZONE   = 'Europe/Paris';
var FORECAST_DAYS = 7;          // jours de prévision (max 16)
var SHEET_NAME = 'METEO';


// ============================================================
// FONCTION PRINCIPALE
// ============================================================
function scrapeMeteoGroix() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Onglet "' + SHEET_NAME + '" introuvable dans le Google Sheet.');
  }

  // --- Requête 1 : données atmosphériques (vent) ---
  var urlVent = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude='       + LAT
    + '&longitude='      + LON
    + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m'
    + '&wind_speed_unit=kmh'
    + '&timezone='       + encodeURIComponent(TIMEZONE)
    + '&forecast_days='  + FORECAST_DAYS;

  // --- Requête 2 : données marines (vagues) ---
  var urlMarine = 'https://marine-api.open-meteo.com/v1/marine'
    + '?latitude='       + LAT
    + '&longitude='      + LON
    + '&hourly=wave_height,wave_direction,wave_period'
    + '&timezone='       + encodeURIComponent(TIMEZONE)
    + '&forecast_days='  + FORECAST_DAYS;

  Logger.log('Récupération vent  : ' + urlVent);
  Logger.log('Récupération marine: ' + urlMarine);

  try {
    // Requêtes en parallèle
    var responses = UrlFetchApp.fetchAll([
      { url: urlVent,   muteHttpExceptions: true },
      { url: urlMarine, muteHttpExceptions: true }
    ]);

    var rVent   = responses[0];
    var rMarine = responses[1];

    if (rVent.getResponseCode() !== 200) {
      throw new Error('Erreur API vent : HTTP ' + rVent.getResponseCode());
    }
    if (rMarine.getResponseCode() !== 200) {
      throw new Error('Erreur API marine : HTTP ' + rMarine.getResponseCode());
    }

    var dataVent   = JSON.parse(rVent.getContentText()).hourly;
    var dataMarine = JSON.parse(rMarine.getContentText()).hourly;

    // --- Fusionner les deux jeux de données par timestamp ---
    var times = dataVent.time; // tableau ISO "2026-07-18T00:00"
    var rows  = [];

    for (var i = 0; i < times.length; i++) {
      var ts            = times[i];
      var forceVent     = dataVent.wind_speed_10m[i];
      var dirVent       = dataVent.wind_direction_10m[i];
      var rafales       = dataVent.wind_gusts_10m[i];
      var hauteurVagues = dataMarine.wave_height[i]    !== null ? dataMarine.wave_height[i]    : '';
      var dirVagues     = dataMarine.wave_direction[i] !== null ? dataMarine.wave_direction[i] : '';
      var periodeVagues = dataMarine.wave_period[i]   !== null ? dataMarine.wave_period[i]   : '';

      rows.push([
        ts,
        forceVent  !== null ? String(forceVent).replace('.', ',')  : '',
        dirVent    !== null ? String(dirVent)                       : '',
        rafales    !== null ? String(rafales).replace('.', ',')     : '',
        hauteurVagues !== '' ? String(hauteurVagues).replace('.', ',') : '',
        dirVagues  !== '' ? String(dirVagues)                       : '',
        periodeVagues !== '' ? String(periodeVagues).replace('.', ',') : ''
      ]);
    }

    if (rows.length === 0) {
      Logger.log('Aucune donnée reçue.');
      return;
    }

    // --- Écriture dans la feuille METEO ---
    sheet.clearContents();

    var headers = [[
      'timestamp',
      'force_vent_kmh',
      'direction_vent',
      'rafales_kmh',
      'hauteur_vagues',
      'direction_vagues',
      'periode_vagues'
    ]];
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

    var msg = rows.length + ' heures de météo marine importées (' + FORECAST_DAYS + ' jours)';
    Logger.log('✅ ' + msg);
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Import météo', 5);

  } catch (e) {
    Logger.log('Erreur : ' + e.toString());
    throw e;
  }
}


// ============================================================
// DÉCLENCHEUR AUTOMATIQUE TOUTES LES 6H
// ============================================================
function createMeteoTrigger() {
  // Supprimer les anciens déclencheurs de cette fonction
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'scrapeMeteoGroix') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Déclencher toutes les 6 heures (météo se périme vite)
  ScriptApp.newTrigger('scrapeMeteoGroix')
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log('✅ Déclencheur créé : scrapeMeteoGroix() toutes les 6h');
}
