<?php
/**
 * ============================================================
 * api/expenses.php — API CRUD DES DÉPENSES
 * ============================================================
 * CRUD = Create, Read, Update, Delete (les 4 opérations de base)
 *
 * Routes disponibles :
 *   GET    api/expenses.php?action=list              → Liste filtrée
 *   POST   api/expenses.php?action=create            → Ajouter
 *   DELETE api/expenses.php?action=delete&id={id}    → Supprimer
 *   POST   api/expenses.php?action=sync              → Sync offline→DB
 *
 * Tous les endpoints nécessitent d'être connecté (session).
 * ============================================================
 */

require_once __DIR__ . '/config.php';

// Vérifie la session → retourne l'ID de l'utilisateur connecté
$userId = requireAuth();

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'list':   getExpenses($userId);   break;
    case 'create': createExpense($userId); break;
    case 'delete': deleteExpense($userId); break;
    case 'sync':   syncOffline($userId);   break;
    default: sendJson(['success' => false, 'error' => 'Action inconnue'], 400);
}

// ============================================================
// FONCTION : getExpenses() — Lecture avec filtres
// ============================================================
function getExpenses(int $userId): void {
    global $pdo;

    // Récupération des filtres depuis l'URL (GET params)
    $filterPeriod   = $_GET['period']   ?? 'all';   // all, week, month, year
    $filterCategory = $_GET['category'] ?? 'Toutes';
    $filterYear     = $_GET['year']     ?? date('Y');
    $filterMonth    = $_GET['month']    ?? date('m');

    // Construction dynamique de la requête SQL avec des conditions
    // On commence par filtrer par utilisateur (sécurité : chaque user voit SEULEMENT ses données)
    $sql    = 'SELECT * FROM expenses WHERE user_id = ?';
    $params = [$userId]; // Tableau des paramètres (évite les injections SQL)

    // Filtre par catégorie
    if ($filterCategory !== 'Toutes') {
        $sql      .= ' AND category = ?';
        $params[]  = $filterCategory;
    }

    // Filtre par période (utilise les fonctions DATE de MySQL)
    switch ($filterPeriod) {
        case 'week':
            // YEARWEEK() retourne le numéro de semaine de l'année (ex: 202401)
            $sql      .= ' AND YEARWEEK(expense_date, 1) = YEARWEEK(CURDATE(), 1)';
            break;
        case 'month':
            // Filtre par année ET mois sélectionnés
            $sql      .= ' AND YEAR(expense_date) = ? AND MONTH(expense_date) = ?';
            $params[]  = $filterYear;
            $params[]  = $filterMonth;
            break;
        case 'year':
            $sql      .= ' AND YEAR(expense_date) = ?';
            $params[]  = $filterYear;
            break;
        // 'all' : aucun filtre de date supplémentaire
    }

    // Tri par date et heure décroissantes (les plus récentes en premier)
    $sql .= ' ORDER BY expense_date DESC, expense_time DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $expenses = $stmt->fetchAll();

    // Calcul du total côté serveur
    $total = array_sum(array_column($expenses, 'amount'));

    // Calcul des totaux par catégorie pour les graphiques
    $byCategory = [];
    foreach ($expenses as $exp) {
        $cat = $exp['category'];
        $byCategory[$cat] = ($byCategory[$cat] ?? 0) + (float)$exp['amount'];
    }

    // Calcul des totaux par date pour le graphique de courbe
    $byDate = [];
    foreach ($expenses as $exp) {
        $date = $exp['expense_date'];
        $byDate[$date] = ($byDate[$date] ?? 0) + (float)$exp['amount'];
    }
    ksort($byDate); // Tri chronologique

    sendJson([
        'success'     => true,
        'expenses'    => $expenses,
        'total'       => round($total, 2),
        'byCategory'  => $byCategory,
        'byDate'      => $byDate,
        'count'       => count($expenses),
    ]);
}

// ============================================================
// FONCTION : createExpense() — Création d'une dépense
// ============================================================
function createExpense(int $userId): void {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['success' => false, 'error' => 'Méthode non autorisée'], 405);
    }

    $data = json_decode(file_get_contents('php://input'), true);

    // Validation des champs obligatoires
    $required = ['name', 'amount', 'category', 'expense_date', 'expense_time'];
    foreach ($required as $field) {
        if (empty($data[$field])) {
            sendJson(['success' => false, 'error' => "Champ manquant : $field"], 400);
        }
    }

    // Sécurisation et nettoyage des données
    $name        = htmlspecialchars(trim($data['name']), ENT_QUOTES, 'UTF-8');
    $amount      = filter_var($data['amount'], FILTER_VALIDATE_FLOAT);
    $category    = htmlspecialchars($data['category'], ENT_QUOTES, 'UTF-8');
    $expDate     = $data['expense_date']; // Format attendu : YYYY-MM-DD
    $expTime     = $data['expense_time']; // Format attendu : HH:MM:SS

    if ($amount === false || $amount <= 0) {
        sendJson(['success' => false, 'error' => 'Montant invalide'], 400);
    }

    // INSERT avec requête préparée
    $stmt = $pdo->prepare(
        'INSERT INTO expenses (user_id, name, amount, category, expense_date, expense_time)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$userId, $name, $amount, $category, $expDate, $expTime]);

    // lastInsertId() retourne l'ID de la ligne qu'on vient d'insérer
    $newId = $pdo->lastInsertId();

    sendJson([
        'success' => true,
        'message' => 'Dépense enregistrée',
        'id'      => $newId,
    ], 201); // 201 = Created
}

// ============================================================
// FONCTION : deleteExpense() — Suppression
// ============================================================
function deleteExpense(int $userId): void {
    global $pdo;

    $id = filter_var($_GET['id'] ?? 0, FILTER_VALIDATE_INT);
    if (!$id) {
        sendJson(['success' => false, 'error' => 'ID invalide'], 400);
    }

    // IMPORTANT : on vérifie que la dépense appartient bien à l'utilisateur connecté
    // Sans ce check, n'importe qui pourrait supprimer les données des autres !
    $stmt = $pdo->prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $userId]);

    if ($stmt->rowCount() === 0) {
        sendJson(['success' => false, 'error' => 'Dépense introuvable ou non autorisée'], 404);
    }

    sendJson(['success' => true, 'message' => 'Dépense supprimée']);
}

// ============================================================
// FONCTION : syncOffline() — Synchronisation des données offline
// ============================================================
// Quand l'utilisateur était hors ligne, on a stocké ses dépenses
// dans IndexedDB. À la reconnexion, on les envoie ici pour les
// sauvegarder dans MySQL.
function syncOffline(int $userId): void {
    global $pdo;

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendJson(['success' => false, 'error' => 'POST requis'], 405);
    }

    $data     = json_decode(file_get_contents('php://input'), true);
    $pending  = $data['expenses'] ?? [];

    if (empty($pending)) {
        sendJson(['success' => true, 'synced' => 0]);
    }

    $synced = 0;
    $stmt = $pdo->prepare(
        'INSERT INTO expenses (user_id, name, amount, category, expense_date, expense_time)
         VALUES (?, ?, ?, ?, ?, ?)'
    );

    foreach ($pending as $exp) {
        try {
            $stmt->execute([
                $userId,
                htmlspecialchars($exp['name'], ENT_QUOTES, 'UTF-8'),
                (float)$exp['amount'],
                htmlspecialchars($exp['category'], ENT_QUOTES, 'UTF-8'),
                $exp['expense_date'],
                $exp['expense_time'],
            ]);
            $synced++;
        } catch (Exception $e) {
            // On ignore les erreurs individuelles pour ne pas bloquer la sync
            continue;
        }
    }

    sendJson(['success' => true, 'synced' => $synced, 'message' => "$synced dépense(s) synchronisée(s)"]);
}
