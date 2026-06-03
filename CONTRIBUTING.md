# Contribuer à TV2026

Merci de votre intérêt ! Quelques règles permettent de garder le projet sain et
les releases automatiques fonctionnelles.

## Développement

```bash
pnpm install
pnpm run dev          # app en mode dev (WSLg sous WSL2)
pnpm run typecheck    # TypeScript
pnpm run lint         # ESLint (0 warning toléré)
pnpm test             # Vitest
```

> La cible de packaging est **Windows** (`better-sqlite3` est natif ; le `.exe`
> se construit via le workflow GitHub Actions ou sur une machine Windows).

Avant d'ouvrir une PR, assurez-vous que **`typecheck`, `lint` et `test` passent**
(la CI les exécute de toute façon).

## ⚠️ Convention de commits / titres de PR (obligatoire)

Les versions sont publiées **automatiquement** par *semantic-release* à partir
des messages, via le **titre de la pull request** (fusion en **squash**). Le
titre de PR **doit** suivre les [Conventional Commits](https://www.conventionalcommits.org/) :

```
type(scope optionnel): sujet en minuscule, sans point final
```

Types acceptés : `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`,
`build`, `ci`, `chore`, `revert`.

Effet sur la version : `feat` → mineure, `fix`/autres → patch, `feat!:` ou
`BREAKING CHANGE:` → majeure.

Un workflow (**« Valider le titre de la PR »**) bloque les titres non conformes.

## Processus

1. Créez une branche (`feat/...`, `fix/...`).
2. Codez + ajoutez/maintenez les tests.
3. Ouvrez une PR vers `main` avec un **titre conventionnel**.
4. Fusion en **squash** une fois les checks au vert.

## Périmètre & contenu

TV2026 est un **client générique** : il n'héberge ni ne fournit aucun contenu.
Les contributions ne doivent inclure **aucun identifiant**, **aucune URL de
fournisseur réel**, ni aucun contenu sous droits.
