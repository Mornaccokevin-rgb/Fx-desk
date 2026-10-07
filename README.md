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
Terminal macro temps réel sur **9 devises** (USD, EUR, GBP, JPY, CHF, AUD, NZD, CAD, CNH).

- Note globale **/100** par devise (> 50 = biais acheteur).
- 4 piliers : **croissance · inflation · politique monétaire · géopolitique**.
- **News Feed** live (Finnhub) avec auto-refresh toutes les 15 min + rafraîchissement manuel.
- Rang de force relative, biais, driver dominant et thèses (semaine actuelle / à venir / le mois) : lus **en direct** depuis la page Notion « Biais & Force Relative » via le Cloudflare Worker `cloudflare-worker/notion-worker.js` — zéro donnée en dur, zéro API payante.
- Les 4 piliers /100 par devise sont un **jugement** porté par Claude sur les pages Notion (Biais & Force Relative + Track Record Fondamental), écrit dans Firestore (collection `macroCompass`) à la demande de Kevin (« mets à jour le macro compass »), puis lu en direct par le site. Claude prépare un fichier `macro-compass-AAAA-MM-JJ.json`, qu'un rédacteur publie avec le bouton **📥 Importer une mise à jour** du Macro Compass. Affichage **N/A** si une devise n'est pas encore couverte — jamais de donnée périmée déguisée en live.

### 🧠 Daily FX
- Synthèses macro post-annonces (rédacteurs), avec tags gérables et historique par semaine.
- **Rapports journaliers PDF** : un rédacteur publie un PDF (12 Mo max), les membres l'ouvrent depuis une carte dans une fenêtre au fond flouté. Stockage Firestore `dailyReports` (+ sous-collection `chunks`), affichage via PDF.js.

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
Journal de trading complet, synchronisé via **Firebase**.

- Dashboard : statistiques, win rate, courbe de capital, drawdown.
- Suivi du capital et de l'équité.
- Historique détaillé des trades, édition en place.

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
