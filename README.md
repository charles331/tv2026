# TV2026

Application de bureau (**Windows**) pour parcourir, **télécharger** et lire les films
à la demande (VOD) d'un abonnement **IPTV de type Xtream Codes**.

Conçue autour d'un besoin simple : pouvoir **télécharger un film** pour le regarder
hors-ligne, plutôt que de dépendre du streaming.

> Construite avec Electron + React + TypeScript. Voir [`PLAN.md`](PLAN.md) et
> [`ARCHITECTURE.md`](ARCHITECTURE.md) pour les détails techniques.

---

## ⚠️ Avertissement & responsabilité

**À lire avant toute utilisation.**

- **Logiciel fourni « EN L'ÉTAT », sans aucune garantie**, conformément à la
  [licence MIT](LICENSE). L'auteur **décline toute responsabilité** quant à
  l'utilisation qui en est faite et aux éventuels dommages directs ou indirects.
- **TV2026 est un simple client générique.** Il n'héberge, ne fournit, ne distribue
  et n'inclut **aucun contenu vidéo**, **aucun flux**, **aucun identifiant** et
  **aucun abonnement**. C'est l'équivalent d'un lecteur multimédia : il se connecte
  à un service que **vous** fournissez et configurez vous-même.
- **L'utilisateur est seul et entièrement responsable** de son usage. Il lui
  appartient de disposer d'un **abonnement valide et légal** et de **tous les droits
  nécessaires** sur les contenus auxquels il accède, qu'il visionne ou qu'il
  télécharge.
- **Usage strictement personnel et privé.** L'utilisateur doit respecter les lois
  applicables dans sa juridiction, ainsi que le droit d'auteur et les conditions
  d'utilisation de son fournisseur.
- **Aucune affiliation.** Ce projet n'est lié, parrainé ni approuvé par aucun
  fournisseur IPTV, ni par les projets Xtream Codes, mpv ou Electron.

*Ce texte n'est pas un avis juridique. En cas de doute sur la légalité d'un usage,
consultez un professionnel du droit.*

---

## Fonctionnalités

- 🔐 Connexion à un panel Xtream Codes (identifiants **chiffrés** localement, jamais
  stockés en clair).
- 🎬 Catalogue VOD navigable : catégories, recherche, posters, fiches détaillées
  (synopsis, note, bande-annonce).
- ⬇️ **Téléchargement de films** : file d'attente, **reprise après coupure**,
  progression en temps réel (vitesse / ETA), nommage propre des fichiers.
- ▶️ Lecture intégrée via **mpv** (lit le fichier téléchargé hors-ligne, ou en
  streaming direct).
- 🔄 **Mise à jour automatique** de l'application (via GitHub Releases).

> ℹ️ **Contrainte importante** : la plupart des abonnements n'autorisent
> **qu'une seule connexion simultanée**. L'app en tient compte : les
> téléchargements sont **séquentiels** et se **mettent en pause pendant la lecture
> en streaming** (la lecture d'un fichier déjà téléchargé, elle, n'utilise pas de
> connexion).

---

## Installation (utilisateur)

1. Ouvrez la page **[Releases](https://github.com/charles331/tv2026/releases)** du dépôt.
2. Téléchargez l'installeur **`TV2026-<version>-x64.exe`**.
3. Lancez-le. Windows peut afficher un avertissement **SmartScreen** (l'application
   n'est pas signée) → **« Informations complémentaires »** puis
   **« Exécuter quand même »**.
4. Suivez l'installation (un raccourci bureau est créé).

> Une version **portable** (`...-portable.exe`) est aussi fournie : elle se lance
> sans installation, **mais ne bénéficie pas de la mise à jour automatique**.

**Premier lancement** : *Réglages* → saisir l'URL et les identifiants du fournisseur
→ *Tester la connexion* → *Rafraîchir le catalogue* → parcourir et télécharger.

### Mise à jour

Avec l'installeur, les mises à jour sont **automatiques** : l'app vérifie au
démarrage (et périodiquement) s'il existe une version plus récente sur GitHub
Releases, la télécharge en arrière-plan, et l'installe à la prochaine fermeture.

---

## Compilation depuis les sources

> La cible est **Windows**. `better-sqlite3` est un module natif qui doit être
> compilé pour Windows : **on ne peut pas produire le `.exe` depuis Linux/WSL2**.

### Option A — via GitHub Actions (recommandé, automatique)

Les Releases sont **entièrement automatisées** par
[`.github/workflows/release.yml`](.github/workflows/release.yml) (semantic-release).
À chaque **fusion sur `main`**, les messages de commit ([Conventional
Commits](https://www.conventionalcommits.org/)) déterminent la prochaine version
(semver), l'installeur Windows est construit, et une **Release GitHub publiée**
automatiquement (avec notes de version + `latest.yml` pour l'auto-MAJ).

| Préfixe de commit | Effet sur la version |
|---|---|
| `fix:` / `perf:` / `docs:` / `chore:` … | **patch** (0.1.1 → 0.1.2) |
| `feat:` | **minor** (0.1.1 → 0.2.0) |
| `feat!:` ou `BREAKING CHANGE:` | **major** (0.1.1 → 1.0.0) |

> Aucun `git tag` ni bump manuel de `package.json` : tout est piloté par les commits.

> 🛡️ **Garde-fou.** [`pr-title.yml`](.github/workflows/pr-title.yml) valide que le
> **titre de chaque PR** respecte la convention. **Fusionnez en _squash_** : le
> titre de la PR devient alors le commit lu par semantic-release. Pour bloquer la
> fusion d'un titre non conforme, exigez ce check dans *Settings → Branches →
> Branch protection*.

Un build de test **sans publication** (artefact téléchargeable) reste possible via
[`build-windows.yml`](.github/workflows/build-windows.yml) → onglet
**Actions → Build Windows (manuel) → Run workflow**.

### Option B — sur une machine Windows

Prérequis : **Node.js 22**, **Python 3**, **Visual Studio Build Tools** (workload
« Développement Desktop en C++ »).

```powershell
pnpm install          # recompile better-sqlite3 pour l'ABI Electron
pnpm run build
pnpm run package      # produit release/TV2026-<version>-x64.exe
```

Pour la lecture vidéo, déposez un build **mpv Windows x64** (`mpv.exe` + DLL) dans
`resources/bin/win/` avant `pnpm run package` (le CI le fait automatiquement).

---

## Développement (sous WSL2)

```bash
pnpm install
pnpm run dev        # lance l'app en mode dev (GUI via WSLg)
pnpm run typecheck  # vérification TypeScript
pnpm run lint       # ESLint
```

> Quirk WSL2 : les scripts neutralisent `ELECTRON_RUN_AS_NODE` (`env -u`) pour
> qu'Electron démarre correctement.

---

## Pile technique

| Couche | Technologie |
|---|---|
| Shell desktop | Electron + electron-vite |
| Interface | React + TypeScript + TailwindCSS |
| Données locales | SQLite (better-sqlite3) |
| Réseau | undici |
| Lecture vidéo | mpv |
| Packaging / MAJ | electron-builder + electron-updater |

Architecture détaillée : [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Licence

Distribué sous licence **MIT**. Voir [`LICENSE`](LICENSE).
