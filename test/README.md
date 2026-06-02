# Tests unitaires — TV2026

Suite de tests **Vitest** ciblant la **logique pure** de l'application. Ces tests
sont volontairement indépendants des modules à dépendances natives ou Electron
(`better-sqlite3`, `electron`, le réseau réel) : `undici` est **mocké** là où
nécessaire. La suite tourne donc **partout** (Linux/WSL2, CI) sans recompilation
native.

## Lancer

```bash
pnpm install        # met à jour le lockfile (ajoute vitest)
pnpm test           # exécution unique
pnpm test:watch     # mode watch
pnpm test:coverage  # avec couverture v8
```

> ⚠️ Après cette branche, le `pnpm-lock.yaml` doit être régénéré (ajout de
> `vitest` + `@vitest/coverage-v8`). Lancez `pnpm install` une fois et committez
> le lockfile mis à jour si vous utilisez `--frozen-lockfile` en CI.

## Couverture

| Fichier de test | Cible | Ce qui est vérifié |
|---|---|---|
| `main/ConnectionLock.test.ts` | `src/main/lock/ConnectionLock.ts` | acquire/release, FIFO, `tryAcquire`, garde de token, **préemption playback > download**, `reset()` (rejet `LockResetError`), `onBusyChange`, isolation des listeners |
| `main/validate.test.ts` | `src/main/ipc/validate.ts` | validateurs IPC + **`assertPathWithin`** (anti path-traversal) |
| `main/xtream.test.ts` | `src/main/xtream/XtreamClient.ts` | `maskUrl`, `buildMovieUrl`, coercition string→nombre, `auth:0`/HTTP 512/401/403 → `AUTH_FAILED`, corps malformé → `MALFORMED`, mapping catégories/streams/info (`undici` mocké) |
| `main/downloadHelpers.test.ts` | `src/main/downloads/helpers.ts` | `parseContentRangeTotal` (reprise), `describeError`, `formatBytes`, `partPath`, `headerValue` |
| `renderer/format.test.ts` | `src/renderer/src/lib/format.ts` | formatage octets/vitesse/durée/ETA/%/note/date/trailer (locale fr) |

## Hors périmètre (tests d'intégration, à part)

Ces modules sont fortement couplés à des dépendances natives / runtime et
nécessitent un harnais d'intégration (mocks `better-sqlite3` + `electron`, ou un
vrai environnement) plutôt que des tests unitaires purs :

- **`DownloadManager`** (machine à états de la file, reprise réelle via `Range`) —
  ses **helpers purs** ont été extraits dans `helpers.ts` et sont testés ici ; la
  boucle de file + l'I/O réseau/disque restent à couvrir en intégration (le hook
  `__setTestByteCap` est prévu pour ça).
- **`store/*`** (repos SQLite) — nécessite `better-sqlite3`.
- **`PlayerController` / `mpvIpc`** — nécessite un binaire mpv (validation Windows).
- **`secrets/credentials`** — nécessite `electron.safeStorage`.
