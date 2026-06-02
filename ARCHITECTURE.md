# ARCHITECTURE — TV2026

Fondations posées par **electron-architect** (Étape 0). Ce document décrit la
structure, les contrats partagés (IPC, schéma SQLite, ConnectionLock) et la
manière dont chaque autre agent vient s'y brancher. **Les contrats du dossier
`src/shared/` sont la source de vérité** — ne les dupliquez pas ailleurs.

## Stack

- Electron + **electron-vite** (Electron + Vite + React + TS)
- React 19 + TailwindCSS (renderer)
- better-sqlite3 (store local), undici (HTTP, à venir), mpv (lecture, à venir)
- electron-builder → Windows (NSIS .exe + portable). Dev sous WSL2.

## Arborescence

```
tv2026/
├── electron.vite.config.ts      # build des 3 process (main/preload/renderer)
├── electron-builder.yml         # packaging Windows (NSIS + portable)
├── tsconfig*.json               # base (strict) + node + web
├── tailwind.config.cjs, postcss.config.cjs, .eslintrc.cjs, .prettierrc.json
├── resources/bin/win/           # emplacement du binaire mpv Windows (à fournir)
├── build/                       # ressources electron-builder (icônes, etc.)
└── src/
    ├── shared/                  # ★ SOURCE DE VÉRITÉ (types + contrats IPC)
    │   ├── types/{common,settings,catalog,downloads,player}.ts
    │   ├── ipc/{channels,contract,api}.ts
    │   └── index.ts             # barrel: import depuis '@shared/index'
    ├── main/                    # process principal Node
    │   ├── index.ts             # entrée: fenêtre, sécurité, cycle de vie
    │   ├── ipc/{handlers,register,validate}.ts
    │   ├── store/{db,schema,settingsRepo,catalogRepo,downloadsRepo,index}.ts
    │   ├── secrets/credentials.ts   # safeStorage (identifiants chiffrés)
    │   └── lock/ConnectionLock.ts   # verrou 1 connexion
    ├── preload/                 # pont contextBridge
    │   ├── index.ts             # expose window.api (typé)
    │   └── index.d.ts           # déclaration globale Window.api
    └── renderer/                # UI React + Tailwind
        ├── index.html
        └── src/{main.tsx,App.tsx,env.d.ts,assets/main.css}
```

Alias TS/Vite : `@shared/*` → `src/shared/*`, `@main/*`, `@renderer/*`.

## Contrat IPC

Tout passe par `window.api` (exposé en preload) → `ipcRenderer.invoke` →
`ipcMain.handle`. **Aucune** réponse n'est levée en exception au travers du pont :
chaque handler renvoie un `Result<T>` (`{ ok: true, data } | { ok: false, error }`),
ce qui force le renderer à traiter les erreurs de façon typée.

Sources :
- `src/shared/ipc/channels.ts` — noms des canaux (`InvokeChannels`, `EventChannels`).
- `src/shared/ipc/contract.ts` — `IpcContract` (req/réponse par canal), `EventContract`
  (payload par canal d'évènement), et le type d'aide `IpcHandlers`.
- `src/shared/ipc/api.ts` — `RendererApi` : la surface ergonomique de `window.api`.

### Canaux invoke (req → réponse, tous emballés en `Result<…>`)

| Domaine | `window.api.*` | Canal | Requête | Réponse |
|---|---|---|---|---|
| App | `app.info()` | `app:info` | — | `AppInfo` (`{ version }`) |
| Connexion | `connection.test()` | `connection:test` | — | `ConnectionTestResult` |
| Connexion | `connection.getCredentials()` | `credentials:get` | — | `CredentialsStatus` |
| Connexion | `connection.setCredentials(c)` | `credentials:set` | `XtreamCredentials` | `CredentialsStatus` |
| Connexion | `connection.clearCredentials()` | `credentials:clear` | — | `CredentialsStatus` |
| Réglages | `settings.get()` | `settings:get` | — | `AppSettings` |
| Réglages | `settings.set(p)` | `settings:set` | `Partial<AppSettings>` | `AppSettings` |
| Réglages | `settings.pickDownloadDir()` | `settings:pickDownloadDir` | — | `{ path: string \| null }` |
| Catalogue | `catalog.listCategories()` | `catalog:listCategories` | — | `VodCategory[]` |
| Catalogue | `catalog.listStreams(r)` | `catalog:listStreams` | `ListStreamsRequest` | `Page<VodStream>` |
| Catalogue | `catalog.getInfo(id)` | `catalog:getInfo` | `{ streamId }` | `VodInfo` |
| Catalogue | `catalog.search(r)` | `catalog:search` | `SearchRequest` | `Page<VodStream>` |
| Catalogue | `catalog.refresh(r)` | `catalog:refresh` | `RefreshCatalogRequest` | `RefreshCatalogResult` |
| Téléch. | `downloads.add(r)` | `download:add` | `AddDownloadRequest` | `DownloadItem` |
| Téléch. | `downloads.list()` | `download:list` | — | `DownloadItem[]` |
| Téléch. | `downloads.pause(id)` | `download:pause` | `{ id }` | `DownloadItem` |
| Téléch. | `downloads.resume(id)` | `download:resume` | `{ id }` | `DownloadItem` |
| Téléch. | `downloads.cancel(id)` | `download:cancel` | `{ id }` | `DownloadItem` |
| Téléch. | `downloads.reorder(r)` | `download:reorder` | `ReorderQueueRequest` | `DownloadItem[]` |
| Téléch. | `downloads.clearCompleted()` | `download:clearCompleted` | — | `{ removed: number }` |
| Téléch. | `downloads.localPath(streamId)` | `download:localPath` | `{ streamId }` | `LocalPathResult` (`{ path: string \| null }`) |
| Lecture | `player.play(r)` | `player:play` | `PlayRequest` | `PlayerStatus` |
| Lecture | `player.pause()` | `player:pause` | — | `PlayerStatus` |
| Lecture | `player.resume()` | `player:resume` | — | `PlayerStatus` |
| Lecture | `player.stop()` | `player:stop` | — | `PlayerStatus` |
| Lecture | `player.seek(r)` | `player:seek` | `SeekRequest` | `PlayerStatus` |
| Lecture | `player.setVolume(r)` | `player:volume` | `VolumeRequest` | `PlayerStatus` |
| Lecture | `player.setFullscreen(r)` | `player:fullscreen` | `FullscreenRequest` | `PlayerStatus` |
| Lecture | `player.status()` | `player:status` | — | `PlayerStatus` |

### Canaux d'évènements (main → renderer, un seul sens)

| `window.api.*` | Canal | Payload |
|---|---|---|
| `downloads.onProgress(cb)` | `event:download:progress` | `DownloadProgressEvent` |
| `downloads.onState(cb)` | `event:download:state` | `DownloadStateEvent` |
| `player.onPosition(cb)` | `event:player:position` | `PlayerPositionEvent` |
| `player.onState(cb)` | `event:player:state` | `PlayerStateEvent` |
| `connectionLock.onBusyChange(cb)` | `event:connection:busy` | `{ busy: boolean; reason: 'download'\|'playback'\|null }` |

Chaque `on*` renvoie une fonction `Unsubscribe`. Le preload n'autorise QUE les
canaux listés dans `ALL_EVENT_CHANNELS` (allowlist).

### Comment se brancher (côté main)

1. Implémentez votre domaine dans un module `src/main/<domaine>/`.
2. Remplacez le stub correspondant dans `src/main/ipc/handlers.ts` : la fonction
   reçoit la requête (validez-la via `src/main/ipc/validate.ts`) et renvoie
   `ok(data)` ou `err(code, message)`.
3. Pour pousser des évènements, récupérez l'émetteur typé via
   `makeEmitter(getWindows)` dans `register.ts` et appelez
   `emit(EventChannels.X, payload)`.
4. N'ajoutez jamais de `ipcMain.handle` ad-hoc : tout passe par la table `handlers`.

## Store SQLite

- Connexion unique partagée (`src/main/store/db.ts`), WAL + `foreign_keys = ON`.
- Migrations ordonnées dans `schema.ts`, suivies par le PRAGMA `user_version`.
  Pour faire évoluer le schéma : **ajoutez** une migration, n'en modifiez jamais une appliquée.
- **Tout le SQL vit dans `store/`** ; les autres modules appellent les repos typés
  (`import { catalogRepo, downloadsRepo, settingsRepo } from '../store'`).

### Tables (colonnes clés)

| Table | Colonnes clés | Rôle |
|---|---|---|
| `settings` | `key TEXT PK`, `value TEXT` (JSON) | réglages non-secrets (`AppSettings`) |
| `vod_categories` | `category_id TEXT PK`, `category_name`, `parent_id`, `updated_at` | cache catégories |
| `vod_streams` | `stream_id INTEGER PK`, `name`, `stream_icon`, `rating`, `container_extension`, `category_id (FK)`, `year`, `added_at`, `updated_at` | cache films (≈26k lignes, index nom/catégorie/date) |
| `vod_info_cache` | `stream_id PK (FK)`, `info_json TEXT`, `fetched_at` | détail `get_vod_info` sérialisé |
| `download_queue` | `id PK AUTOINC`, `stream_id`, `name`, `file_name`, `dest_path`, `container_extension`, `status`, `total_bytes`, `received_bytes`, `queue_position`, `error`, `created_at`, `updated_at` | file persistante |
| `download_history` | `id PK AUTOINC`, `stream_id`, `name`, `file_name`, `dest_path`, `total_bytes`, `status`, `completed_at` | terminés/annulés (+ flag « déjà téléchargé ») |

Repos disponibles :
- `settingsRepo.getSettings()/setSettings(patch)` (les champs verrouillés par la
  contrainte 1-connexion sont re-forcés : `maxConcurrentDownloads=1`, `pauseDownloadsWhilePlaying=true`).
- `catalogRepo.upsertCategories/upsertStreams/cacheVodInfo`,
  `listCategories/listStreams/searchStreams/getStream/getCachedVodInfo/catalogCounts`.
- `downloadsRepo.addDownload/getDownload/listDownloads/updateStatus/updateProgress/`
  `reorder/archiveToHistory/clearFinished/isDownloaded/reconcileOnStartup`.

## Secrets (identifiants Xtream)

`src/main/secrets/credentials.ts` — chiffrement via Electron **safeStorage**.
- Le mot de passe est chiffré (clé OS) et écrit en blob base64 dans
  `userData/credentials.json` (mode 0600). `baseUrl`/`username` y sont en clair.
- **Jamais** en SQLite, **jamais** dans les logs.
- `getCredentials()` (déchiffré) est réservé au **main** — ne le passez **pas** par IPC.
  Le renderer ne voit que `CredentialsStatus` (booléens + baseUrl/username).
- API : `setCredentials`, `getCredentials`, `clearCredentials`,
  `getCredentialsStatus`, `isEncryptionAvailable`.

## ConnectionLock (limite 1 connexion)

`src/main/lock/ConnectionLock.ts` — singleton `connectionLock`. Mutex
non-réentrant + file FIFO. **download-engineer ET mpv-player-integrator doivent
l'utiliser** pour ne jamais ouvrir 2 connexions simultanées vers le fournisseur.

Signature :

```ts
type LockHolder = 'download' | 'playback'           // priorité : playback (2) > download (1)
interface LockToken { readonly id: number; readonly holder: LockHolder }
class LockResetError extends Error {}                // injectée dans les acquire() en attente lors d'un reset()

class ConnectionLock {
  acquire(holder: LockHolder): Promise<LockToken>     // attend si occupé (FIFO) ; rejette LockResetError si reset()
  tryAcquire(holder: LockHolder): LockToken | null     // non bloquant
  release(token: LockToken): void                      // exige le token d'acquire
  isBusy(): boolean
  current(): LockHolder | null
  get waiting(): number
  reset(): void                                        // arrêt propre : rejette TOUS les waiters en attente
  onBusyChange(cb: (s:{busy:boolean; reason:LockHolder|null}) => void): () => void
  onPreemptRequested(cb: (holderToYield: LockHolder) => void): () => void   // signal de préemption
}
export const connectionLock: ConnectionLock
```

**Convention de priorité — `playback` > `download`.** La lecture prime toujours
sur le téléchargement.

**Préemption (B1 — bug corrigé).** La file FIFO seule est *passive* : un waiter
attend que le détenteur courant relâche. Mais le DownloadManager n'observe que
`onBusyChange` (déclenché sur changement de `heldBy`) ; sans signal il ne
saurait jamais qu'une lecture attend derrière lui → la lecture resterait bloquée
indéfiniment. Le verrou émet donc un **signal de préemption explicite** :

- Quand `acquire('playback')` est appelé alors qu'un `download` détient le
  verrou, le lock invoque `onPreemptRequested` listeners avec le holder à céder
  (`'download'`) **au moment de l'enqueue**, avant de renvoyer la promesse en
  attente.
- Le DownloadManager s'abonne via `onPreemptRequested((yield_) => …)` : à
  réception du signal il **interrompt/met en pause** le transfert actif puis
  `release()` son token. Ce `release()` transmet le verrou (FIFO) à la lecture
  en attente, qui voit alors sa promesse `acquire('playback')` se résoudre.
- `onPreemptRequested` renvoie une fonction de désabonnement. Le callback peut
  être asynchrone côté abonné ; le lock n'attend pas — il a juste émis le signal.

**Rejet propre sur `reset()` (C1).** À l'arrêt (`before-quit`), `reset()` vide la
file et **rejette** chaque `acquire()` en attente avec `LockResetError`. Les
appelants (p.ex. `PlayerController`) doivent attraper ce rejet et passer en état
erreur plutôt que rester bloqués. L'état busy est diffusé au renderer via
`event:connection:busy` (câblé dans `register.ts`).

Utilisation type :
```ts
// détenteur de la connexion (download/playback) :
const token = await connectionLock.acquire('playback')
try { /* utiliser la connexion unique */ }
finally { connectionLock.release(token) }

// download-engineer, pour honorer la préemption par la lecture :
const off = connectionLock.onPreemptRequested(async (yield_) => {
  if (yield_ === 'download') { await stopActiveTransfer(); connectionLock.release(myToken) }
})
```

## Sécurité Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP restrictive posée par en-têtes (main `index.ts`) **et** balise meta (renderer).
  `script-src 'self'`, `img-src` autorise http(s)+data (posters), `object-src 'none'`.
- Validation de toutes les entrées IPC (`src/main/ipc/validate.ts`) ; le wrapper
  de `register.ts` mappe `ValidationError → INVALID_INPUT` et tout le reste → `UNKNOWN`.
- Navigation externe refusée (`will-navigate` bloqué, `setWindowOpenHandler` → OS).
- Single-instance lock + arrêt propre (`before-quit` : `connectionLock.reset()`,
  désenregistrement IPC, fermeture DB).

## Packaging (Windows)

`electron-builder.yml` → cibles **NSIS** (.exe) + **portable**, x64. Scripts :
`npm run package` (build + electron-builder --win).

- **better-sqlite3 (module natif)** : doit être recompilé pour l'ABI Electron de
  la **cible**, pas pour le Node de WSL2. `postinstall`/`rebuild` lancent
  `electron-builder install-app-deps`. La **construction cross Linux→Windows d'un
  `.node` n'est pas supportée par node-gyp** : lancez `npm run package` sur une
  machine **Windows** (ou un runner CI windows-latest). `asarUnpack` garde le
  `.node` chargeable.
- **mpv** : déposez le build Windows (`mpv.exe` + DLLs) dans `resources/bin/win/`.
  Il est embarqué via `extraResources` sous `resources/bin/` et résolu au runtime
  via `process.resourcesPath + '/bin/mpv.exe'` (`src/main/player/mpvBinary.ts`).
  Ordre de résolution : binaire embarqué (prod : `resources/bin/mpv.exe` ; dev :
  `resources/bin/win/mpv.exe`) **>** `mpv` sur le PATH système. Si rien n'est
  trouvé, le `PlayerController` renvoie un `PlayerStatus` en état `error`
  (« Lecteur mpv introuvable ») — l'UI affiche le message, pas de crash.
  - Téléchargez un build Windows x64 de mpv (p.ex. depuis sourceforge
    `mpv-player/mpv` builds shinchiro) ; copiez `mpv.exe` **et toutes les DLLs**
    de l'archive dans `resources/bin/win/`. electron-builder les copie tels quels
    (`extraResources from: resources/bin/win to: bin`).

## Lecture mpv (PlayerController, Étape 4)

`src/main/player/` — pilote mpv via son **IPC JSON** en direct (`MpvIpc`,
`net.connect` sur le named pipe Windows / socket unix), sans dépendance
`node-mpv` (même code Windows/POSIX, contrôle total du cycle de vie). Un seul
process mpv à la fois.

- **Surface vidéo : fenêtre mpv DÉDIÉE (pas d'embarquage `--wid`).** L'embarquage
  dans le HWND Electron est **non fiable** sous Electron/Windows : le compositeur
  GPU de Chromium repeint toute la fenêtre par-dessus la sous-fenêtre vidéo de
  mpv → **son présent mais image noire**, et une fenêtre mpv embarquée ne peut pas
  passer en plein écran. mpv ouvre donc sa propre fenêtre, avec son OSC
  (`--osc=yes`) et ses raccourcis (`--input-default-bindings=yes` : `f` plein
  écran, `j`/`J` sous-titres, `#` piste audio, clic droit). Args principaux :
  `--force-window=yes --keep-open=yes --idle=yes --autofit=70% --keepaspect=yes
  --hwdec=auto-safe --title=TV2026 — <titre> --sub-auto=fuzzy --network-timeout=30`.
  La zone `#mpv-surface` du renderer n'est plus un cadre vidéo : elle affiche
  « Lecture en cours dans la fenêtre vidéo » + un rappel des raccourcis. Le rendu
  vidéo réel se valide **sur Windows** (pas de GUI/mpv en WSL2).
- **ConnectionLock** : la source `stream` fait `connectionLock.acquire('playback')`
  AVANT d'ouvrir l'URL provider (la file de DL se met alors en pause) ; release à
  l'arrêt/fin/erreur. La source `local` ne prend PAS le verrou (hors-ligne).
- **Évènements** : `event:player:position` (position/durée throttlées 500 ms) et
  `event:player:state` (idle/loading/playing/paused/ended/error) via
  `observe_property` (`time-pos`, `duration`, `pause`, `volume`, `mute`,
  `fullscreen`, `eof-reached`). `fullscreen` agit sur la fenêtre mpv → le bouton
  plein écran de l'app fonctionne.
- **Canaux pistes** (s'ajoutent à play/pause/resume/stop/seek/volume/fullscreen/
  status) : `player:cycleSubtitle` (`['cycle','sub']`), `player:cycleAudio`
  (`['cycle','audio']`), `player:setSubtitleVisible` (`set sub-visibility`). Tous
  renvoient un `PlayerStatus`.
- **Cycle de vie** : kill mpv + release lock sur `stop()`, fin de fichier, erreur,
  fermeture de fenêtre (`closed`) et `before-quit` → jamais d'orphelin.

## Note dev WSL2

L'environnement exporte `ELECTRON_RUN_AS_NODE=1` (via `WSLENV`), ce qui force
Electron à se comporter comme Node (`require('electron')` renvoie un chemin, pas
l'API → crash au démarrage). Les scripts `dev`/`preview`/`start` neutralisent ça
avec `env -u ELECTRON_RUN_AS_NODE`. L'affichage GUI dépend de WSLg ; un avertissement
GPU/network-service au lancement est bénin.

## État actuel (stubs vs réel)

- **Réel** : scaffold, contrats IPC typés, store SQLite (schéma + migrations +
  repos), secrets safeStorage, ConnectionLock, sécurité, lifecycle, settings,
  credentials get/set/clear, dialog choix dossier, file de téléchargement
  persistée (add/list/pause/resume/cancel/reorder/clear), lecture du cache catalogue.
- **Réel (suite)** : lecture mpv (`player:*`) — `PlayerController` pilote mpv via
  IPC JSON, sources `local`/`stream`, events position/state, gestion du
  ConnectionLock et du cycle de vie. La validation **visuelle** (rendu vidéo,
  embarquage `--wid`) reste à faire sur Windows avec un vrai mpv.
- **Stub (`NOT_IMPLEMENTED`)** : (aucun canal player ; tous réels désormais).
