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
Inspiré du « Terminal Macro FX » : **globe terrestre** à gauche et **devises par rang** à droite (classées par force relative, note /100), **vue d'ensemble** de la devise en dessous, sur toute la largeur. Globe (canvas d3 + topojson, `world.json` embarqué dans le dépôt : on choisit une devise, le globe pivote sur sa zone, s'arrête et pulse ; 177 pays survolables, zoom, pays hors couverture gérés). **Thème clair ou sombre** : bouton ☾/☀ dans le Compass, synchronisé dans les deux sens avec le mode du hub.

- 9 devises (USD, EUR, GBP, JPY, CHF, AUD, NZD, CAD, CNH), 4 piliers : **croissance · inflation · politique monétaire · géopolitique**.
- Les notes /100 par devise sont un **jugement** porté par Claude sur les pages Notion (Biais & Force Relative + Track Record Fondamental + Live Feed) complété par des recherches web, écrit dans Firestore (collection `macroCompass`) à la demande de Kevin (« mets à jour le macro compass »), puis lu en direct par le site. Claude prépare un fichier `macro-compass-AAAA-MM-JJ.json`, qu'un rédacteur publie avec le bouton **📥 Importer une mise à jour**. Badge « figé » tant qu'aucune note n'est publiée — jamais de donnée périmée déguisée en live.
- **Vue d'ensemble** d'une devise (seule lecture proposée, les piliers ne sont plus cliquables) : biais, driver dominant, note, rang, notes des quatre piliers en lecture seule, **récap du mois** (résumé + frise des faits datés), « À venir », synthèses Daily FX récentes de la devise.
- **Prochaines publications** : calendrier à 14 jours construit depuis les « à surveiller » des piliers et les décisions des banques centrales.
- **Sessions de trading** (Sydney, Tokyo, Londres, New York sur une frise 24 h UTC, heure d'été gérée par `Intl`) et **Fear & Greed** CNN (via `/api/feargreed`, route du Worker du site (`worker.js`) ; repli sur l’ancien relais Notion).
- **Attentes de taux** : prochaine réunion calculée depuis le calendrier des banques centrales (`config/rateExpectations.meetings`, calendrier par défaut dans `fx-terminal.html`). Clic sur une banque → tableau de bord : taux actuel / attendu, mouvement attendu, courbe des taux implicites (actuelle vs il y a une semaine), points implicites par réunion, historique des attentes (`config/rateHistory`, alimenté à chaque collage, modification ou import).
- **Disposition** (bouton en haut à droite) : sur chaque page, les cartes se déplacent (glisser « ⠿ Déplacer », à la souris ou au doigt, ou flèches ↑ ↓) et passent en pleine largeur ou en demi-largeur (« ⇔ ») ; deux demi-largeurs côte à côte ont toujours la même hauteur. Disposition mémorisée sur l'appareil (`localStorage`, clé `fxmt_layout`), « Réinitialiser cette page » revient à l'origine.
- **Panneau de contrôle** à droite (barre horizontale sur mobile) : une vue à la fois, adressable par une ancre (`fx-terminal.html#cot`, `#dmx`, `#articles`…), la dernière vue est mémorisée. Chaque vue ne charge ses données qu'à sa première ouverture.
  - **Dashboard** (ancre `#dashboard`, anciennement « Macro ») : sessions de trading et Fear & Greed côte à côte (même hauteur), prochaines publications, globe + devises par rang, vue d'ensemble.
  - **Graphiques** : widgets TradingView (intégration officielle gratuite) — majeures, n'importe quelle paire des 8 devises, dollar index, or, indices, pétrole, taux US ; unité de temps ; 1, 2 ou 4 graphiques côte à côte ; thème suivi ; disposition mémorisée sur l'appareil. Le nom d'une paire dans le DMX ouvre son graphique.
  - **Calendrier** : publications de la semaine et de la suivante via `/api/calendar` (ForexFactory) — heure locale, impact en couleur (rouge = fort, orange = moyen, gris = faible : pastille, liseré et fond de ligne), consensus, précédent ; filtres semaine / impact / devise, prochaine publication avec compte à rebours.
  - **Saisonnalité** : profil moyen d'une paire sur l'année, façon Seasonax, pour tous les croisements des 8 devises (prix = r[cotation] / r[base], r[EUR] = 1) à partir des fixings BCE depuis 1999 (Frankfurter `v1`, historique gardé en `localStorage` puis complété des seuls jours manquants), et pour **BTC/USD, S&P 500, Nasdaq 100 et XAU/USD** à partir de leurs clôtures quotidiennes (`/api/history` : Yahoo Finance, puis LBMA pour l'or, Stooq ou FRED en repli ; gardées 12 h sur l'appareil). Même calcul pour tous les actifs. Log-rendements, années remises à zéro au premier fixing et étalées sur 366 cases, moyenne des années complètes (≥ 200 fixings, année en cours exclue) sur 5 / 10 / 15 / 20 ans ou tout l'historique ; bande = erreur-type σ/√n (dispersion ±1σ au survol) ; année en cours en orange, masquable ; quatre chiffres clés, tableau mois par mois, fenêtres saisonnières (10–60 jours, ≥ 70 % des années dans le même sens, |moyenne| ≥ 0,5 %, classées par régularité puis netteté, 5 sans chevauchement).
  - **Macro** (ancre `#macro`, anciennement « Comparer » ; `#compare` reste valable) : planisphère (d3, `world.json`) — tous les pays en gris, les 8 économies tradées en couleur selon l'indicateur choisi, *plus la valeur est élevée, plus la couleur est claire* ; fiche par économie (valeur, période, rang, mini-courbe) en grille sous la carte, et classement. Douze indicateurs : inflation, inflation cœur, chômage, emploi, PIB, ventes au détail, PMI manufacturier, PMI services, PMI composite, ISM manufacturier et ISM services (États-Unis seulement), taux directeur. Base dans `compare-data.json` (relevé daté), complétée automatiquement par `/api/macro` — chaque chiffre porte sa période, « ancien » s'affiche au-delà de 3 mois (6 pour un trimestriel). Le **taux directeur** est celui de l'onglet Taux. Un **graphique toujours ouvert** est placé à gauche du classement (dessous sur petit écran). Le widget TradingView refusant les séries économiques (« symbole disponible uniquement sur TradingView »), la courbe est tracée par le site (d3) à partir des **chiffres publiés au calendrier économique TradingView depuis 2019** (`/api/econ?q=2024Q1`, un trimestre par appel, figé en cache Cloudflare une fois le trimestre passé, gardé sur l'appareil dans `fxmt_econ_v1`), complétés par le relevé. Il suit chaque clic sur une ligne, un pays ou une étiquette ; boutons 2 ans / 5 ans / Tout, une économie ou les 8 superposées (aussi via la ligne **⇄ Comparer**), une couleur fixe par économie (palette catégorielle validée daltonisme), taux directeurs en marches d'escalier, repère 50 pour les PMI / ISM, valeurs au survol, lien vers la série sur tradingview.com. Les PMI S&P Global, l'emploi et l'ISM services n'ont pas de graphique : TradingView ne publie pas ces séries.
  - **Taux** : cartes des banques centrales, tableau comparé, et rendements 2 ans / 10 ans (États-Unis, zone euro, Canada, Japon) avec pente et écart contre les États-Unis (`/api/rates` : FRED, BCE, Banque du Canada, ministère des Finances du Japon). Le **taux directeur affiché est recalé tout seul après chaque décision** publiée au calendrier économique (`/api/macro`, codes TradingView `…INTR`, BCE : taux de dépôt ou refi selon la convention de la saisie), sauf si un rédacteur a saisi le taux après la décision ; rien n'est écrit dans Firestore, le ↻ et l'infobulle indiquent le recalage. Le détail d'une banque montre l'**évolution des attentes** en courbe lissée : variation attendue à la prochaine réunion (bps pondérés par les probabilités), bleu vers les hausses, gris au statu quo, rouge vers les baisses.
  - **COT** : 52 semaines par devise depuis la CFTC (appel direct, cache 6 h) — net, variation hebdo, longs/courts, position dans la fourchette, courbe ; deux groupes de marchés (devises ; or, argent, pétrole, S&P 500, Nasdaq, T-Notes, VIX, bitcoin) ; catégories *spéculateurs* (rapport legacy `6dca-aqww`) et *hedge funds / gérants d'actifs / dealers* (rapport TFF `gpe5-46if`, facultatif : s'il ne répond pas, seule la vue spéculateurs s'affiche).
  - **DMX** (Dumb Money indeX) : positionnement des particuliers Myfxbook via `/api/dmx` — barres acheteurs/vendeurs par paire, signal contrarian, indice agrégé par devise. Si la lecture échoue, le widget Myfxbook d'origine s'affiche à la place.
  - **Articles** : flux RSS fusionnés par `/api/news` (FXStreet, ING Think, CNBC, MarketWatch, Fed, BCE, BoE, Google News), complétés par Finnhub quand la clé est réglée ; filtres par **devise** et par **thème** (actions, banques centrales, données macro, taux & obligations, matières premières, géopolitique, crypto), recherche, pastille « nouveau ».
  - **Live TV** : directs YouTube (Bloomberg, Yahoo Finance, CNBC, Reuters, France 24…), ajout de ses propres chaînes (mémorisées sur l'appareil), lecture coupée en quittant la vue.
  - **Marchés** : matrice de performance des 8 devises sur 1 jour / 1 semaine / 1 mois (cours BCE via Frankfurter), détail du Fear & Greed (composantes et historique), tension géopolitique par thème (GDELT via `/api/gdelt`), stocks de pétrole américains et WTI (EIA via FRED, `/api/rates`), prédictions Polymarket via `/api/polymarket` (Fed, économie, géopolitique ; `?debug=1` montre quelles rubriques répondent) et **Brief IA**.
- **Routes du Worker** (`worker.js` + `api-lib.mjs`, aucune clé dans le dépôt) : `/api/feargreed`, `/api/news`, `/api/polymarket`, `/api/calendar`, `/api/history?asset=btc|spx|ndx|xau` (`&debug=1` : sources essayées), `/api/econ?q=AAAAQn` (chiffres publiés d'un trimestre ; tranches recoupées si le calendrier les tronque), `/api/macro` (`?debug=1` : intitulés du calendrier et titres PMI retenus ; calendrier TradingView lu par tranches de 15 jours, PMI S&P Global / HCOB repris des titres de presse via Google News), `/api/rates`, `/api/gdelt`, `/api/dmx` (`?debug=1` montre ce que le widget renvoie). L'API officielle Myfxbook est facultative : identifiants à poser soi-même comme **secrets du Worker** dans Cloudflare (`MYFXBOOK_EMAIL`, `MYFXBOOK_PASSWORD`), jamais dans un fichier.

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
