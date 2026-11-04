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

---

## 7. Web Push Serveur (APNs Apple) & Notifications Écran Verrouillé

- **Protocole Web Push natif (VAPID)** :
  - Clés VAPID persistantes générées et sauvegardées dans `~/.agy-console/vapid-keys.json`.
  - Intégration conforme aux exigences strictes d'Apple APNs (`web.push.apple.com`).
  - Déclenchement automatique par le serveur PC lors de la fin de tâche ou d'erreur.
  - Aperçu textuel réel de la réponse directement affiché dans la notification sur l'écran verrouillé.

---

## 8. Gestionnaire de Fichiers Avancé & Export ZIP en 1 Clic (Pack 2)

- **Export ZIP complet (`/api/zip`)** :
  - Génération d'archives zip compressées à la volée via `tar.exe` (libarchive/zlib) en excluant automatiquement `.git` et `node_modules`.
  - Bouton direct dans l'en-tête des fichiers du projet.
- **Opérations arborescence complètes** :
  - Création de sous-dossiers (`/api/folder/create`).
  - Renommage instantané de fichiers et dossiers (`/api/file/rename`).
  - Suppression sécurisée avec confirmation (`/api/file/delete`).
- **Éradication des emojis** :
  - Remplacement de l'ensemble des emojis par des icônes vectorielles SVG fines et harmonisées.

---

## 9. Résolution du Bug de Streaming (`agent_response`) & Watchdog Anti-Gel

- **Prise en charge du nouveau format de flux `agent_response`** :
  - Correction de `server.js` pour capturer tous les deltas de texte `su.text_delta` et forcer l'injection de `res.response`, éliminant le bug du message vide ou bloqué sur « Tâche terminée avec succès ».
- **Keep-Alive SSE & Watchdog parallèle** :
  - Envoi automatique de pings toutes les 12 secondes sur le flux SSE pour interdire la déconnexion par timeout 4G / Cloudflare.
  - Polling de secours actif dès le lancement d'une tâche pour rafraîchir l'interface même si la connexion réseau est instable.

