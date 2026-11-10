# 🏎️ Turbo Party Race

**Turbo Party Race** est un jeu de course multijoueur de soirée (*Party Game* façon *AirConsole* / *Jackbox* / *Micro Machines*) conçu pour être joué jusqu'à **8 joueurs simultanément** :
- **Un écran principal (TV / Ordinateur / Vidéoprojecteur)** affiche le circuit en arène vue de dessus (HTML5 Canvas 60 FPS), le classement en direct, les effets de particules et la musique/effets sonores.
- **Les smartphones des joueurs (iOS Safari & Android Chrome)** servent de **manettes tactiles ultra-réactives** en scannant simplement le QR Code affiché à l'écran — **même en 4G/5G** sans avoir besoin d'être sur le même Wi-Fi lorsque le jeu est hébergé sur le Cloud !

---

## ✨ Fonctionnalités Principales

- 📱 **Connexion Instantanée par QR Code (Wi-Fi ou 4G/5G)** : Scannez le QR Code affiché sur la TV, entrez votre pseudo et votre téléphone se transforme immédiatement en manette de course.
- 📺 **Mode Multi-Écrans / Duplication TV en Direct** : Vous n'êtes pas tous devant la même TV ? Ouvrez l'adresse `/tv?room=CODE` sur une 2e TV, un PC portable ou une tablette : la course est diffusée simultanément à 60 FPS sur tous les écrans connectés !
- 🔄 **Reconnexion Automatique 4G/5G (10 secondes)** : Grâce à un jeton de session persistant (`playerToken`), si un joueur perd brièvement le réseau ou verrouille son écran par erreur, il reprend instantanément le contrôle de sa voiture sans quitter la course.
- 🏎️ **Physique Arcade & Drift façon Mario Kart** :
  - Maintenez **FREIN / DRIFT** dans un virage tout en accélérant pour déraper.
  - Des étincelles **Bleues** puis **Oranges** apparaissent sous vos pneus : relâchez le bouton Drift pour déclencher un **Mini-Turbo** explosif !
- 🎁 **Boîtes à Objets & Bonus de Course** :
  - 🔥 **Nitro** : Boost de vitesse fulgurant avec flammes à l'échappement.
  - 🍌 **Flaque d'Huile** : Déposez un piège glissant derrière vous qui fait partir vos adversaires en tête-à-queue (`spinTimer`).
  - ⚡ **Onde de Choc (Shockwave)** : Déclenche une impulsion électromagnétique qui repousse et ralentit les voitures proches.
- 🤖 **Bots IA Intelligents** : Complétez automatiquement la grille de départ avec des pilotes IA capables de suivre le tracé, de prendre les virages et d'utiliser des objets.
- 🔊 **Synthétiseur Web Audio API 100% Procédural** : Moteur sonore généré en temps réel (vrombissement moteur dynamique, crissements de pneus, bips de départ, explosions, fanfare de victoire et klaxons personnalisés) sans aucun fichier MP3 externe lourd à charger.
- 📳 **Retour Haptique Multi-Plateforme** : Vibrations natives sur Android (`navigator.vibrate`), astuce Taptic Engine sur iOS 17.4+ (`<input type="checkbox" switch>`), flash lumineux et retour audio sur la manette lors des collisions ou du ramassage d'objets.

---

## 🚀 Lancer le jeu en local

### Prérequis
- **Node.js** (version 18 ou supérieure)

### Installation et démarrage

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur en mode développement (rechargement automatique)
npm run dev

# Ou lancer en mode production :
npm start
```

Ouvrez ensuite votre navigateur sur :
- 📺 **Écran TV Principal (Hôte)** : [http://localhost:3000](http://localhost:3000)
- 📺 **2e Écran TV / PC / Tablette (Miroir en direct)** : [http://localhost:3000/tv?room=CODE](http://localhost:3000/tv)
- 📱 **Manette Joueur (Smartphone 4G/5G)** : [http://localhost:3000/play](http://localhost:3000/play)

---

## ☁️ Guide Pas-à-Pas : Déployer gratuitement sur Render via GitHub (en 2 minutes)

En hébergeant **Turbo Party Race** sur **Render.com**, vous obtenez une URL publique sécurisée en `https://` permettant à tous vos amis de rejoindre la partie **directement en 4G/5G** depuis leurs téléphones en scannant le QR Code sur la TV, sans avoir besoin de partager le code Wi-Fi !

### Étape 1 : Envoyer le projet sur GitHub

1. Créez un nouveau dépôt vide sur [GitHub](https://github.com/new) (par exemple `turbo-party-race`).
2. Dans le terminal, à la racine du projet `/Users/paullegall/Desktop/Jox`, exécutez les commandes suivantes :

```bash
git init
git add .
git commit -m "Initial commit - Turbo Party Race"
git branch -M main
git remote add origin https://github.com/PabloZob/turbo-party-race.git
git push -u origin main
```

### Étape 2 : Déployer sur Render.com

Vous avez deux méthodes au choix :

#### Option A : Déploiement automatique avec `render.yaml` (Blueprint)
Le projet inclut déjà un fichier `render.yaml` préconfiguré à la racine :
1. Connectez-vous sur [dashboard.render.com](https://dashboard.render.com/).
2. Cliquez sur **New +** > **Blueprint**.
3. Sélectionnez votre dépôt GitHub `turbo-party-race` et cliquez sur **Apply**.
4. Render configure et démarre automatiquement le serveur !

#### Option B : Déploiement manuel via "New Web Service"
1. Sur [dashboard.render.com](https://dashboard.render.com/), cliquez sur **New +** > **Web Service**.
2. Connectez votre dépôt GitHub `turbo-party-race`.
3. Vérifiez les paramètres suivants :
   - **Environment / Runtime** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : `Free`
4. Cliquez sur **Create Web Service**.

### Étape 3 : Jouer en soirée !

Une fois le déploiement terminé (environ 1 minute), Render vous donne une adresse du type :
`https://turbo-party-race.onrender.com`

1. Ouvrez cette URL sur l'ordinateur branché à la **TV** et cliquez sur **Créer un Salon**.
2. **QR Code Automatique en `https://`** : Le serveur détecte automatiquement l'en-tête `x-forwarded-proto` de Render (`app.set('trust proxy', 1)`) et génère un QR Code pointant directement vers `https://votre-app.onrender.com/play?room=XXXX`.
3. **Système Keep-Alive Anti-Veille intégré** : L'offre gratuite de Render met normalement les serveurs en veille après 15 minutes d'inactivité HTTP. Pour éviter toute coupure pendant vos soirées (où tout passe par WebSockets), l'écran TV envoie automatiquement un ping HTTP léger vers `/api/ping` toutes les **30 secondes**, gardant le serveur Render éveillé en permanence tant que la page TV est ouverte !

---

## 📁 Structure du Projet

```text
├── package.json          # Dépendances et scripts (npm start, npm run dev)
├── tsconfig.json         # Configuration TypeScript
├── render.yaml           # Configuration de déploiement Cloud Render.com
├── src/
│   └── server.ts         # Serveur Express + Socket.io + Tolérance pannes 4G/5G
└── public/
    ├── host.html         # Écran Principal TV / Hôte (/ ou /host)
    ├── play.html         # Écran Manette Mobile (/play — iOS Safari & Android Chrome)
    ├── css/
    │   ├── host.css      # Styles néon arcade de l'écran TV
    │   └── play.css      # Styles ergonomiques et verrouillage tactile de la manette
    └── js/
        ├── host.js       # Rendu Canvas 2D 60 FPS, physique, bots IA et Web Audio API (TV)
        └── play.js       # Gestion multi-touch, télémétrie temps réel et haptique (Mobile)
```
