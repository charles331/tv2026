# Bibliothèque des fichiers téléchargés — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un onglet « Bibliothèque » qui liste ce qui est sur le disque (films, séries, enregistrements, autres fichiers), le lit en un appui sans passer par le fournisseur, retrouve les fichiers ajoutés à la main et permet de supprimer un fichier (deux confirmations, Corbeille).

**Architecture:** une table `library_items` (migration 10) est la source de vérité, alimentée à la fin d'un téléchargement ou d'un enregistrement, reprise une fois depuis `download_history`, et complétée par un parcours borné du dossier (« Actualiser »). La logique de décision (fichier vidéo ?, nom d'épisode, clé de titre, chemin autorisé, purge) est dans des fonctions pures testées ; le main process expose trois canaux IPC ; le renderer ajoute un écran construit avec les primitives télécommande existantes.

**Tech Stack:** Electron 44, electron-vite, React 19, TypeScript, Tailwind 4, better-sqlite3, vitest, Playwright `_electron` (e2e avec le faux fournisseur).

**Spec:** `docs/superpowers/specs/2026-11-24-bibliotheque-design.md`

## Global Constraints

- Commandes : `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` puis `corepack pnpm@9.15.9 <typecheck|lint|vitest run|test:e2e>` ; e2e avec `DISPLAY=:0`.
- Branche `feat/bibliotheque` (déjà créée, porte la conception). Messages de commit en français, préfixes conventionnels ; titre de PR conventionnel ; corps de PR avec une section `## Nouveautés` (puces pour l'utilisateur).
- Fusion uniquement sur « fusionne la #NN » de l'utilisateur. Ne jamais tester contre le vrai fournisseur.
- Extensions vidéo, exactement : `.mkv .mp4 .avi .m4v .mov .ts .webm .wmv .mpg .mpeg`. Taille minimale : 1 000 000 octets. `.part` ignorés.
- Sous-dossiers : `Films`, `Séries`, `Live` (`downloadSubfolder`, `src/main/downloads/helpers.ts`) + racine du dossier.
- Clés de progression : film → `('movie', streamId)`, épisode → `('series', episodeId)`. Enregistrements et autres fichiers : **pas de reprise** (pas de `streamId` envoyé au lecteur).
- Noms affichés via `displayName` (`src/shared/displayName.ts`).
- Suppression : toujours `shell.trashItem` ; si elle échoue, **aucune** suppression définitive.
- Télécommande : chaque surcouche = `FocusZone boundary` + `useReturnFocus()` + `useBackHandler(fermer)` + sélection initiale explicite (voir `src/renderer/src/lib/remote/focus.tsx`).

## Review Focus

1. **Disque débranché / dossier introuvable** : ouvrir la Bibliothèque ou Actualiser ne retire rien, un bandeau le dit. → test `shouldPrune` (Task 1) + parcours de `scanLibrary` sur un dossier absent (Task 4).
2. **Double appui distrait sur OK pendant une suppression** : la 2e confirmation s'ouvre avec « Annuler » sélectionné, un OK de plus annule. → e2e Task 7.
3. **Lien symbolique ou chemin qui sort du dossier lors d'Actualiser** : jamais suivi, jamais ajouté. → test `listVideoFiles` avec un lien symbolique (Task 4).
4. **Dossier de téléchargement changé dans les Réglages** : les anciennes entrées restent lisibles et supprimables, un chemin inconnu hors du dossier reste refusé. → test `isAllowedLibraryPath` (Task 1).
5. **Fichier ajouté à la main au titre ambigu (deux films du catalogue)** : rangé en « Autres fichiers », jamais avec la mauvaise affiche. → test de `matchMovie` dans Task 4.

---

### Task 1: Logique pure de la bibliothèque

**Files:**
- Create: `src/main/library/libraryLogic.ts`
- Test: `test/main/libraryLogic.test.ts`

**Interfaces:**
- Produces :
  - `VIDEO_EXTENSIONS: ReadonlySet<string>` ; `MIN_VIDEO_BYTES = 1_000_000`
  - `isLibraryVideo(fileName: string, sizeBytes: number): boolean`
  - `parseEpisodeName(name: string): { series: string; season: number; episode: number } | null`
  - `movieTitleKey(fileName: string): { key: string; year: number | null }` — sans extension, sans préfixe FR (`displayName`), `.`/`_` → espaces, année `(AAAA)` retirée et rendue à part, puis `normalizeForSearch` (`src/main/store/searchText.ts`).
  - `shouldPrune(fileExists: boolean, folderExists: boolean): boolean`
  - `isAllowedLibraryPath(filePath: string, downloadDir: string | null, knownPaths: ReadonlySet<string>): boolean` — vrai si le chemin est dans `downloadDir` (même règle que `assertPathWithin`, `src/main/ipc/validate.ts`, sans lever) **ou** s'il est exactement dans `knownPaths`.

- [ ] **Step 1: Tests**

```ts
expect(isLibraryVideo('Dune (2021).mkv', 4e9)).toBe(true)
expect(isLibraryVideo('Dune.MP4', 2e6)).toBe(true)
expect(isLibraryVideo('Dune.mkv.part', 4e9)).toBe(false)
expect(isLibraryVideo('affiche.jpg', 4e6)).toBe(false)
expect(isLibraryVideo('sample.mkv', 999_999)).toBe(false)
expect(isLibraryVideo('film.mkv.exe', 4e9)).toBe(false)

expect(parseEpisodeName('Breaking Bad S01E02.mkv')).toEqual({ series: 'Breaking Bad', season: 1, episode: 2 })
expect(parseEpisodeName('the.office.s03e10.mp4')).toEqual({ series: 'the office', season: 3, episode: 10 })
expect(parseEpisodeName('Dune (2021).mkv')).toBeNull()

expect(movieTitleKey('FR - L’Éléphant bleu (2024).mkv')).toEqual({ key: normalizeForSearch('L’Éléphant bleu'), year: 2024 })
expect(movieTitleKey('Dune.Part.Two.mkv')).toEqual({ key: normalizeForSearch('Dune Part Two'), year: null })

expect(shouldPrune(false, true)).toBe(true)
expect(shouldPrune(false, false)).toBe(false) // dossier introuvable : on ne retire rien
expect(shouldPrune(true, true)).toBe(false)

const known = new Set(['/old/Films/Dune.mkv'])
expect(isAllowedLibraryPath('/dl/Films/a.mkv', '/dl', known)).toBe(true)
expect(isAllowedLibraryPath('/old/Films/Dune.mkv', '/dl', known)).toBe(true)  // ancien dossier, connu
expect(isAllowedLibraryPath('/old/Films/Autre.mkv', '/dl', known)).toBe(false) // ancien dossier, inconnu
expect(isAllowedLibraryPath('/dl/../etc/passwd', '/dl', known)).toBe(false)
expect(isAllowedLibraryPath('/old/Films/Dune.mkv', null, known)).toBe(true)
```

- [ ] **Step 2:** `corepack pnpm@9.15.9 vitest run test/main/libraryLogic.test.ts` → FAIL (module absent).
- [ ] **Step 3:** implémenter dans `src/main/library/libraryLogic.ts` (épisode : `/^(.+?)[\s._-]+s(\d{1,2})e(\d{1,3})\b/i`, `.`/`_` du nom de série → espaces, trim).
- [ ] **Step 4:** même commande → PASS.
- [ ] **Step 5:** commit `feat(bibliotheque): logique pure (fichiers vidéo, épisodes, chemins)`.

### Task 2: Table, dépôt, type partagé, file de téléchargement enrichie

**Files:**
- Modify: `src/main/store/schema.ts` (migration `version: 10`)
- Create: `src/main/store/libraryRepo.ts`, `src/shared/types/library.ts` (+ export dans `src/shared/index.ts`)
- Modify: `src/main/store/downloadsRepo.ts` (`NewDownload`, `addDownload`, `mapItem`), `src/shared/types/downloads.ts` (`AddDownloadRequest`, `DownloadItem`), `src/main/ipc/handlers.ts` (`DOWNLOAD_ADD` lit les nouveaux champs optionnels), `src/renderer/src/features/movie/MovieDetail.tsx` et `src/renderer/src/features/series/SeriesDetail.tsx` (envoient `image`, et pour un épisode `seriesId`, `season`, `episodeNum`)

**Interfaces:**
- Produces (`src/shared/types/library.ts`) :

```ts
export type LibraryKind = 'movie' | 'episode' | 'recording' | 'file'
export type LibrarySource = 'download' | 'recording' | 'scan' | 'torrent'
export interface LibraryItem {
  id: number; kind: LibraryKind; source: LibrarySource
  streamId: number | null; seriesId: number | null
  seriesName: string | null; season: number | null; episode: number | null
  title: string; image: string | null; filePath: string
  sizeBytes: number | null; addedAt: number
  containerExtension: string | null
}
export interface LibraryListing {
  items: LibraryItem[]; freeBytes: number | null; usedBytes: number; folderMissing: boolean
}
export interface LibraryRefreshResult { added: number; removed: number; folderMissing: boolean }
```

- Produces (`libraryRepo.ts`) : `upsertLibraryItem(item: Omit<LibraryItem, 'id' | 'addedAt'> & { addedAt?: number }): LibraryItem` (unique sur `file_path` : met à jour taille/infos), `listLibraryItems(): LibraryItem[]` (tri `added_at DESC`), `getLibraryItem(id: number): LibraryItem | null`, `removeLibraryItems(ids: number[]): void`, `listLibraryPaths(): Set<string>`.
- Migration 10 : `CREATE TABLE library_items (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source TEXT NOT NULL, stream_id INTEGER, series_id INTEGER, series_name TEXT, season INTEGER, episode INTEGER, title TEXT NOT NULL, image TEXT, file_path TEXT NOT NULL UNIQUE, size_bytes INTEGER, container_extension TEXT, added_at INTEGER NOT NULL)` ; `ALTER TABLE download_queue ADD COLUMN image TEXT`, `series_id INTEGER`, `series_name TEXT`, `season INTEGER`, `episode_num INTEGER`.
- `AddDownloadRequest` gagne `image?: string | null; seriesId?: number; seriesName?: string; season?: number; episodeNum?: number` ; `DownloadItem` les expose.

- [ ] **Step 1:** migration + repo + types ; `DOWNLOAD_ADD` valide les nouveaux champs avec les validateurs existants (`optionalNumber`, `optionalString`, longueur 2048 pour `image`, 512 pour `seriesName`).
- [ ] **Step 2:** fiches film/série : passer l'affiche (et pour un épisode la série, son nom, saison, numéro) à `api().downloads.add`.
- [ ] **Step 3:** `corepack pnpm@9.15.9 typecheck && corepack pnpm@9.15.9 vitest run` → vert ; `corepack pnpm@9.15.9 test:e2e` → vert (la migration tourne sur le profil e2e).
- [ ] **Step 4:** commit `feat(bibliotheque): table library_items et file de téléchargement enrichie`.

### Task 3: Alimentation automatique et reprise de l'existant

**Files:**
- Create: `src/main/library/libraryFeed.ts`
- Modify: `src/main/downloads/DownloadManager.ts:826-828` (après `archiveToHistory(item.id, 'completed')`), `src/main/player/RecordingController.ts` (fin du processus, `finalize`), `src/main/player/PlayerController.ts` (chaque endroit où `this.recordingPath = null` après un enregistrement manuel : lignes ~715, ~801, ~987, ~1029, ~1063 — factoriser en une méthode privée `endManualRecording()`), `src/main/index.ts` (reprise au démarrage)

**Interfaces:**
- Consumes : `upsertLibraryItem`, `parseEpisodeName` (Task 1/2).
- Produces :
  - `addCompletedDownload(item: DownloadItem): void` — `kind` `movie` ou `episode` ; taille via `stat` (absente → `totalBytes`).
  - `addRecording(filePath: string, title: string): void` — ignoré si le fichier fait moins de `MIN_VIDEO_BYTES` ou n'existe pas.
  - `backfillLibraryOnce(): Promise<number>` — tourne une seule fois (clé de réglage `libraryBackfilled` dans `settings`) : lignes `download_history` `status='completed'`, la plus récente par `dest_path`, fichier présent ; film → affiche depuis `catalogRepo.getStream` ; épisode → série depuis `series_info_cache` si l'épisode y figure, sinon `parseEpisodeName(name)` → `seriesName`/`season`/`episode`, sinon `kind: 'file'`.
- Les titres des enregistrements : programmé → `${channelName} — ${title}` ; manuel → titre de la lecture en cours.

- [ ] **Step 1:** test unitaire de la partie pure de la reprise : extraire `pickBackfillRows(rows: { destPath: string; completedAt: number; ... }[]): typeof rows` (la plus récente par chemin) dans `libraryLogic.ts` et la tester (deux lignes même chemin → la plus récente gardée).
- [ ] **Step 2:** FAIL → implémenter → PASS.
- [ ] **Step 3:** brancher les trois points d'alimentation et la reprise (appel non bloquant après l'ouverture de la base dans `src/main/index.ts`, erreurs journalisées, jamais levées).
- [ ] **Step 4:** `typecheck`, `vitest run` → verts. Commit `feat(bibliotheque): alimentation par les téléchargements, enregistrements et l'historique`.

### Task 4: Actualiser (parcours borné du dossier)

**Files:**
- Create: `src/main/library/scanLibrary.ts`
- Test: `test/main/scanLibrary.test.ts` (vrai dossier temporaire, `fs.mkdtemp`)

**Interfaces:**
- Consumes : Task 1, `upsertLibraryItem`, `listLibraryItems`, `removeLibraryItems`.
- Produces :
  - `listVideoFiles(root: string): Promise<{ path: string; sizeBytes: number; top: 'Films' | 'Séries' | 'Live' | 'root' }[]>` — récursif, `lstat` : liens symboliques ignorés ; chaque chemin réel vérifié dans `root` ; filtre `isLibraryVideo`.
  - `matchMovie(key: { key: string; year: number | null }, candidates: { streamId: number; name: string; year: number | null; image: string | null }[]): { streamId: number; image: string | null } | null` — garde les candidats dont `movieTitleKey(name).key === key.key` (et même année si l'année est connue des deux côtés) ; **exactement un** → ce film, sinon `null`.
  - `scanLibrary(opts: { downloadDir: string; busyPaths: ReadonlySet<string>; findMovieCandidates: (key: string) => Candidate[]; findSeries: (name: string) => { seriesId: number; image: string | null } | null }): Promise<LibraryRefreshResult>` — dossier absent → `{ added: 0, removed: 0, folderMissing: true }` sans rien retirer ; ignore `busyPaths` ; `Films`/racine → `matchMovie` ; `Séries` → `parseEpisodeName` + `findSeries` (nom de série et numéros gardés même sans correspondance) ; `Live` → `recording` ; sinon `file` ; purge des entrées absentes via `shouldPrune` (dossier parent de l'entrée existe ?).
  - `findMovieCandidates` est fourni par le handler : requête `vod_streams` filtrée par `search_norm(name) LIKE '%' || ? || '%'` (fonction SQL `SEARCH_NORM_FN` existante), 50 résultats au plus.

- [ ] **Step 1: Tests**

```ts
// listVideoFiles : Films/a.mkv (2 Mo) gardé ; Films/a.mkv.part, Films/b.txt, Films/petit.mkv (10 o) ignorés ;
// un lien symbolique Films/lien.mkv -> /tmp/ailleurs/x.mkv ignoré ; Séries/S/x S01E01.mkv → top 'Séries'
expect(files.map((f) => basename(f.path)).sort()).toEqual(['a.mkv', 'x S01E01.mkv'])

// matchMovie
const c = [{ streamId: 1, name: 'FR - Dune (2021)', year: 2021, image: 'i1' }, { streamId: 2, name: 'FR - Dune (1984)', year: 1984, image: 'i2' }]
expect(matchMovie(movieTitleKey('Dune (2021).mkv'), c)).toEqual({ streamId: 1, image: 'i1' })
expect(matchMovie(movieTitleKey('Dune.mkv'), c)).toBeNull() // ambigu → Autres fichiers

// scanLibrary sur un dossier inexistant
expect(await scanLibrary({ downloadDir: '/n/existe/pas', busyPaths: new Set(), findMovieCandidates: () => [], findSeries: () => null }))
  .toEqual({ added: 0, removed: 0, folderMissing: true })
```

(`scanLibrary` touche la base : son test se limite au cas « dossier absent », qui retourne avant tout accès ; le reste est couvert par l'e2e de la Task 7.)

- [ ] **Step 2:** FAIL → implémenter → PASS.
- [ ] **Step 3:** commit `feat(bibliotheque): actualiser retrouve les fichiers ajoutés à la main`.

### Task 5: IPC et sécurité

**Files:**
- Modify: `src/shared/ipc/channels.ts` (`LIBRARY_LIST: 'library:list'`, `LIBRARY_REFRESH: 'library:refresh'`, `LIBRARY_DELETE: 'library:delete'`), `src/shared/ipc/contract.ts`, `src/shared/ipc/api.ts`, `src/preload/index.ts`, `src/main/ipc/handlers.ts` (trois handlers + `PLAYER_PLAY` local)

**Interfaces:**
- `api().library.list(): Promise<Result<LibraryListing>>` — retire d'abord les entrées dont le fichier manque (`shouldPrune`), puis `freeBytes` via `statfs(downloadDir)` (null si indisponible), `usedBytes` = somme des tailles, `folderMissing` = dossier configuré introuvable.
- `api().library.refresh(): Promise<Result<LibraryRefreshResult>>` — `scanLibrary` avec `busyPaths` = fichier lu par le lecteur + `recordingPath` + chemin de l'enregistrement programmé en cours + `destPath` des téléchargements actifs.
- `api().library.remove(id: number): Promise<Result<void>>` — `getLibraryItem` ; refuse (`err('BUSY', …)`) si le chemin est dans `busyPaths` ; vérifie `isAllowedLibraryPath(path, downloadDir, listLibraryPaths())` ; `shell.trashItem(path)` ; en cas d'échec : `err('TRASH_FAILED', 'Impossible de mettre le fichier à la Corbeille : rien n’a été supprimé.')` ; succès → `removeLibraryItems([id])`.
- `PLAYER_PLAY` (`handlers.ts:811-830`) : remplacer le seul contrôle « dans le dossier » par `isAllowedLibraryPath(filePath, downloadDir, listLibraryPaths())` ; garder le message actuel quand aucun dossier n'est configuré **et** que le chemin n'est pas connu.

- [ ] **Step 1:** implémenter canaux, contrat, preload, handlers (`id` validé comme entier positif avec les validateurs existants ; la règle de chemin est déjà testée en Task 1).
- [ ] **Step 2:** `typecheck`, `lint`, `vitest run` → verts. Commit `feat(bibliotheque): canaux IPC, lecture et suppression sécurisées`.

### Task 6: Écran Bibliothèque

**Files:**
- Modify: `src/renderer/src/components/AppNav.tsx` (`Route` gagne `'library'`, entrée « Bibliothèque » juste après Direct, clé `nav-library`), `src/renderer/src/components/icons.tsx` (`IconLibrary`), `src/renderer/src/App.tsx` (ScreenSlot `library`, fonction de lecture d'un élément)
- Create: `src/renderer/src/features/library/LibraryScreen.tsx`, `LibraryEpisodes.tsx` (fenêtre des épisodes), `ConfirmDelete.tsx` (deux étapes)

**Interfaces:**
- Consumes : `api().library.*` (Task 5), `CardGrid` + `CardCaption`, `useGridNavigation`, `FocusZone`, `useFocusItem`, `useBackHandler`, `useReturnFocus`, `useFocusWhenReady`, `useProgress`, `displayName`.
- `App` : `playLibraryItem(item: LibraryItem, fromStart?: boolean)` → `setPlayRequest({ kind: 'local', filePath, mediaKind: kind === 'episode' ? 'series' : 'movie', streamId: (movie|episode) ? streamId : undefined, seriesId, title: displayName(title), image, startSecs: resume })` ; ne passe **jamais** par `downloads.localPath` ni par le fournisseur.
- Écran (`screen-library`) :
  - en-tête : « Bibliothèque », « X Go libres · Y Go dans la bibliothèque », bouton **Actualiser** (toast « N ajoutés, M retirés ») ; bandeau « Dossier de téléchargement introuvable » si `folderMissing` ;
  - onglets en rangée (`library-tabs`) : Films, Séries, Enregistrements, Autres fichiers (ce dernier seulement s'il y en a) ;
  - grille (`library-grid`) : film/enregistrement/fichier → OK = `playLibraryItem` ; série (regroupée par `seriesId`, sinon par `seriesName`) → OK ouvre `LibraryEpisodes` ;
  - action secondaire sur l'élément sélectionné : boutons « Fiche » (film au catalogue, ouvre `MovieDetail` via `findSource` existant) et « Supprimer », affichés sous la grille pour l'élément actif et atteignables par ↓ ;
  - `LibraryEpisodes` : frontière, épisodes triés saison/épisode, sélection initiale sur le premier non vu (`useProgress`), OK = lire, « Supprimer » par épisode ;
  - `ConfirmDelete` : étape 1 « Supprimer “{titre}” ({taille}) ? » [Annuler (sélectionné)] [Supprimer] ; étape 2 « Vraiment ? Le fichier ira dans la Corbeille. » [Annuler (sélectionné)] [Oui, supprimer] ; Retour = Annuler ; erreurs `BUSY` / `TRASH_FAILED` affichées en toast ;
  - état vide : « Vos téléchargements terminés apparaîtront ici. » + bouton vers Films.
- Rechargement de la liste : à l'arrivée sur l'écran (`ScreenActiveContext`), après Actualiser, après suppression, et sur l'événement de fin de téléchargement existant.

- [ ] **Step 1:** implémenter ; vérifier à la main avec la sonde `.superpowers/sdd/probe.mjs` (dont `PROBE_ARGS=--tv`) : navigation au clavier, capture d'écran en mode TV.
- [ ] **Step 2:** `typecheck`, `lint` → verts. Commit `feat(bibliotheque): écran Bibliothèque`.

### Task 7: Parcours de bout en bout

**Files:**
- Modify: `test/e2e/smoke.mjs`, au besoin `test/e2e/fakeProvider.mjs`

- [ ] **Step 1:** ajouter au parcours (après le téléchargement de « Le Film Test » déjà présent) :
  - la Bibliothèque montre « Le Film Test (2026) » dans Films ; OK lance la lecture locale (statut lecteur `kind` local, chemin du fichier) — sous condition `realPlayback` comme les autres contrôles de lecture ;
  - copier un fichier vidéo de test (≥ 1 Mo, le `videoPath` généré par ffmpeg) dans `<downloadDir>/Films/FR - Autre Film (2025) CAM.mp4` et un autre `Inconnu total.mkv`, puis Actualiser → toast « 2 ajoutés », le premier dans Films avec le titre du catalogue, le second dans « Autres fichiers » ;
  - suppression au clavier : Supprimer → OK ouvre l'étape 2 avec « Annuler » sélectionné → un OK de plus ferme sans supprimer (fichier encore là) ; recommencer et choisir « Oui, supprimer » → fichier absent du dossier, entrée retirée. Lancer l'app de test avec `XDG_DATA_HOME=<profil>` pour que la Corbeille Linux soit dans le profil.
  - renommer temporairement le dossier de téléchargement, rouvrir la Bibliothèque → bandeau « introuvable », entrées toujours là ; remettre le dossier.
- [ ] **Step 2:** `corepack pnpm@9.15.9 test:e2e` → « Tout est vert ». Commit `test(bibliotheque): parcours e2e`.

### Task 8: Relecture, PR, version de test

- [ ] relecture indépendante de toute la branche (agent `qa-reviewer`, et relecture Codex si l'utilisateur le souhaite), corrections avec test ;
- [ ] `typecheck`, `lint`, `vitest run`, `test:e2e` verts ;
- [ ] PR vers `main` « feat: bibliothèque des fichiers téléchargés », corps avec `## Nouveautés` ;
- [ ] build Windows de test : `gh workflow run build-windows.yml --ref feat/bibliotheque` ; donner le lien à l'utilisateur ; fusion sur « fusionne la #NN ».
