<div align="center">

# ⚜ Sphinx Alliance

### Plateforme de trading FX — *Intelligence · Discipline · Edge*

Un terminal macro forex façon Bloomberg et un journal de performance complet,
réunis derrière un portail unique. Aucune dépendance lourde, aucun framework :
du HTML/CSS/JS pur, hébergeable n'importe où.

</div>

---

## Modules

### 🌍 FX Macro Compass
Salle de marché en trois colonnes, inspirée du « Terminal Macro FX » : **rail des devises** (classées par force relative, note /100), **globe terrestre** (canvas d3 + topojson, `world.json` embarqué dans le dépôt : on choisit une devise, le globe pivote sur sa zone, s'arrête et pulse ; 177 pays survolables, zoom, pays hors couverture gérés), et **lecture macro** à droite. **Thème clair ou sombre** : bouton ☾/☀ dans le Compass, synchronisé dans les deux sens avec le mode du hub.

- 9 devises (USD, EUR, GBP, JPY, CHF, AUD, NZD, CAD, CNH), 4 piliers : **croissance · inflation · politique monétaire · géopolitique**.
- Les notes /100 par devise sont un **jugement** porté par Claude sur les pages Notion (Biais & Force Relative + Track Record Fondamental + Live Feed) complété par des recherches web, écrit dans Firestore (collection `macroCompass`) à la demande de Kevin (« mets à jour le macro compass »), puis lu en direct par le site. Claude prépare un fichier `macro-compass-AAAA-MM-JJ.json`, qu'un rédacteur publie avec le bouton **📥 Importer une mise à jour**. Badge « figé » tant qu'aucune note n'est publiée — jamais de donnée périmée déguisée en live.
- **Vue d'ensemble** d'une devise : biais, driver dominant, note, rang, **récap du mois** (résumé + frise des faits datés), « À venir ». Clic sur un **pilier** : verdict, tableau de toutes les données (réel, consensus, précédent, lecture pour la devise), analyse, à surveiller, synthèses Daily FX liées ; clic sur une ligne → fiche.
- **Prochaines publications** : calendrier à 14 jours construit depuis les « à surveiller » des piliers et les décisions des banques centrales.
- **Sessions de trading** (Sydney, Tokyo, Londres, New York sur une frise 24 h UTC, heure d'été gérée par `Intl`) et **Fear & Greed** CNN (via `/api/feargreed`, route du Worker du site (`worker.js`) ; repli sur l’ancien relais Notion).
- **Attentes de taux** : prochaine réunion calculée depuis le calendrier des banques centrales (`config/rateExpectations.meetings`, calendrier par défaut dans `fx-terminal.html`). Clic sur une banque → tableau de bord : taux actuel / attendu, mouvement attendu, courbe des taux implicites (actuelle vs il y a une semaine), points implicites par réunion, historique des attentes (`config/rateHistory`, alimenté à chaque collage, modification ou import).
- **Panneau de contrôle** à droite (barre horizontale sur mobile) : une vue à la fois, adressable par une ancre (`fx-terminal.html#cot`, `#dmx`, `#articles`…), la dernière vue est mémorisée. Chaque vue ne charge ses données qu'à sa première ouverture.
  - **Macro** : le globe et la lecture par pilier (ci-dessus).
  - **Comparer** : planisphère (d3, `world.json`) — tous les pays en gris, les 8 économies tradées en couleur selon l'indicateur choisi (**inflation, chômage, taux d'emploi**), *plus la valeur est élevée, plus la couleur est claire* ; fiche par économie (valeur, période, rang, mini-courbe) et classement. Données dans `compare-data.json` : un **relevé daté**, pas un flux — chaque chiffre porte sa période, « ancien » s'affiche au-delà de 3 mois (6 pour un trimestriel).
  - **Taux** : cartes des banques centrales + tableau comparé.
  - **COT** : 52 semaines par devise depuis la CFTC (appel direct, cache 6 h) — net, variation hebdo, longs/courts, position dans la fourchette, courbe ; catégories *spéculateurs* (rapport legacy `6dca-aqww`) et *hedge funds / gérants d'actifs / dealers* (rapport TFF `gpe5-46if`, facultatif : s'il ne répond pas, seule la vue spéculateurs s'affiche).
  - **DMX** (Dumb Money indeX) : positionnement des particuliers Myfxbook via `/api/dmx` — barres acheteurs/vendeurs par paire, signal contrarian, indice agrégé par devise. Si la lecture échoue, le widget Myfxbook d'origine s'affiche à la place.
  - **Articles** : flux RSS fusionnés par `/api/news` (FXStreet, ING Think, CNBC, MarketWatch, Fed, BCE, BoE, Google News), complétés par Finnhub quand la clé est réglée ; filtres par **devise** et par **thème** (actions, banques centrales, données macro, taux & obligations, matières premières, géopolitique, crypto), recherche, pastille « nouveau ».
  - **Live TV** : directs YouTube (Bloomberg, Yahoo Finance, CNBC, Reuters, France 24…), ajout de ses propres chaînes (mémorisées sur l'appareil), lecture coupée en quittant la vue.
  - **Marchés** (Polymarket, tendances 30 j Polygon) et **Brief IA**.
- **Routes du Worker** (`worker.js` + `api-lib.mjs`, aucune clé dans le dépôt) : `/api/feargreed`, `/api/news`, `/api/dmx` (`?debug=1` montre ce que le widget renvoie). L'API officielle Myfxbook est facultative : identifiants à poser soi-même comme **secrets du Worker** dans Cloudflare (`MYFXBOOK_EMAIL`, `MYFXBOOK_PASSWORD`), jamais dans un fichier.

### 🧠 Daily FX
- Synthèses macro post-annonces (rédacteurs), avec tags gérables et historique par semaine.
- **Rapports hebdomadaires PDF** : un rédacteur publie un PDF (12 Mo max), les membres l'ouvrent depuis une carte dans une fenêtre au fond flouté. Stockage Firestore `dailyReports` (+ sous-collection `chunks`), affichage via PDF.js.

### 🎯 Set-ups fondamentaux
- **Set-ups de l'alliance** : pour chaque paire, la thèse en texte libre + plusieurs captures de graphiques, chacune avec sa légende (time frame M5 → W1 en un clic). Collage (Ctrl+V), glisser-déposer et réorganisation des images. Contenu partagé comme le Daily FX : **tout le monde lit, seuls les rédacteurs créent, modifient, suppriment et lancent l'analyse**. Firestore : `fundSetups` (+ sous-collection `shots`), règles dans `firestore.rules`.
- **Avis fondamental de l'IA** : elle lit tout le Sphinx Alliance (Macro Compass, attentes de taux, Daily FX) et rend un verdict *Favorable / Mitigé / Défavorable* sur la paire et ta thèse — fondamental uniquement, les graphiques ne sont pas envoyés à l'IA. Clé API (Gemini, Claude ou ChatGPT) gardée dans le navigateur, réglable dans ⚙️ Paramètres → IA.
- **Radar IA** : classement global des paires les plus cohérentes du moment.

### 🔒 Droits
Les **rédacteurs** (liste identique dans `firestore.rules`, `MACRO_EDITORS` de `index.html` et `MACRO_EDITORS_FX` de `fx-terminal.html`) sont les seuls à voir et utiliser les interfaces d'édition : formulaire du Daily FX, édition des attentes de taux du Macro Compass, création / modification / suppression des set-ups. Les autres membres ont une vue lecteur.

### 🔐 Connexion
- À chaque ouverture du site, l'identité est revérifiée : **Face ID / Touch ID** (WebAuthn, à activer dans ⚙️ Paramètres → Compte) ou **mot de passe** (Google pour les comptes Google).
- Chaque compte utilisé sur l'appareil garde sa propre session : changer de compte ne demande que Face ID / Touch ID (ou le mot de passe) du compte choisi.

### 📈 Performance Tracker
Journal de trading complet, synchronisé via **Firebase**, conçu sur le modèle des journaux pros (Tradezella, Edgewonk, TraderSync).

- **Filtre de période** (Tout, 30 j, 90 j, 6 mois, année en cours) qui s'applique à tout le tableau de bord et à l'analyse.
- **Tableau de bord** : P&L net, win rate, profit factor, ratio gain/perte, espérance (en $ et en R), max drawdown ; courbe d'équité + drawdown ; **score de performance /100** (six critères) ; calendrier P&L avec total par semaine ; derniers trades ; P&L journalier.
- **Coach IA** : analyse personnalisée des trades de la période (bilan, psychologie, risque ou edge) avec la clé API de ⚙️ Paramètres → IA ; dernière analyse gardée par journal.
- **Analyse** : évolution du P&L (semaine / mois / trimestre / année, axe continu), distribution des R-multiples, jour de la semaine, performance par critère (paire, session, direction, timeframe, ordre, condition, sentiment, géopolitique, psychologie, jour), points clés automatiques, qualité d'exécution, statistiques détaillées. Chaque graphique a sa vue tableau.
- Couleurs des graphiques validées pour le daltonisme et le contraste, en mode clair comme sombre.

---

## Architecture

| Fichier | Rôle |
|---|---|
| `index.html` | Portail de connexion + Hub Sphinx Alliance + Performance Tracker |
| `fx-terminal.html` | FX Macro Terminal (chargé dans une iframe par le hub) |

L'accès au site passe par une **page d'accueil unique** : l'authentification
Sphinx Alliance déverrouille l'ensemble des modules.

---

## Lancer en local

```bash
# Depuis le dossier du projet
python3 -m http.server 8080
# puis ouvrir http://localhost:8080/index.html
```

> Les deux fichiers doivent rester dans le même dossier (le terminal est référencé en chemin relatif).

---

## Stack

- HTML / CSS / JavaScript natif (zéro build).
- [Firebase](https://firebase.google.com/) — authentification & Firestore.
- [Chart.js](https://www.chartjs.org/) — graphiques du journal.
- [Finnhub](https://finnhub.io/) — flux d'actualités.
- Données macro : **OCDE SDMX**, **BLS**.

---

<div align="center">
<sub>⚜ Sphinx Alliance — Tous droits réservés.</sub>
</div>
