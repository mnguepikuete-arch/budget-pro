<?php
/**
 * FICHIER : api/stats.php
 * RÔLE    : Retourne les données agrégées pour les graphiques
 *
 * Types de statistiques disponibles (?type=...) :
 *   - by_category : Total par catégorie (camembert, barres)
 *   - by_day      : Évolution journalière (courbe)
 *   - by_month    : Évolution mensuelle (barres groupées)
 *   - by_week     : Comparaison des 8 dernières semaines
 *
 * Filtre de période supporté : ?period=week|month|year|all
 */

require_once 'config.php';

// Vérification d'authentification
if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Non authentifié.']);
    exit;
}

$userId = (int) $_SESSION['user_id'];
$pdo    = getPDO();
$type   = $_GET['type']   ?? 'by_category';
$period = $_GET['period'] ?? 'month';

// ── Construire la clause WHERE pour la période ────────────────
function buildDateFilter(string $period): string {
    switch ($period) {
        case 'week':  return "AND YEARWEEK(expense_date, 1) = YEARWEEK(CURDATE(), 1)";
        case 'month': return "AND MONTH(expense_date) = MONTH(CURDATE()) AND YEAR(expense_date) = YEAR(CURDATE())";
        case 'year':  return "AND YEAR(expense_date) = YEAR(CURDATE())";
        default:      return ""; // 'all' = aucun filtre
    }
}

$dateFilter = buildDateFilter($period);

switch ($type) {

    // ── STATISTIQUES PAR CATÉGORIE ────────────────────────────
    // Retourne le total dépensé dans chaque catégorie
    // Utilisé pour : Camembert, Anneau, Barres horizontales, Radar
    case 'by_category':
        $stmt = $pdo->prepare("
            SELECT 
                category,
                SUM(amount)   AS total,      -- Somme des montants
                COUNT(*)      AS nb_depenses  -- Nombre de dépenses
            FROM expenses
            WHERE user_id = ? $dateFilter
            GROUP BY category               -- Grouper par catégorie
            ORDER BY total DESC             -- Les plus grosses dépenses en premier
        ");
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        // Préparer les données au format Chart.js
        // Chart.js attend des tableaux séparés : labels et data
        $labels = array_column($rows, 'category');
        $data   = array_map('floatval', array_column($rows, 'total'));
        $counts = array_map('intval', array_column($rows, 'nb_depenses'));

        echo json_encode([
            'success' => true,
            'labels'  => $labels,  // Ex: ["Alimentation", "Transport", ...]
            'data'    => $data,    // Ex: [15000, 8000, ...]
            'counts'  => $counts,  // Ex: [5, 3, ...]
        ]);
        break;

    // ── ÉVOLUTION JOURNALIÈRE ─────────────────────────────────
    // Retourne le total par jour (pour la courbe d'évolution)
    case 'by_day':
        $stmt = $pdo->prepare("
            SELECT 
                expense_date                         AS jour,
                SUM(amount)                          AS total,
                DATE_FORMAT(expense_date, '%d/%m')   AS label  -- Format lisible (ex: 15/02)
            FROM expenses
            WHERE user_id = ? $dateFilter
            GROUP BY expense_date
            ORDER BY expense_date ASC  -- Du plus ancien au plus récent
        ");
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        echo json_encode([
            'success' => true,
            'labels'  => array_column($rows, 'label'),
            'data'    => array_map('floatval', array_column($rows, 'total')),
        ]);
        break;

    // ── ÉVOLUTION MENSUELLE ───────────────────────────────────
    // Retourne le total par mois (12 derniers mois)
    case 'by_month':
        $stmt = $pdo->prepare("
            SELECT 
                DATE_FORMAT(expense_date, '%Y-%m')      AS mois_key,   -- Clé de tri (2025-01)
                DATE_FORMAT(expense_date, '%b %Y')      AS label,      -- Label lisible (jan. 2025)
                SUM(amount)                             AS total
            FROM expenses
            WHERE user_id = ?
              AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
            GROUP BY mois_key, label
            ORDER BY mois_key ASC
        ");
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        echo json_encode([
            'success' => true,
            'labels'  => array_column($rows, 'label'),
            'data'    => array_map('floatval', array_column($rows, 'total')),
        ]);
        break;

    // ── COMPARAISON PAR SEMAINE ───────────────────────────────
    // Retourne le total par catégorie pour chaque semaine (8 dernières semaines)
    // Utilisé pour le graphique en barres groupées
    case 'by_week':
        // On récupère les 8 dernières semaines, regroupées par catégorie
        $stmt = $pdo->prepare("
            SELECT 
                YEARWEEK(expense_date, 1)               AS semaine_key,
                CONCAT('S', WEEK(expense_date, 1))      AS label,
                category,
                SUM(amount)                             AS total
            FROM expenses
            WHERE user_id = ?
              AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 8 WEEK)
            GROUP BY semaine_key, label, category
            ORDER BY semaine_key ASC
        ");
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll();

        // Restructurer pour Chart.js grouped bar chart
        $weeks      = [];
        $categories = ['Alimentation', 'Transport', 'Loisirs', 'Santé'];
        $datasets   = [];

        foreach ($rows as $row) {
            if (!in_array($row['label'], $weeks)) {
                $weeks[] = $row['label'];
            }
        }

        foreach ($categories as $cat) {
            $catData = [];
            foreach ($weeks as $week) {
                $found = false;
                foreach ($rows as $row) {
                    if ($row['label'] === $week && $row['category'] === $cat) {
                        $catData[] = (float) $row['total'];
                        $found = true;
                        break;
                    }
                }
                if (!$found) $catData[] = 0; // 0 si pas de dépense cette semaine
            }
            $datasets[] = ['label' => $cat, 'data' => $catData];
        }

        echo json_encode([
            'success'  => true,
            'labels'   => $weeks,
            'datasets' => $datasets,
        ]);
        break;

    default:
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Type de statistique inconnu.']);
}
