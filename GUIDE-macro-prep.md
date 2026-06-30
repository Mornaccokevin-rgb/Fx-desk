# Macro Prep — ce qui a été corrigé + à faire de ton côté

## Ce que j'ai modifié dans `index.html`

1. **Anti-écran-noir** — la fonction `openScreen` ne masque plus tous les écrans
   tant qu'elle n'a pas confirmé que l'écran cible existe. Si jamais un module
   pointe vers un id introuvable, on revient au Hub au lieu d'afficher un fond noir.
2. **Init Macro Prep isolée** — le chargement du module est encapsulé : une erreur
   (Firestore, etc.) affiche un message dans l'écran au lieu de le laisser vide.
3. **Message d'erreur lisible** — si Firestore refuse la lecture (règles non
   configurées), l'écran affiche « Accès refusé : règles Firestore à configurer ».

## Le modèle de droits (déjà en place dans le code)

- **Toi + rédacteurs autorisés** : voient le formulaire, peuvent publier / modifier / supprimer.
- **Ton nom** apparaît sur chaque synthèse (préfixe de ton email).
- **Les autres** : aucun formulaire, juste une bannière « lecture seule » et le flux.

La liste des rédacteurs est dans `index.html` :

```js
const MACRO_EDITORS = [
    'mornaccokevin@gmail.com'
    // , 'redacteur2@exemple.com'
];
```

⚠️ Le masquage du formulaire est seulement **cosmétique**. La vraie sécurité
(empêcher quelqu'un d'écrire via la console / l'API) vient des **règles Firestore**.

## À FAIRE : appliquer les règles Firestore (étape essentielle)

C'est probablement aussi ce qui bloque le flux partagé aujourd'hui (base en
« mode verrouillé » = tout refusé par défaut).

1. Va sur https://console.firebase.google.com → projet **journal-de-trading-c79ee**.
2. Menu **Firestore Database**. Si la base n'existe pas encore, clique
   **Créer une base de données** (mode production).
3. Onglet **Règles** (Rules).
4. Remplace tout par le contenu du fichier **`firestore.rules`** (joint).
5. Clique **Publier**.

## Ajouter un rédacteur plus tard

Ajoute son email à **deux endroits** (et garde-les identiques) :
- `MACRO_EDITORS` dans `index.html`
- `editorEmails()` dans `firestore.rules` (puis republier les règles)

## Si l'écran noir persiste

Ouvre la page, fais **Clic droit → Inspecter → Console**, clique sur le module,
et regarde le message en rouge. Envoie-le moi : il pointera la cause exacte.
