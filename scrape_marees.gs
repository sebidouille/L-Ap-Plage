/**
 * SCRAPING DES MARÉES — Île de Groix (Port-Tudy)
 * Source : maree.info/98
 *
 * INSTALLATION :
 *   1. Dans votre Google Sheet, aller dans Extensions > Apps Script
 *   2. Coller ce code dans l'éditeur, remplacer le contenu existant
 *   3. Exécuter scrapeMareesGroix() une première fois
 *   4. Exécuter createWeeklyTrigger() pour automatiser chaque semaine
 */

var PORT_ID   = 98;       // maree.info/98 = Île de Groix (Port-Tudy)
var SHEET_NAME = 'MAREES'; // Nom de l'onglet dans le Google Sheet
var NB_PAGES  = 7;        // 7 pages × 7 jours = 49 jours de données


// ============================================================
// FONCTION PRINCIPALE
// ============================================================
function scrapeMareesGroix() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('Onglet "' + SHEET_NAME + '" introuvable dans le Google Sheet.');
  }

  var allRows     = [];
  var nextStart   = new Date(); // Commence aujourd'hui

  for (var page = 0; page < NB_PAGES; page++) {
    var dateStr = Utilities.formatDate(nextStart, 'Europe/Paris', 'yyyyMMdd');
    var url     = 'https://maree.info/' + PORT_ID + '?d=' + dateStr + '0';

    Logger.log('Page ' + (page + 1) + '/' + NB_PAGES + ' → ' + url);

    try {
      var response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      if (response.getResponseCode() !== 200) {
        Logger.log('HTTP ' + response.getResponseCode() + ' pour ' + url);
        continue;
      }

      var html = response.getContentText();

      // --- Extraire les dates depuis var Marees = {'Dates': [...]} ---
      var datesMatch = html.match(/'Dates'\s*:\s*\[([0-9,]+)\]/);
      if (!datesMatch) {
        Logger.log('Dates non trouvées sur la page ' + (page + 1));
        continue;
      }
      var dates = datesMatch[1].split(',');

      // --- Extraire chaque ligne <tr class="MJ ..."> de la table ---
      var rowRegex   = /<tr class="MJ [^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
      var rowMatch;
      var rowIndex   = 0;

      while ((rowMatch = rowRegex.exec(html)) !== null) {
        if (rowIndex >= dates.length) break;

        var rowHtml    = rowMatch[1];
        var dateRaw    = dates[rowIndex]; // ex: "20260717"

        var dateFormatted = dateRaw.substring(0, 4) + '-'
                          + dateRaw.substring(4, 6) + '-'
                          + dateRaw.substring(6, 8);

        // Extraire les <td> (3 colonnes : heures, hauteurs, coefficients)
        var tdRegex    = /<td>([\s\S]*?)<\/td>/g;
        var tds        = [];
        var tdMatch;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
          tds.push(tdMatch[1]);
        }

        if (tds.length < 2) { rowIndex++; continue; }

        // --- Colonne 1 : heures (BM, PM, BM, PM) ---
        var times = tds[0].match(/\d{2}h\d{2}/g) || [];

        var bm1 = times[0] || '';
        var pm1 = times[1] || '';
        var bm2 = times[2] || '';
        var pm2 = times[3] || '';

        if (!bm1 || !pm1) { rowIndex++; continue; } // Ligne invalide

        // --- Colonne 2 : hauteurs (BM, PM, BM, PM) ---
        var heights = tds[1].match(/\d+,\d+(?=m)/g) || [];

        // La hauteur_max est le max des pleines mers (index 1 et 3)
        var hPm1   = heights[1] ? parseFloat(heights[1].replace(',', '.')) : 0;
        var hPm2   = heights[3] ? parseFloat(heights[3].replace(',', '.')) : 0;
        var hMax   = Math.max(hPm1, hPm2);
        var hMaxStr = hMax > 0 ? hMax.toFixed(2).replace('.', ',') : '';

        allRows.push([dateFormatted, bm1, pm1, bm2, pm2, hMaxStr]);
        Logger.log(dateFormatted + ' BM=' + bm1 + '/' + bm2 + ' PM=' + pm1 + '/' + pm2 + ' max=' + hMaxStr + 'm');

        rowIndex++;
      }

      // --- Date de début de la prochaine page = dernier jour + 1 ---
      var lastDateRaw = dates[dates.length - 1];
      nextStart = new Date(
        parseInt(lastDateRaw.substring(0, 4)),
        parseInt(lastDateRaw.substring(4, 6)) - 1,
        parseInt(lastDateRaw.substring(6, 8)) + 1
      );

      // Pause entre les requêtes pour ne pas surcharger le serveur
      if (page < NB_PAGES - 1) Utilities.sleep(1500);

    } catch (e) {
      Logger.log('Erreur page ' + (page + 1) + ' : ' + e.toString());
    }
  }

  // --------------------------------------------------------
  // Écriture dans la feuille MAREES
  // --------------------------------------------------------
  if (allRows.length === 0) {
    Logger.log('Aucune donnée récupérée — vérifiez les logs ci-dessus.');
    return;
  }

  sheet.clearContents();

  var headers = [['date', 'bm1_heure', 'pm1_heure', 'bm2_heure', 'pm2_heure', 'hauteur_max']];
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  sheet.getRange(2, 1, allRows.length, allRows[0].length).setValues(allRows);

  var msg = allRows.length + ' jours de marées importés depuis maree.info';
  Logger.log('✅ ' + msg);
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Import marées', 5);
}


// ============================================================
// DÉCLENCHEUR AUTOMATIQUE HEBDOMADAIRE
// ============================================================
function createWeeklyTrigger() {
  // Supprimer les anciens déclencheurs de cette fonction
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'scrapeMareesGroix') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Déclencher chaque lundi à 6h du matin
  ScriptApp.newTrigger('scrapeMareesGroix')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();

  Logger.log('✅ Déclencheur créé : scrapeMareesGroix() tous les lundis à 6h');
}
