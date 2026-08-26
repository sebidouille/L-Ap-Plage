// evenements.gs — Apps Script Web App pour L'Ap'Plage — Fonctionnalité Évènements
//
// ⚙️  CONFIGURATION — À remplir avant déploiement
// ─────────────────────────────────────────────────
const SPREADSHEET_ID = '168vuYnQBYwh3vx_g-pIIqEnUegJXeZOIZQ74VHBK-sA';
const ADMIN_EMAIL    = 'rouxseb56@gmail.com';
const ONGLET_EVENTS  = 'Evenements';
const ONGLET_BARS    = 'ou boire';
const ONGLET_RESTOS  = 'ou manger';
const CSS_           = '<style>body{font-family:sans-serif;padding:40px;max-width:600px;margin:auto;text-align:center;}</style>';
//
// ▶ DÉPLOIEMENT (une fois, ou à chaque modification)
//   Extensions → Apps Script → Déployer → Gérer les déploiements → Nouveau déploiement
//   Type : Application Web | Exécuter en tant que : Moi | Accès : Tout le monde
//   Copier l'URL générée → la coller dans evenements.html (constante SCRIPT_URL)
//
// ▶ INITIALISATION (une seule fois après déploiement)
//   1. Dans l'éditeur Apps Script : Paramètres du projet → Propriétés du script
//      Ajouter : MDP = <mot de passe initial au choix>
//   2. Exécuter installerTriggers() depuis l'éditeur
//   3. Créer manuellement le trigger onEdit :
//      Déclencheurs → + Ajouter un déclencheur → envoyerMdpNouvelEtablissement
//      Source : Depuis la feuille de calcul | Type : À la modification
// ─────────────────────────────────────────────────

// ── Entrées Web App ───────────────────────────────────────────────────────

function doPost(e) {
    try {
        const data   = JSON.parse(e.postData.contents);
        const action = data.action || '';

        if (action === 'verifierMdp') {
            const mdp      = PropertiesService.getScriptProperties().getProperty('MDP')       || '';
            const mdpAdmin = PropertiesService.getScriptProperties().getProperty('MDP_ADMIN') || '';
            const isAdmin  = mdpAdmin && data.motdepasse === mdpAdmin;
            const ok       = isAdmin || data.motdepasse === mdp;
            return jsonOut({ ok, isAdmin });
        }

        if (action === 'soumettreEvenement') {
            return soumettreEvenement(data);
        }

        if (action === 'modifierEvenement') {
            return modifierEvenement(data);
        }

        if (action === 'demanderSuppression') {
            return demanderSuppression(data);
        }

        return jsonOut({ error: 'Action inconnue' });

    } catch (err) {
        return jsonOut({ error: err.message });
    }
}

function doGet(e) {
    const action = (e.parameter.action || '');
    if (action === 'valider') {
        return validerEvenement(e.parameter.id, e.parameter.token);
    }
    if (action === 'supprimer') {
        return confirmerSuppression(e.parameter.id, e.parameter.token);
    }
    return HtmlService.createHtmlOutput(CSS_ + "<p>L'Ap'Plage — OK</p>");
}

// ── Soumission d'un évènement ─────────────────────────────────────────────

function soumettreEvenement(data) {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(ONGLET_EVENTS);
    if (!sheet) throw new Error("Onglet '" + ONGLET_EVENTS + "' introuvable");

    const id    = Utilities.getUuid();
    const token = Utilities.getUuid();

    // Upload affiche vers Drive (PDF ou image)
    let pdfUrl = '';
    if (data.affiche_base64) {
        const mime   = data.affiche_mime || 'application/pdf';
        const ext    = mime.startsWith('image/') ? '.' + mime.split('/')[1] : '.pdf';
        const bytes  = Utilities.base64Decode(data.affiche_base64);
        const blob   = Utilities.newBlob(bytes, mime, id + '_affiche' + ext);
        const folder = getOrCreateFolder();
        const file   = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        // Encode le type dans l'URL pour l'affichage côté client
        const fileType = mime.startsWith('image/') ? 'image' : 'pdf';
        pdfUrl = file.getUrl() + '#type=' + fileType;
    }

    // Écriture dans le Sheet
    sheet.appendRow([
        id,
        data.etablissement  || '',
        data.categorie      || '',
        data.date_evenement || '',
        data.horaire        || '',
        data.lieu           || '',
        data.nom_spectacle  || '',
        data.description    || '',
        pdfUrl,
        'en_attente',
        token,
        new Date().toISOString(),
        ''
    ]);

    // Email récapitulatif à l'administrateur
    const appUrl     = ScriptApp.getService().getUrl();
    const validerUrl = appUrl + '?action=valider&id=' + id + '&token=' + token;

    MailApp.sendEmail({
        to:      ADMIN_EMAIL,
        subject: 'app plage - Nouvel évènement à valider',
        body: [
            "Nouvel évènement soumis via L'Ap'Plage",
            '',
            'Établissement : ' + (data.etablissement  || '—'),
            'Catégorie     : ' + (data.categorie      || '—'),
            'Date          : ' + (data.date_evenement || '—'),
            'Horaire       : ' + (data.horaire        || '—'),
            'Lieu          : ' + (data.lieu           || 'adresse établissement'),
            'Spectacle     : ' + (data.nom_spectacle  || '—'),
            'Description   : ' + (data.description    || '—'),
            'Affiche PDF   : ' + (pdfUrl || 'aucune'),
            '',
            '→ Valider cet évènement :',
            validerUrl
        ].join('\n')
    });

    return jsonOut({ ok: true });
}

// ── Modification d'un évènement ───────────────────────────────────────────

function modifierEvenement(data) {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet  = ss.getSheetByName(ONGLET_EVENTS);
    const values = sheet.getDataRange().getValues();
    const hdr    = values[0];

    const colId     = hdr.indexOf('id_evenement');
    const colEtab   = hdr.indexOf('etablissement');
    const colCat    = hdr.indexOf('categorie');
    const colDate   = hdr.indexOf('date_evenement');
    const colHor    = hdr.indexOf('horaire');
    const colLieu   = hdr.indexOf('lieu');
    const colSpect  = hdr.indexOf('nom_spectacle');
    const colDesc   = hdr.indexOf('description');
    const colPdf    = hdr.indexOf('affiche_pdf_url');
    const colStatut = hdr.indexOf('statut');
    const colToken  = hdr.indexOf('token_validation');

    for (let i = 1; i < values.length; i++) {
        if (values[i][colId] !== data.id_evenement) continue;

        const row      = i + 1;
        const newToken = Utilities.getUuid();

        // Upload nouvelle affiche si fournie, sinon conserver l'existante
        let pdfUrl = values[i][colPdf];
        if (data.affiche_base64) {
            const mime   = data.affiche_mime || 'application/pdf';
            const ext    = mime.startsWith('image/') ? '.' + mime.split('/')[1] : '.pdf';
            const bytes  = Utilities.base64Decode(data.affiche_base64);
            const blob   = Utilities.newBlob(bytes, mime, data.id_evenement + '_affiche' + ext);
            const folder = getOrCreateFolder();
            const file   = folder.createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            const fileType = mime.startsWith('image/') ? 'image' : 'pdf';
            pdfUrl = file.getUrl() + '#type=' + fileType;
        }

        sheet.getRange(row, colEtab  + 1).setValue(data.etablissement  || values[i][colEtab]);
        sheet.getRange(row, colCat   + 1).setValue(data.categorie      || values[i][colCat]);
        sheet.getRange(row, colDate  + 1).setValue(data.date_evenement || values[i][colDate]);
        sheet.getRange(row, colHor   + 1).setValue(data.horaire        || '');
        sheet.getRange(row, colLieu  + 1).setValue(data.lieu           || '');
        sheet.getRange(row, colSpect + 1).setValue(data.nom_spectacle  || values[i][colSpect]);
        sheet.getRange(row, colDesc  + 1).setValue(data.description    || '');
        sheet.getRange(row, colPdf   + 1).setValue(pdfUrl);
        sheet.getRange(row, colStatut + 1).setValue('en_attente');   // Re-validation requise
        sheet.getRange(row, colToken  + 1).setValue(newToken);

        // Email de re-validation à l'administrateur
        const appUrl     = ScriptApp.getService().getUrl();
        const validerUrl = appUrl + '?action=valider&id=' + data.id_evenement + '&token=' + newToken;

        MailApp.sendEmail({
            to:      ADMIN_EMAIL,
            subject: 'app plage - Évènement modifié, à re-valider',
            body: [
                "Un évènement a été modifié sur L'Ap'Plage",
                '',
                'Établissement : ' + (data.etablissement  || ''),
                'Date          : ' + (data.date_evenement || ''),
                'Spectacle     : ' + (data.nom_spectacle  || ''),
                '',
                '→ Valider la version modifiée :',
                validerUrl
            ].join('\n')
        });

        return jsonOut({ ok: true });
    }

    return jsonOut({ error: 'Évènement introuvable' });
}

// ── Demande de suppression ────────────────────────────────────────────────

function demanderSuppression(data) {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet  = ss.getSheetByName(ONGLET_EVENTS);
    const values = sheet.getDataRange().getValues();
    const hdr    = values[0];

    const colId     = hdr.indexOf('id_evenement');
    const colStatut = hdr.indexOf('statut');
    const colToken  = hdr.indexOf('token_validation');
    const colEtab   = hdr.indexOf('etablissement');
    const colSpect  = hdr.indexOf('nom_spectacle');

    for (let i = 1; i < values.length; i++) {
        if (values[i][colId] !== data.id_evenement) continue;

        const newToken = Utilities.getUuid();
        const row = i + 1;
        sheet.getRange(row, colStatut + 1).setValue('en_attente_suppression');
        sheet.getRange(row, colToken  + 1).setValue(newToken);

        const appUrl       = ScriptApp.getService().getUrl();
        const supprimerUrl = appUrl + '?action=supprimer&id=' + data.id_evenement + '&token=' + newToken;

        MailApp.sendEmail({
            to:      ADMIN_EMAIL,
            subject: "app plage - Demande de suppression d'évènement",
            body: [
                "Une demande de suppression d'évènement a été reçue sur L'Ap'Plage.",
                '',
                'Établissement : ' + values[i][colEtab],
                'Spectacle     : ' + values[i][colSpect],
                '',
                "→ Confirmer la suppression :",
                supprimerUrl
            ].join('\n')
        });

        return jsonOut({ ok: true });
    }

    return jsonOut({ error: 'Évènement introuvable' });
}

function confirmerSuppression(id, token) {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet  = ss.getSheetByName(ONGLET_EVENTS);
    const values = sheet.getDataRange().getValues();
    const hdr    = values[0];

    const colId     = hdr.indexOf('id_evenement');
    const colToken  = hdr.indexOf('token_validation');
    const colStatut = hdr.indexOf('statut');
    const colSpect  = hdr.indexOf('nom_spectacle');
    const colEtab   = hdr.indexOf('etablissement');

    for (let i = 1; i < values.length; i++) {
        if (values[i][colId] !== id || values[i][colToken] !== token) continue;

        if (values[i][colStatut] !== 'en_attente_suppression') {
            return HtmlService.createHtmlOutput(
                CSS_ + "<h2>ℹ️ Ce lien de suppression n'est plus valide.</h2>");
        }

        const spectacle = values[i][colSpect];
        const etab      = values[i][colEtab];
        sheet.deleteRow(i + 1);

        return HtmlService.createHtmlOutput(
            CSS_ +
            '<h2>🗑️ Évènement supprimé.</h2>' +
            '<p><strong>' + spectacle + '</strong> — ' + etab + '</p>');
    }

    return HtmlService.createHtmlOutput(
        CSS_ + '<h2>❌ Lien invalide ou évènement introuvable.</h2>');
}

// ── Validation admin (lien email) ─────────────────────────────────────────

function validerEvenement(id, token) {
    const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet   = ss.getSheetByName(ONGLET_EVENTS);
    const values  = sheet.getDataRange().getValues();
    const hdr     = values[0];

    const colId      = hdr.indexOf('id_evenement');
    const colToken   = hdr.indexOf('token_validation');
    const colStatut  = hdr.indexOf('statut');
    const colDateV   = hdr.indexOf('date_validation');
    const colSpect   = hdr.indexOf('nom_spectacle');
    const colEtab    = hdr.indexOf('etablissement');

    for (let i = 1; i < values.length; i++) {
        if (values[i][colId] !== id || values[i][colToken] !== token) continue;

        if (values[i][colStatut] === 'valide') {
            return HtmlService.createHtmlOutput(
                CSS_ + '<h2>ℹ️ Cet évènement est déjà validé.</h2>');
        }
        sheet.getRange(i + 1, colStatut + 1).setValue('valide');
        sheet.getRange(i + 1, colDateV  + 1).setValue(new Date().toISOString());
        return HtmlService.createHtmlOutput(
            CSS_ +
            '<h2>✅ Évènement validé !</h2>' +
            '<p><strong>' + values[i][colSpect] + '</strong>' +
            ' — ' + values[i][colEtab] + '</p>');
    }

    return HtmlService.createHtmlOutput(
        CSS_ + '<h2>❌ Lien invalide ou évènement introuvable.</h2>');
}

// ── Envoi du MDP aux nouveaux établissements (trigger onEdit) ─────────────

function envoyerMdpNouvelEtablissement(e) {
    if (!e || !e.range) return;
    const sheet     = e.range.getSheet();
    const sheetName = sheet.getName();
    if (sheetName !== ONGLET_BARS && sheetName !== ONGLET_RESTOS) return;

    const row = e.range.getRow();
    if (row < 2) return;

    // Ne déclencher que si la valeur passe À '1'
    if (String(e.value) !== '1' || String(e.oldValue) === '1') return;

    const hdr      = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const emailCol = hdr.findIndex(h => h.toLowerCase() === 'email') + 1;
    const nomCol   = hdr.findIndex(h => h === 'Nom') + 1;
    if (emailCol < 1) return;

    const email = sheet.getRange(row, emailCol).getValue();
    const nom   = sheet.getRange(row, nomCol  ).getValue();
    if (!email) return;

    const mdp = PropertiesService.getScriptProperties().getProperty('MDP') || '';
    MailApp.sendEmail({
        to:      email,
        subject: "L'Ap'Plage – Accès création d'évènements",
        body: [
            'Bonjour ' + nom + ',',
            '',
            "Votre établissement vient d'être validé sur L'Ap'Plage.",
            "Vous pouvez désormais créer des évènements. Mot de passe d'accès :",
            '',
            '  ' + mdp,
            '',
            "Cordialement,\nL'équipe L'Ap'Plage"
        ].join('\n')
    });
}

// ── Vérification quotidienne (trigger time-based) ─────────────────────────

function verificationQuotidienne() {
    const auj  = new Date();
    const mois = auj.getMonth();   // 0 = janvier
    const jour = auj.getDate();

    if (mois === 0 && jour === 8)  envoyerRappelProprietaire(7);
    if (mois === 0 && jour === 14) envoyerRappelProprietaire(1);
    if (mois === 0 && jour === 15) roulerMotDePasse();
}

function roulerMotDePasse() {
    // Charset sans ambiguïtés (0/O, 1/I/l exclus)
    const charset = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789';
    let mdp = '';
    for (let i = 0; i < 8; i++) {
        mdp += charset[Math.floor(Math.random() * charset.length)];
    }
    PropertiesService.getScriptProperties().setProperty('MDP', mdp);

    // Diffuser aux établissements validés
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    [ONGLET_BARS, ONGLET_RESTOS].forEach(nomOnglet => {
        const sh = ss.getSheetByName(nomOnglet);
        if (!sh) return;
        const vals  = sh.getDataRange().getValues();
        const hdr   = vals[0];
        const cVal  = hdr.findIndex(h => h === 'Validé' || h === 'Valide');
        const cMail = hdr.findIndex(h => h.toLowerCase() === 'email');
        const cNom  = hdr.findIndex(h => h === 'Nom');

        for (let i = 1; i < vals.length; i++) {
            if (String(vals[i][cVal]) === '1' && vals[i][cMail]) {
                MailApp.sendEmail({
                    to:      vals[i][cMail],
                    subject: "L'Ap'Plage – Nouveau mot de passe évènements",
                    body: [
                        'Bonjour ' + vals[i][cNom] + ',',
                        '',
                        "Le mot de passe pour créer des évènements sur L'Ap'Plage a été renouvelé :",
                        '',
                        '  ' + mdp,
                        '',
                        "Cordialement,\nL'équipe L'Ap'Plage"
                    ].join('\n')
                });
            }
        }
    });

    envoyerRappelProprietaire(0);   // Notifier l'admin
}

function envoyerRappelProprietaire(joursAvant) {
    const mdp = PropertiesService.getScriptProperties().getProperty('MDP') || '';
    let subject, body;

    if (joursAvant === 0) {
        subject = "L'Ap'Plage – Mot de passe évènements renouvelé";
        body    = 'Le mot de passe évènements a été renouvelé.\n\nNouveau mot de passe : ' + mdp;
    } else {
        subject = "L'Ap'Plage – Mot de passe change dans " + joursAvant + ' jour(s)';
        body    = 'Le mot de passe évènements changera dans ' + joursAvant + ' jour(s) (le 15 janvier).';
    }
    MailApp.sendEmail({ to: ADMIN_EMAIL, subject, body });
}

// ── Installation des triggers (à lancer une seule fois) ───────────────────

function installerTriggers() {
    // Éviter les doublons
    ScriptApp.getProjectTriggers().forEach(t => {
        if (t.getHandlerFunction() === 'verificationQuotidienne') {
            ScriptApp.deleteTrigger(t);
        }
    });

    ScriptApp.newTrigger('verificationQuotidienne')
        .timeBased()
        .everyDays(1)
        .atHour(8)
        .create();

    Logger.log('✅ Trigger quotidien installé (verificationQuotidienne à 8h).');
    Logger.log('⚠️  Créer manuellement le trigger onEdit pour envoyerMdpNouvelEtablissement :');
    Logger.log('   Déclencheurs → + → envoyerMdpNouvelEtablissement | Source : feuille de calcul | Type : À la modification');
}

// ── Utilitaires ───────────────────────────────────────────────────────────

function getOrCreateFolder() {
    const name    = 'Ap-Plage-Evenements';
    const folders = DriveApp.getFoldersByName(name);
    return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function jsonOut(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

