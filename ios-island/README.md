# agy Island — Dynamic Island & Live Activities pour iOS

Ce dossier contient les deux solutions complètes pour bénéficier du **Dynamic Island** (comme l'application Codex) sans posséder de Mac et sans payer les 99$/an d'Apple.

---

## 🟢 Solution A : L'Îlot Web Flottant PiP (0€, 0 Installation, Immédiat)

Déjà intégré directement dans l'interface web `agy-console` :
1. Ouvre ta console `agy` sur Safari iOS (`https://...trycloudflare.com`).
2. Clique sur le nouveau bouton **« Îlot »** dans la barre d'outils du chat.
3. Safari fait apparaître une **pilule flottante Picture-in-Picture** noire OLED qui reste affichée par-dessus toutes tes autres applications iOS !
4. L'îlot affiche en direct :
   - Le statut d'activité d'agy (orange pulsant en réflexion, bleu pendant l'appel d'outils, vert au succès).
   - Le nom du projet actif.
   - Le chronomètre d'exécution en direct.
   - Les actions précises effectuées.

---

## 🍏 Solution B : L'Application Native iOS Swift + ActivityKit (Vrai Dynamic Island Matériel)

Cette solution utilise le matériel physique de l'iPhone (l'encoche Dynamic Island des iPhone 14 Pro, 15, 15 Pro, 16, 16 Pro ainsi que la bannière d'écran verrouillé sur tous les iPhone iOS 16.1+).

### Comment compiler SANS Mac ?
Le workflow GitHub Actions `.github/workflows/build-ios.yml` utilise un serveur Mac virtuel dans le cloud GitHub (gratuit) :
1. Pousse ce code sur ton dépôt GitHub (`git push`).
2. Va dans l'onglet **Actions** sur GitHub : le workflow `Build iOS Dynamic Island (.ipa)` compile automatiquement l'application Swift et génère le fichier `agy-island.ipa`.
3. Télécharge le fichier `agy-island.ipa` sur ton PC Windows.

### Comment installer sur ton iPhone depuis Windows (0€) ?
1. Télécharge **Sideloadly** (gratuit pour Windows) sur [sideloadly.io](https://sideloadly.io).
2. Branche ton iPhone en USB à ton PC Windows (ou connecte-le au même réseau Wi-Fi).
3. Ouvre Sideloadly, glisse le fichier `agy-island.ipa`.
4. Renseigne ton identifiant Apple personnel gratuit (pas besoin de compte développeur payant).
5. Clique sur **Start** : Sideloadly signe l'application et l'installe directement sur l'écran d'accueil de ton iPhone.
6. Sur ton iPhone : va dans *Réglages > Général > Gestion des appareils* et clique sur "Faire confiance à l'application".
7. Lance **agy Island**, entre l'URL de ton serveur Cloudflare, et profite de la vraie Dynamic Island matérielle !
