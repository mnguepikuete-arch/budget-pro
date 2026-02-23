# 💰 Budget Pro — Application de Suivi de Dépenses

> PWA Mobile-First · PHP + MySQL · Chart.js · Service Worker Offline

## 🚀 Installation rapide

1. Copier dans `C:\laragon\www\budget-pro\`
2. Importer `database/budget_pro.sql` dans HeidiSQL
3. Ouvrir `http://localhost/budget-pro/login.html`

## 📁 Structure
```
budget-pro/
├── index.html         # Tableau de bord
├── login.html         # Connexion/Inscription
├── style.css          # Styles (mobile-first)
├── app.js             # Logique principale
├── auth.js            # Authentification client
├── manifest.json      # PWA manifest
├── sw.js              # Service Worker (offline)
├── icons/             # Icônes app (72px-512px)
├── api/
│   ├── config.php     # Connexion MySQL
│   ├── auth.php       # Login/Logout API
│   ├── expenses.php   # CRUD dépenses
│   └── stats.php      # Données graphiques
└── database/
    └── budget_pro.sql # Schéma + données test
```

## 📖 Documentation complète
Voir **GUIDE_IMPLEMENTATION.docx**

## 🔑 Compte de test
- Username: `admin`  
- Password: `password`
