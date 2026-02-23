/**
 * FICHIER : auth.js
 * RÔLE    : Gestion de l'authentification côté client (page login.html)
 *
 * Ce fichier gère :
 *   - Basculer entre l'onglet "Connexion" et "Inscription"
 *   - Envoyer le formulaire de connexion à l'API PHP
 *   - Envoyer le formulaire d'inscription à l'API PHP
 *   - Afficher/masquer le mot de passe
 *   - Détecter l'état hors ligne
 *   - Enregistrer le Service Worker (PWA)
 */

// ── CONSTANTE : URL de l'API d'authentification ───────────────
// Adapte ce chemin si ton projet est dans un sous-dossier différent
const AUTH_API = 'api/auth.php';

// ── 1. ENREGISTREMENT DU SERVICE WORKER ───────────────────────
// À faire dès le chargement de la page (même sur la page login)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('[Auth] Service Worker enregistré, scope :', reg.scope))
        .catch(err => console.error('[Auth] Erreur Service Worker :', err));
}

// ── 2. VÉRIFICATION DE L'ÉTAT EN LIGNE / HORS LIGNE ───────────
function updateOnlineStatus() {
    const banner = document.getElementById('offline-banner');
    if (banner) {
        // navigator.onLine = true si connecté, false sinon
        banner.classList.toggle('hidden', navigator.onLine);
    }
}

// Écouter les changements de connectivité
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus(); // Vérification initiale

// ── 3. VÉRIFICATION SI DÉJÀ CONNECTÉ ─────────────────────────
// Si l'utilisateur arrive sur la page login alors qu'il est déjà connecté,
// on le redirige directement vers le tableau de bord
async function checkAlreadyLoggedIn() {
    try {
        const response = await fetch(`${AUTH_API}?action=check`);
        const data     = await response.json();
        if (data.success && data.loggedIn) {
            // Déjà connecté → aller sur le tableau de bord
            window.location.href = 'index.html';
        }
    } catch (err) {
        // En cas d'erreur réseau (ex: hors ligne), on reste sur la page
        console.log('[Auth] Impossible de vérifier la session (hors ligne ?)');
    }
}

checkAlreadyLoggedIn();

// ── 4. BASCULER ENTRE LES ONGLETS ─────────────────────────────
/**
 * switchTab(tab) : Affiche le formulaire demandé (login ou register)
 * @param {string} tab - 'login' ou 'register'
 */
function switchTab(tab) {
    // Mettre à jour les boutons d'onglets
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');

    // Afficher/cacher les formulaires
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('register-form').classList.toggle('active', tab === 'register');

    // Effacer les messages précédents
    clearMessages();
}

// ── 5. AFFICHER / MASQUER LE MOT DE PASSE ─────────────────────
/**
 * togglePassword(inputId, btn) : Bascule entre type="password" et type="text"
 * @param {string} inputId - ID de l'input mot de passe
 * @param {HTMLElement} btn - Le bouton œil cliqué
 */
function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? '🙈' : '👁'; // Changer l'icône
}

// ── 6. AFFICHAGE DES MESSAGES ──────────────────────────────────
function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
}

function showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearMessages() {
    ['login-error', 'register-error', 'register-success'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = '';
            el.classList.add('hidden');
        }
    });
}

// ── 7. FORMULAIRE DE CONNEXION ─────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); // Empêcher le rechargement de la page
    clearMessages();

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    // Validation simple côté client (avant même d'appeler le serveur)
    if (!username || !password) {
        showError('login-error', '⚠️ Veuillez remplir tous les champs.');
        return;
    }

    // Afficher l'état de chargement sur le bouton
    setButtonLoading('login-btn', true);

    try {
        // Envoyer les données à l'API PHP en JSON
        const response = await fetch(`${AUTH_API}?action=login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            // Connexion réussie : sauvegarder le nom d'utilisateur en mémoire locale
            // (pour l'affichage dans la navigation, pas pour la sécurité)
            localStorage.setItem('bp_username', data.username);

            // Rediriger vers le tableau de bord
            window.location.href = 'index.html';
        } else {
            showError('login-error', '❌ ' + data.message);
        }
    } catch (err) {
        showError('login-error', '📵 Erreur réseau. Vérifiez votre connexion.');
        console.error('[Auth] Erreur login :', err);
    } finally {
        // Toujours retirer l'état de chargement, même en cas d'erreur
        setButtonLoading('login-btn', false);
    }
});

// ── 8. FORMULAIRE D'INSCRIPTION ────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();

    const username  = document.getElementById('reg-username').value.trim();
    const password  = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;

    // Validations côté client
    if (!username || !password) {
        showError('register-error', '⚠️ Tous les champs sont obligatoires.');
        return;
    }

    if (username.length < 3) {
        showError('register-error', '⚠️ Le nom doit contenir au moins 3 caractères.');
        return;
    }

    if (password.length < 6) {
        showError('register-error', '⚠️ Le mot de passe doit contenir au moins 6 caractères.');
        return;
    }

    if (password !== password2) {
        showError('register-error', '⚠️ Les mots de passe ne correspondent pas.');
        return;
    }

    setButtonLoading('register-btn', true);

    try {
        const response = await fetch(`${AUTH_API}?action=register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('register-success', '✅ Compte créé ! Vous pouvez maintenant vous connecter.');
            // Pré-remplir le formulaire de connexion et basculer sur l'onglet
            document.getElementById('login-username').value = username;
            setTimeout(() => switchTab('login'), 1500);
        } else {
            showError('register-error', '❌ ' + data.message);
        }
    } catch (err) {
        showError('register-error', '📵 Erreur réseau. Vérifiez votre connexion.');
    } finally {
        setButtonLoading('register-btn', false);
    }
});

// ── 9. GESTION DE L'ÉTAT DE CHARGEMENT DES BOUTONS ───────────
/**
 * setButtonLoading(btnId, isLoading) :
 * Désactive le bouton et affiche le texte de chargement
 * @param {string} btnId     - ID du bouton
 * @param {boolean} isLoading - true = afficher le chargement
 */
function setButtonLoading(btnId, isLoading) {
    const btn     = document.getElementById(btnId);
    const text    = btn.querySelector('.btn-text');
    const loading = btn.querySelector('.btn-loading');

    btn.disabled = isLoading;
    text.classList.toggle('hidden', isLoading);
    loading.classList.toggle('hidden', !isLoading);
}
