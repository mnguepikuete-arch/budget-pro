/**
 * FICHIER : app.js
 * RÔLE    : Logique principale du tableau de bord Budget Pro
 *
 * SOMMAIRE DES SECTIONS :
 *   A. Configuration & constantes
 *   B. Enregistrement du Service Worker (PWA)
 *   C. Vérification d'authentification
 *   D. Initialisation de l'interface
 *   E. Fonctions de récupération des données (API)
 *   F. Affichage de la liste des dépenses
 *   G. Gestion des graphiques (Chart.js)
 *   H. File d'attente hors ligne (offline queue)
 *   I. Gestion des formulaires et événements
 *   J. Utilitaires
 */

'use strict'; // Mode strict : aide à trouver les bugs

// ════════════════════════════════════════════════════════════════
// A. CONFIGURATION & CONSTANTES
// ════════════════════════════════════════════════════════════════

const API = {
    auth:     'api/auth.php',
    expenses: 'api/expenses.php',
    stats:    'api/stats.php',
};

// Couleurs pour les catégories (cohérent avec style.css)
const CAT_COLORS = {
    'Alimentation': '#e74c3c',
    'Transport':    '#3498db',
    'Loisirs':      '#9b59b6',
    'Santé':        '#2ecc71',
};

// Noms lisibles pour chaque type de graphique
const CHART_LABELS = {
    bar_h:     'Barres (catégories)',
    pie:       'Camembert',
    doughnut:  'Anneau',
    line:      'Courbe (évolution)',
    bar_month: 'Barres (par mois)',
};

// Instance Chart.js courante (une seule à la fois)
let currentChart = null;

// ════════════════════════════════════════════════════════════════
// B. ENREGISTREMENT DU SERVICE WORKER (PWA)
// ════════════════════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => {
            console.log('[App] Service Worker prêt, scope :', reg.scope);

            // Écouter les messages du Service Worker (ex: sync required)
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data.type === 'SYNC_REQUIRED') {
                    console.log('[App] Synchronisation demandée par le SW');
                    syncOfflineQueue(); // Tenter de synchroniser la file d'attente
                }
            });
        })
        .catch(err => console.warn('[App] Erreur SW :', err));
}

// ════════════════════════════════════════════════════════════════
// C. VÉRIFICATION D'AUTHENTIFICATION
// ════════════════════════════════════════════════════════════════

/**
 * checkAuth() : Vérifie si l'utilisateur est connecté.
 * Si non, redirige vers la page de connexion.
 * Appelé dès le chargement de la page.
 */
async function checkAuth() {
    try {
        const response = await fetch(`${API.auth}?action=check`);
        const data     = await response.json();

        if (!data.loggedIn) {
            window.location.href = 'login.html';
            return;
        }

        // Afficher le nom d'utilisateur dans la navigation
        const usernameEl = document.getElementById('nav-username');
        if (usernameEl) usernameEl.textContent = `👤 ${data.username}`;

        // Initialiser l'application maintenant qu'on est sûr d'être connecté
        initApp();

    } catch (err) {
        console.warn('[App] Vérification auth échouée (hors ligne ?) :', err);
        // En mode hors ligne, on laisse l'utilisateur accéder à l'appli
        // (les données viendront du cache du Service Worker)
        const savedUsername = localStorage.getItem('bp_username') || 'Utilisateur';
        const usernameEl    = document.getElementById('nav-username');
        if (usernameEl) usernameEl.textContent = `👤 ${savedUsername}`;
        initApp();
    }
}

// ── Fonction de déconnexion ──────────────────────────────────
async function logout() {
    try {
        await fetch(`${API.auth}?action=logout`, { method: 'POST' });
    } catch (err) {
        // Même si la requête échoue (hors ligne), on redirige quand même
    }
    localStorage.removeItem('bp_username');
    window.location.href = 'login.html';
}

// ════════════════════════════════════════════════════════════════
// D. INITIALISATION DE L'INTERFACE
// ════════════════════════════════════════════════════════════════

/**
 * initApp() : Configure l'interface une fois l'auth vérifiée.
 * - Pré-sélectionne la date du jour dans le formulaire
 * - Génère les options d'heures (0h - 23h)
 * - Charge les dépenses initiales
 * - Surveille la connectivité réseau
 */
function initApp() {
    // ── Pré-remplir la date avec aujourd'hui ──────────────────
    const dateInput = document.getElementById('expense-date');
    if (dateInput) {
        dateInput.value = getTodayString(); // Format YYYY-MM-DD
    }

    // ── Générer les options d'heures (0 à 23) ─────────────────
    const hourSelect = document.getElementById('expense-hour');
    if (hourSelect) {
        for (let h = 0; h < 24; h++) {
            const option  = document.createElement('option');
            option.value  = h;
            option.textContent = `${String(h).padStart(2, '0')}h`; // "08h", "14h"...
            hourSelect.appendChild(option);
        }
        // Pré-sélectionner l'heure actuelle
        hourSelect.value = new Date().getHours();
    }

    // ── Surveiller la connectivité ─────────────────────────────
    window.addEventListener('online', () => {
        updateOnlineBanner(true);
        syncOfflineQueue(); // Synchroniser les dépenses en attente
    });
    window.addEventListener('offline', () => updateOnlineBanner(false));
    updateOnlineBanner(navigator.onLine); // État initial

    // ── Premier chargement des données ────────────────────────
    applyFilters();
}

// ════════════════════════════════════════════════════════════════
// E. RÉCUPÉRATION DES DONNÉES (API)
// ════════════════════════════════════════════════════════════════

/**
 * applyFilters() : Lit les filtres sélectionnés et charge les données.
 * Appelée à chaque changement de filtre et au chargement initial.
 */
async function applyFilters() {
    const period   = document.getElementById('filter-period').value;
    const category = document.getElementById('filter-category').value;

    showLoading(true);

    try {
        // Charger les dépenses et les stats en parallèle (plus rapide)
        const [expenses, chartData] = await Promise.all([
            fetchExpenses(period, category),
            fetchStats(period),
        ]);

        renderExpenses(expenses.expenses, expenses.total);
        updateChart(chartData);

    } catch (err) {
        console.error('[App] Erreur chargement :', err);
        showFormMessage('form-error', '⚠️ Impossible de charger les données.', true);
    } finally {
        showLoading(false);
    }
}

/**
 * fetchExpenses(period, category) : Appelle l'API pour récupérer les dépenses.
 * @param {string} period   - 'all'|'week'|'month'|'year'
 * @param {string} category - Nom de la catégorie ou 'Toutes'
 * @returns {Promise<object>} - { expenses: [], total: number }
 */
async function fetchExpenses(period, category) {
    const url = `${API.expenses}?period=${encodeURIComponent(period)}&category=${encodeURIComponent(category)}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (!data.success) throw new Error(data.message);
    return data;
}

/**
 * fetchStats(period) : Appelle l'API stats selon le type de graphique sélectionné.
 * @param {string} period - Période actuelle
 * @returns {Promise<object>} - Données pour Chart.js
 */
async function fetchStats(period) {
    const chartType = document.getElementById('chart-type').value;

    // Mapping type de graphique → endpoint de stats
    let statsType;
    if (chartType === 'line')     statsType = 'by_day';
    else if (chartType === 'bar_month') statsType = 'by_month';
    else                          statsType = 'by_category'; // pie, doughnut, bar_h

    const url = `${API.stats}?type=${statsType}&period=${encodeURIComponent(period)}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (!data.success) throw new Error(data.message);
    return data;
}

// ════════════════════════════════════════════════════════════════
// F. AFFICHAGE DE LA LISTE DES DÉPENSES
// ════════════════════════════════════════════════════════════════

/**
 * renderExpenses(expenses, total) : Affiche la liste dans le tableau et les cartes mobiles.
 * @param {Array}  expenses - Tableau d'objets dépense
 * @param {number} total    - Total calculé par le serveur
 */
function renderExpenses(expenses, total) {
    const expenseList  = document.getElementById('expense-list');
    const expenseCards = document.getElementById('expense-cards');
    const emptyState   = document.getElementById('empty-state');
    const table        = document.getElementById('expense-table');
    const totalDisplay = document.getElementById('total-display');

    // Mettre à jour le total
    totalDisplay.textContent = formatMontant(total);

    // Vider les conteneurs
    expenseList.innerHTML  = '';
    expenseCards.innerHTML = '';

    if (expenses.length === 0) {
        // Aucune dépense → afficher l'état vide
        emptyState.classList.remove('hidden');
        table.classList.add('hidden');
        expenseCards.classList.add('hidden');
        return;
    }

    // Des dépenses → cacher l'état vide, afficher les conteneurs
    emptyState.classList.add('hidden');
    table.classList.remove('hidden');
    expenseCards.classList.remove('hidden');

    // Remplir chaque dépense
    expenses.forEach((item) => {
        const dateHeure  = formatDateHeure(item.expense_date, item.expense_hour, item.expense_minute);
        const montantStr = `${formatMontant(item.amount)} FCFA`;

        // ── Ligne de tableau (grand écran) ──────────────────────
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(item.name)}</td>
            <td><span class="badge badge-${item.category}">${item.category}</span></td>
            <td class="date-cell">${dateHeure}</td>
            <td class="montant-cell">${montantStr}</td>
            <td>
                <button class="delete-btn" onclick="deleteExpense(${item.id})" title="Supprimer">
                    🗑
                </button>
            </td>
        `;
        expenseList.appendChild(tr);

        // ── Carte mobile ─────────────────────────────────────────
        const card = document.createElement('div');
        card.className = `expense-card expense-card-${item.category}`;
        card.innerHTML = `
            <div class="card-header">
                <span class="card-name">${escapeHtml(item.name)}</span>
                <span class="card-amount">${montantStr}</span>
            </div>
            <div class="card-meta">
                <span>🏷 ${item.category}</span>
                <span>📅 ${dateHeure}</span>
            </div>
            <div class="card-footer">
                <span></span>
                <button class="delete-btn" onclick="deleteExpense(${item.id})">🗑 Supprimer</button>
            </div>
        `;
        expenseCards.appendChild(card);
    });
}

// ════════════════════════════════════════════════════════════════
// G. GRAPHIQUES (Chart.js)
// ════════════════════════════════════════════════════════════════

/**
 * updateChart(data) : Détruit l'ancien graphique et crée le nouveau.
 * @param {object} data - Données retournées par l'API stats
 */
function updateChart(data) {
    const chartType = document.getElementById('chart-type').value;
    const canvas    = document.getElementById('main-chart');
    const ctx       = canvas.getContext('2d'); // Contexte 2D du canvas HTML

    // ── IMPORTANT : Détruire l'ancien graphique avant d'en créer un nouveau ──
    // Sans ça, Chart.js affiche des erreurs et des artefacts visuels
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    // Palette de couleurs pour les catégories
    const colors = data.labels
        ? data.labels.map(label => CAT_COLORS[label] || getRandomColor())
        : [];

    // ── Options communes à tous les graphiques ─────────────────
    const commonOptions = {
        responsive: true,           // S'adapte à la taille du conteneur
        maintainAspectRatio: false, // On contrôle la hauteur manuellement
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    font: { size: 12, family: 'Segoe UI' },
                    padding: 15,
                    usePointStyle: true, // Points ronds plutôt que carrés
                }
            },
            tooltip: {
                // Formater les valeurs dans les tooltips (infobulles)
                callbacks: {
                    label: (context) => {
                        const value = context.parsed.y ?? context.parsed;
                        return ` ${formatMontant(value)} FCFA`;
                    }
                }
            }
        }
    };

    // ── Créer le bon type de graphique ────────────────────────
    switch (chartType) {

        // ─── BARRES HORIZONTALES (Catégories) ────────────────────
        case 'bar_h':
            currentChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: 'Dépenses par catégorie',
                        data: data.data,
                        backgroundColor: colors.map(c => c + 'CC'), // CC = 80% opacité
                        borderColor: colors,
                        borderWidth: 2,
                        borderRadius: 6, // Coins arrondis sur les barres
                    }]
                },
                options: {
                    ...commonOptions,
                    indexAxis: 'y', // Barres HORIZONTALES (y = axe des étiquettes)
                    plugins: {
                        ...commonOptions.plugins,
                        title: { display: true, text: '💰 Dépenses par catégorie' }
                    },
                    scales: {
                        x: {
                            ticks: {
                                // Formater l'axe X avec FCFA
                                callback: (value) => formatMontant(value) + ' F'
                            }
                        }
                    }
                }
            });
            break;

        // ─── CAMEMBERT ───────────────────────────────────────────
        case 'pie':
            currentChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: data.labels,
                    datasets: [{
                        data: data.data,
                        backgroundColor: colors,
                        borderColor: '#ffffff',
                        borderWidth: 3,
                        hoverOffset: 8, // Effet de soulèvement au survol
                    }]
                },
                options: {
                    ...commonOptions,
                    plugins: {
                        ...commonOptions.plugins,
                        title: { display: true, text: '🥧 Répartition des dépenses' },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct   = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return ` ${context.label}: ${formatMontant(value)} F (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
            break;

        // ─── ANNEAU (Doughnut) ───────────────────────────────────
        case 'doughnut':
            currentChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: data.labels,
                    datasets: [{
                        data: data.data,
                        backgroundColor: colors,
                        borderColor: '#ffffff',
                        borderWidth: 3,
                        hoverOffset: 10,
                    }]
                },
                options: {
                    ...commonOptions,
                    cutout: '65%', // Taille du trou central (en %)
                    plugins: {
                        ...commonOptions.plugins,
                        title: { display: true, text: '🍩 Vue en anneau' },
                        // Plugin personnalisé pour afficher le total au centre
                        centerText: {
                            enabled: true,
                            data: data.data,
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const pct   = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return ` ${context.label}: ${formatMontant(value)} F (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
            break;

        // ─── COURBE D'ÉVOLUTION (Line) ───────────────────────────
        case 'line':
            currentChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: 'Dépenses journalières',
                        data: data.data,
                        fill: true, // Remplir sous la courbe
                        backgroundColor: 'rgba(74, 144, 226, 0.15)',
                        borderColor: '#4a90e2',
                        borderWidth: 3,
                        pointBackgroundColor: '#4a90e2',
                        pointRadius: 5,
                        pointHoverRadius: 8,
                        tension: 0.4, // Courbe lissée (0 = angles droits, 1 = très courbe)
                    }]
                },
                options: {
                    ...commonOptions,
                    plugins: {
                        ...commonOptions.plugins,
                        title: { display: true, text: '📈 Évolution des dépenses' }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: (v) => formatMontant(v) + ' F' }
                        }
                    }
                }
            });
            break;

        // ─── BARRES PAR MOIS ─────────────────────────────────────
        case 'bar_month':
            currentChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: 'Total mensuel (FCFA)',
                        data: data.data,
                        backgroundColor: 'rgba(46, 204, 113, 0.7)',
                        borderColor: '#2ecc71',
                        borderWidth: 2,
                        borderRadius: 6,
                    }]
                },
                options: {
                    ...commonOptions,
                    plugins: {
                        ...commonOptions.plugins,
                        title: { display: true, text: '📅 Dépenses par mois' }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: (v) => formatMontant(v) + ' F' }
                        }
                    }
                }
            });
            break;

        default:
            console.warn('[App] Type de graphique inconnu :', chartType);
    }
}

/**
 * changeChartType() : Appelée quand l'utilisateur change le type de graphique.
 * On recharge les stats adaptées au nouveau type.
 */
async function changeChartType() {
    const period = document.getElementById('filter-period').value;
    try {
        const chartData = await fetchStats(period);
        updateChart(chartData);
    } catch (err) {
        console.error('[App] Erreur changement de graphique :', err);
    }
}

// ════════════════════════════════════════════════════════════════
// H. FILE D'ATTENTE HORS LIGNE (Offline Queue)
// ════════════════════════════════════════════════════════════════
// Quand l'utilisateur est hors ligne, on sauvegarde ses dépenses
// localement. Dès la reconnexion, on les envoie au serveur.

const OFFLINE_QUEUE_KEY = 'bp_offline_queue';

/**
 * addToOfflineQueue(expense) : Ajoute une dépense à la file locale.
 * @param {object} expense - Objet dépense à sauvegarder
 */
function addToOfflineQueue(expense) {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    queue.push({ ...expense, _offlineId: Date.now() }); // ID temporaire basé sur le timestamp
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[App] Dépense ajoutée à la file hors ligne. File :', queue.length, 'élément(s)');
}

/**
 * syncOfflineQueue() : Envoie au serveur toutes les dépenses en attente.
 * Appelée lors de la reconnexion réseau.
 */
async function syncOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    if (queue.length === 0) return;

    console.log(`[App] Synchronisation de ${queue.length} dépense(s) hors ligne...`);

    const synced = []; // IDs des dépenses correctement synchronisées

    for (const expense of queue) {
        try {
            const { _offlineId, ...expenseData } = expense; // Retirer l'ID temporaire

            const response = await fetch(API.expenses, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(expenseData)
            });

            if (response.ok) {
                synced.push(_offlineId);
                console.log(`[App] Dépense "${expense.name}" synchronisée.`);
            }
        } catch (err) {
            console.warn(`[App] Impossible de synchroniser "${expense.name}" :`, err);
            break; // Arrêter si on est toujours hors ligne
        }
    }

    // Retirer de la file les dépenses synchronisées
    const remainingQueue = queue.filter(e => !synced.includes(e._offlineId));
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));

    if (synced.length > 0) {
        console.log(`[App] ${synced.length} dépense(s) synchronisée(s).`);
        applyFilters(); // Rafraîchir l'affichage
    }
}

// ════════════════════════════════════════════════════════════════
// I. GESTION DES FORMULAIRES ET ÉVÉNEMENTS
// ════════════════════════════════════════════════════════════════

// ── Soumission du formulaire de nouvelle dépense ──────────────
document.getElementById('expense-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Lire les valeurs du formulaire
    const expense = {
        name:           document.getElementById('name').value.trim(),
        amount:         parseFloat(document.getElementById('amount').value),
        category:       document.getElementById('category').value,
        expense_date:   document.getElementById('expense-date').value,
        expense_hour:   parseInt(document.getElementById('expense-hour').value),
        expense_minute: parseInt(document.getElementById('expense-minute').value),
    };

    // Validation côté client
    if (!expense.name || expense.amount <= 0 || !expense.expense_date) {
        showFormMessage('form-error', '⚠️ Veuillez remplir tous les champs obligatoires.', true);
        return;
    }

    setButtonLoading('add-btn', true);
    hideFormMessages();

    // Mode hors ligne → file d'attente locale
    if (!navigator.onLine) {
        addToOfflineQueue(expense);
        showFormMessage('form-success', '📵 Hors ligne : dépense sauvegardée, sera sync dès reconnexion.', false);
        document.getElementById('expense-form').reset();
        document.getElementById('expense-date').value = getTodayString();
        setButtonLoading('add-btn', false);
        return;
    }

    // Mode en ligne → envoyer au serveur
    try {
        const response = await fetch(API.expenses, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(expense)
        });

        const data = await response.json();

        if (data.success) {
            showFormMessage('form-success', '✅ Dépense enregistrée avec succès !', false);
            document.getElementById('expense-form').reset();
            // Remettre la date d'aujourd'hui après le reset
            document.getElementById('expense-date').value = getTodayString();
            applyFilters(); // Rafraîchir la liste
        } else {
            showFormMessage('form-error', '❌ ' + data.message, true);
        }
    } catch (err) {
        // Erreur réseau inattendue → file hors ligne
        console.error('[App] Erreur ajout dépense :', err);
        addToOfflineQueue(expense);
        showFormMessage('form-success', '⚠️ Erreur réseau : dépense sauvegardée hors ligne.', false);
    } finally {
        setButtonLoading('add-btn', false);
    }
});

/**
 * deleteExpense(id) : Supprime une dépense après confirmation.
 * @param {number} id - ID de la dépense à supprimer
 */
async function deleteExpense(id) {
    // confirm() affiche une boîte de dialogue native (fonctionne sur mobile)
    if (!confirm('Supprimer cette dépense ? Cette action est irréversible.')) return;

    try {
        const response = await fetch(`${API.expenses}?id=${id}`, { method: 'DELETE' });
        const data     = await response.json();

        if (data.success) {
            applyFilters(); // Rafraîchir après suppression
        } else {
            alert('Erreur : ' + data.message);
        }
    } catch (err) {
        alert('Erreur réseau. Réessayez.');
        console.error('[App] Erreur suppression :', err);
    }
}

// ── Scroll vers le formulaire (bouton FAB) ────────────────────
function scrollToForm() {
    document.getElementById('add-section').scrollIntoView({
        behavior: 'smooth', // Défilement animé
        block: 'start'
    });
    // Focus sur le premier champ
    document.getElementById('name').focus();
}

// ════════════════════════════════════════════════════════════════
// J. UTILITAIRES
// ════════════════════════════════════════════════════════════════

/**
 * getTodayString() : Retourne la date d'aujourd'hui au format YYYY-MM-DD.
 * Ce format est requis par l'input type="date" HTML.
 * @returns {string} Ex: "2025-02-22"
 */
function getTodayString() {
    const today = new Date();
    const year  = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // getMonth() commence à 0
    const day   = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * formatDateHeure(dateStr, hour, minute) : Formate une date+heure de façon lisible.
 * @returns {string} Ex: "22/02/2025 à 14h30"
 */
function formatDateHeure(dateStr, hour, minute) {
    const [year, month, day] = dateStr.split('-'); // dateStr = "2025-02-22"
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    return `${day}/${month}/${year} à ${h}h${m}`;
}

/**
 * formatMontant(amount) : Formate un nombre avec des séparateurs de milliers.
 * @param {number} amount - Ex: 15000
 * @returns {string} Ex: "15 000"
 */
function formatMontant(amount) {
    return Number(amount).toLocaleString('fr-FR');
}

/**
 * escapeHtml(str) : Sécurise une chaîne contre les injections XSS.
 * XSS = Cross-Site Scripting : attaque qui insère du code malveillant dans la page.
 * @param {string} str - Chaîne à sécuriser
 * @returns {string} - Chaîne avec les caractères spéciaux échappés
 */
function escapeHtml(str) {
    const div       = document.createElement('div');
    div.textContent = str; // .textContent échappe automatiquement le HTML
    return div.innerHTML;
}

/**
 * getRandomColor() : Génère une couleur aléatoire (pour les catégories inconnues).
 * @returns {string} Ex: "#a3c4e7"
 */
function getRandomColor() {
    return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

// ── Gestion de l'affichage du chargement ─────────────────────
function showLoading(show) {
    document.getElementById('loading-indicator').classList.toggle('hidden', !show);
}

// ── Gestion de la bannière en ligne/hors ligne ────────────────
function updateOnlineBanner(isOnline) {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.toggle('hidden', isOnline);
}

// ── Messages du formulaire ────────────────────────────────────
function showFormMessage(elementId, message, isError) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

function hideFormMessages() {
    document.getElementById('form-error')?.classList.add('hidden');
    document.getElementById('form-success')?.classList.add('hidden');
}

// ── Gestion du chargement des boutons ─────────────────────────
function setButtonLoading(btnId, isLoading) {
    const btn     = document.getElementById(btnId);
    const text    = btn?.querySelector('.btn-text');
    const loading = btn?.querySelector('.btn-loading');
    if (!btn) return;

    btn.disabled = isLoading;
    if (text)    text.classList.toggle('hidden', isLoading);
    if (loading) loading.classList.toggle('hidden', !isLoading);
}

// ════════════════════════════════════════════════════════════════
// DÉMARRAGE DE L'APPLICATION
// On attend que le DOM soit prêt, puis on vérifie l'authentification
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});
