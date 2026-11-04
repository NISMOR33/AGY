# BILAN DES AJOUTS & OPTIMISATIONS — agy-console

Ce document récapitule l'ensemble des fonctionnalités, correctifs et optimisations ajoutés à **agy-console** (Studio Mobile & Desktop pour `agy`).

---

## 1. Ergonomie Mobile & Épuration de l'Interface

- **Zone de saisie fluide et auto-extensible** :
  - Remplacement de l'ancien `<input>` rigide par un `<textarea id="in" rows="1">` avec redimensionnement automatique selon la longueur du prompt.
  - Touche `Entrée` directe sur smartphone/PC pour envoyer sans saut de ligne involontaire (`Shift+Entrée` pour saut de ligne).
- **Suppression du superflu visuel** :
  - Retrait du badge vert fixe « 4G Actif » de la barre supérieure pour libérer l'espace sur petit écran.
  - Retrait des boutons prédéfinis encombrants au-dessus du champ texte (`💬 Discussions`, `📸 Photo`, `📁 @Fichier`, `⚡ /Commandes`).
  - Suppression des cartes d'exemples pré-remplies en haut du chat pour un fil de discussion propre dès l'ouverture.
- **Accès centralisé dans les Paramètres (`⚙️`)** :
  - Le QR Code, le statut du tunnel et la copie des liens d'accès sont désormais rangés dans **Paramètres → 📱 QR Code & Liens d'accès**.
  - Raccourci vers la télémétrie complète directement depuis les réglages.

---

## 2. Suivi Complet des Tokens par Modèle & Fenêtres de Réinitialisation

- **Détection temps réel et multi-modèles** :
  - Analyse en arrière-plan des métriques issues des sessions de travail réelles (`.gemini/antigravity-cli/brain` et `.gemini/antigravity/brain`).
  - Découpage précis pour chaque modèle IA disponible :
    - **Gemini 3.8 Flash** (Low / Medium / High)
    - **Gemini 4 Argon** (Low / Medium / High)
    - **Claude Opus 5.5** (Low / Medium / High)
    - **Claude Sonnet 5.5** (Low / Medium / High)
    - **GPT-OSS 120B** (Medium)
- **Métriques calculées par modèle** :
  - Nombre total de requêtes (`req`) et jauges d'utilisation proportionnelles.
  - Tokens consommés sur la **fenêtre glissante de 5 heures** (gestion fine des quotas).
  - Tokens consommés sur **24h (aujourd'hui)**.
  - Cumul global détaillé : **Prompt (Entrée)**, **Réflexion & Sortie**, **Lecture Cache**.
- **Comptes à rebours de réinitialisation** :
  - **⏱️ Fenêtre Quota (5h)** : calcul dynamique du temps restant avant expiration de la plus ancienne requête de la tranche de 5h (`Dans Xh Ym · Reset à HH:MM` ou `100% dispo`).
  - **🔄 Reset Quotidien (00:00)** : décompte jusqu'à la réinitialisation de minuit.
- **Bouton `↺ Réinitialiser compteur`** :
  - Permet de réinitialiser les compteurs à tout moment sans supprimer l'historique de discussion.

---

## 3. Sauvegarde Multi-Discussions & Persistance Serveur

- **Persistance centrale multi-threads** :
  - Les discussions sont sauvegardées sur le serveur PC dans :
    - `~/.agy-console/conversations/<projet>.json` (stockage global multi-projets).
    - `<projet>/.git/agy-chat-history.json` (sauvegarde locale au projet).
- **Historique préservé** :
  - Le bouton **Nouveau chat** (`/api/chat/new`) crée un nouveau fil de discussion sans écraser les anciennes conversations.
  - Sélecteur de discussions sauvegardées permettant de basculer instantanément d'une session à l'autre avec reprise de l'identifiant `conversationId` d'`agy`.

---

## 4. Stabilité du Moteur d'Exécution `agy` (Anti-Crash)

- **Verrouillage du modèle d'exécution** :
  - Forçage automatique d'un modèle valide (`gemini-3.8-flash-medium` par défaut) lors des appels pour éviter l'erreur bloquante :
    `failed to construct executor: plan model not specified; you must specify a valid model`.
- **Filtrage des erreurs fantômes** :
  - `server.js` nettoie les anciens messages d'erreur persistants renvoyés à tort par `agy` en mode `--conversation` dès lors que la réponse courante a abouti avec succès.
- **Prise en charge de la commande `/compact`** :
  - Quand l'utilisateur tape `/compact`, l'action déclenche un point de contrôle et affiche une confirmation claire (`✅ Contexte de la conversation compacté et sauvegardé.`).
- **Correction du calcul des durées** :
  - Affichage de la durée réelle du tour (ex: `2.8s`) au lieu de l'âge total accumulé de la conversation (`21500s`).

---

## 5. Résilience du Tunnel Cloudflare (Accès 4G / 5G)

- **Processus tunnel découplé sous Windows** :
  - Lancement de `cloudflared.exe` via WMI (`Win32_Process.Create`) en tant que processus autonome rattaché à Windows (`WmiPrvSE.exe`).
  - Conséquence : redémarrer `node server.js` pour appliquer des modifications de code **ne coupe plus le tunnel** et réutilise le PID actif ainsi que la même URL stockée dans `~/.agy-console/tunnel-state.json`.

---

## 6. Aperçu Web Live du Projet (`Preview`)

- **Route backend `/preview/<projet>/<fichier>`** :
  - Permet de charger directement dans l'application n'importe quel fichier HTML/CSS/JS produit par `agy` dans le dossier du projet.
- **Onglet Aperçu intégré** :
  - Sélecteur de page HTML, bouton de rechargement en 1 tap et option d'ouverture plein écran dans un nouvel onglet.

