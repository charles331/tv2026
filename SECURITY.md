# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique pour une faille de sécurité.

Utilisez la fonction privée de GitHub : onglet **Security → Report a vulnerability**
(*Private vulnerability reporting*) sur le dépôt.

Merci d'inclure une description, les étapes de reproduction et l'impact estimé.
Une réponse vous sera apportée dès que possible.

## Périmètre

TV2026 est un client de bureau. Points d'attention particuliers :

- **Identifiants Xtream et clé TMDB** : chiffrés via `safeStorage` (clé de l'OS),
  stockés localement, jamais en clair en base ni dans les logs, jamais exposés au
  processus de rendu.
- **Mises à jour de l'application** : distribuées via GitHub Releases
  (`electron-updater`). L'app ne fait que **détecter** les nouvelles versions ;
  le téléchargement puis l'installation (installeur NSIS **visible**) ne sont
  déclenchés que sur **action explicite de l'utilisateur**.
- **Sécurité Electron** : `contextIsolation`, `sandbox`, `nodeIntegration: false`,
  CSP restrictive, navigation externe bloquée.

## Versions supportées

Seule la **dernière version** publiée reçoit des correctifs de sécurité.
