# AGY pour iPhone

L'application iOS est un conteneur natif de la console AGY existante. Elle ne
remplace pas le site : le navigateur et l'application peuvent utiliser le même
serveur Node simultanément, avec les mêmes projets, conversations et fichiers.

## Fonctionnement

- écran SwiftUI de connexion à l'URL du serveur AGY ;
- code d'accès conservé dans le trousseau sécurisé iOS (Keychain) ;
- console complète chargée dans `WKWebView` : chat en streaming, projets,
  fichiers, terminal, Git, réglages et aperçus ;
- IPA non signé compilé par GitHub Actions puis resigné par Sideloadly.

## Installation

1. Lancer le workflow **Build iOS Dynamic Island (.ipa)** ou pousser une
   modification de `ios-island/` sur `main`.
2. Télécharger l'artifact `agy-island-ios-ipa`.
3. Extraire `agy-island.ipa`, puis l'installer avec Sideloadly.
4. Dans l'app, saisir l'URL HTTPS Cloudflare du serveur et le code d'accès AGY.

Le serveur doit rester démarré pour utiliser l'application.
