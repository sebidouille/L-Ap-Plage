// ============================================
// TURBIDITÉ — proxy score + votes utilisateurs
// ============================================

// URL du Apps Script (à renseigner après déploiement)
const TURBIDITE_GS_URL = '';

// ============================================
// SCORE PROXY
// ============================================

function pluie24h(now) {
    const t0  = now.getTime();
    const t24 = t0 - 24 * 3600 * 1000;
    let cumul = 0;
    meteoData.forEach(row => {
        const t = new Date(row.timestamp).getTime();
        if (t >= t24 && t <= t0) cumul += row.precipitation ?? 0;
    });
    return cumul;
}

function angularDiff(a, b) {
    let diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
}

function scoreTurbidite(plage, now) {
    const meteo = getMeteoAtDate(now);
    if (!meteo) return null;

    const orientRef = parseFloat(plage['Orientation houle idéale']) || null;

    // --- Houle (poids 0.5) ---
    const hauteur  = meteo.hauteur_vagues ?? 0;
    const dirHoule = meteo.direction_vagues ?? 0;
    let scoreH = Math.min(1, Math.max(0, (hauteur - 0.2) / 1.3));
    if (orientRef !== null) {
        const diff = angularDiff(dirHoule, orientRef);
        scoreH *= diff >= 90 ? 0 : Math.cos(diff * Math.PI / 180);
    }

    // --- Pluie cumulée 24h (poids 0.3) ---
    const cumPluie = pluie24h(now);
    const scoreP   = Math.min(1, Math.max(0, cumPluie / 20));

    // --- Vent onshore (poids 0.2) ---
    const forceVent = meteo.force_vent_kmh ?? 0;
    const dirVent   = meteo.direction_vent ?? 0;
    let scoreV = 0;
    if (orientRef !== null) {
        const diff    = angularDiff(dirVent, orientRef);
        const onshore = Math.max(0, Math.cos(diff * Math.PI / 180));
        scoreV = Math.min(1, Math.max(0, (forceVent * onshore - 10) / 30));
    } else {
        scoreV = Math.min(1, Math.max(0, (forceVent - 10) / 30));
    }

    const score = scoreH * 0.5 + scoreP * 0.3 + scoreV * 0.2;

    // --- Confiance ---
    const confiance = Math.abs(scoreH - 0.5) * 2 * 0.5
                    + Math.abs(scoreP - 0.5) * 2 * 0.3
                    + Math.abs(scoreV - 0.5) * 2 * 0.2;

    return { score, confiance };
}

function categorieScore(score) {
    if (score < 0.33) return { label: 'Limpide', emoji: '🟦', cls: 'turb-claire'  };
    if (score < 0.66) return { label: 'Trouble',  emoji: '🟨', cls: 'turb-moyenne' };
    return               { label: 'Pas envie',    emoji: '🟫', cls: 'turb-trouble' };
}

// ============================================
// VOTES
// ============================================

function plageId(nom) {
    return nom.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getVoteLocal(id) {
    const v = localStorage.getItem(`turb_vote_${id}`);
    return v ? JSON.parse(v) : null;
}

function setVoteLocal(id, valeur) {
    localStorage.setItem(`turb_vote_${id}`, JSON.stringify({ valeur, ts: Date.now() }));
}

function peutVoter(id) {
    const v = getVoteLocal(id);
    return !v || (Date.now() - v.ts) > 3 * 3600 * 1000;
}

async function fetchVotes(id) {
    if (!TURBIDITE_GS_URL) return null;
    try {
        const r = await fetch(`${TURBIDITE_GS_URL}?action=votes&plage=${encodeURIComponent(id)}`);
        return await r.json();
    } catch { return null; }
}

async function posterVote(id, valeur) {
    if (!TURBIDITE_GS_URL) return;
    try {
        await fetch(TURBIDITE_GS_URL, {
            method: 'POST',
            body: JSON.stringify({ plage: id, valeur }),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch { /* silencieux */ }
}

function scoreFusion(proxy, votes) {
    if (!votes || votes.nb_votes_recents < 5)
        return { score: proxy.score, source: 'auto' };
    const mv = votes.moyenne_votes;
    if (votes.nb_votes_recents >= 10 && Math.abs(mv - proxy.score) >= 0.3)
        return { score: mv, source: 'communaute' };
    if (votes.nb_votes_recents >= 10)
        return { score: mv, source: 'confirme' };
    return { score: 0.6 * proxy.score + 0.4 * mv, source: 'mixte' };
}

// ============================================
// RENDU
// ============================================

window.renderTurbidite = async function(plage, container) {
    const now   = getDisplayDate();
    const proxy = scoreTurbidite(plage, now);
    if (!proxy) { container.innerHTML = ''; return; }

    const id    = plageId(plage.Nom || plage.nom || '');
    const votes = await fetchVotes(id);
    const fusion = scoreFusion(proxy, votes);
    const cat   = categorieScore(fusion.score);
    const pct   = Math.round(proxy.confiance * 100);

    const badges = {
        auto:       '<span class="turb-badge turb-badge-auto">estimation auto</span>',
        mixte:      '<span class="turb-badge turb-badge-auto">auto + avis</span>',
        confirme:   '<span class="turb-badge turb-badge-comm">confirmé terrain</span>',
        communaute: '<span class="turb-badge turb-badge-comm">signalé par les utilisateurs</span>',
    };

    const deja     = !peutVoter(id);
    const voteLocal = getVoteLocal(id);

    const btnCls = (val) => {
        if (!deja) return 'turb-btn';
        return (voteLocal && voteLocal.valeur === val) ? 'turb-btn turb-btn-voted' : 'turb-btn turb-btn-off';
    };

    const nbVotesHtml = (votes && votes.nb_votes_recents > 0)
        ? `<div class="turb-nb-votes">${votes.nb_votes_recents} avis récent${votes.nb_votes_recents > 1 ? 's' : ''}</div>`
        : '';

    container.innerHTML = `
        <div class="turb-section">
            <div class="turb-header">
                <strong>Clarté de l'eau</strong>${badges[fusion.source] || ''}
            </div>
            <div class="turb-result ${cat.cls}">
                ${cat.emoji} ${cat.label}
                <span class="turb-conf">· confiance ${pct}%</span>
            </div>
            <div class="turb-votes-label">Vous l'avez vue ?</div>
            <div class="turb-vote-btns">
                <button class="${btnCls(0)}"   data-val="0">🟦 Limpide</button>
                <button class="${btnCls(0.5)}" data-val="0.5">🟨 Trouble</button>
                <button class="${btnCls(1)}"   data-val="1">🟫 Pas envie</button>
            </div>
            ${nbVotesHtml}
        </div>`;

    if (!deja) {
        container.querySelectorAll('.turb-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const valeur = parseFloat(this.dataset.val);
                setVoteLocal(id, valeur);
                await posterVote(id, valeur);
                window.renderTurbidite(plage, container);
            });
        });
    }
};
