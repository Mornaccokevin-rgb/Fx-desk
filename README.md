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
- Données OCDE (SDMX), BLS et Finnhub. Affichage **N/A** si une source est indisponible — jamais de donnée périmée déguisée en live.

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
