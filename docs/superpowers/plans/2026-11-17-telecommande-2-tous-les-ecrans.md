# Télécommande — étape 2 : tous les autres écrans — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** plus aucun écran ni fenêtre où l'on reste bloqué sans souris : Séries, Direct, Recherche, Programmés, Téléchargements, Réglages, confirmations, barre du lecteur, plus « taper une lettre ouvre la recherche » et l'écran « Tester la télécommande ».

**Architecture:** applique les primitives de l'étape 1 (`FocusZone`, `useFocusItem`, `useBackHandler`, `useReturnFocus`, `useGridNavigation`, `SelectMenu`) à chaque écran. Aucune nouvelle mécanique, sauf deux fonctions pures (lettre tapée, description d'une touche).

**Tech Stack:** identique à l'étape 1.

**Spec:** `docs/superpowers/specs/2026-11-17-telecommande-design.md` (§6.2 à §6.5, §6.7, §7 étape 2). **Prérequis :** plan `2026-11-17-telecommande-1-socle-films.md` terminé et validé par l'utilisateur sous Windows.

## Global Constraints

- Mêmes commandes, conventions et règle de fusion que l'étape 1 (voir son plan, « Global Constraints »).
- Branche : nouvelle branche `feat/telecommande-2` depuis `main` **après** fusion de l'étape 1 (ou empilée sur `feat/telecommande` si l'utilisateur n'a pas encore fusionné ; dans ce cas, après la fusion squash de l'étape 1, faire `git merge -s ours origin/main` après avoir vérifié que `main` est identique à la branche de l'étape 1).
- Clés de focus : `screen-<route>` pour la zone d'un écran (déjà en place) ; `<écran>-<partie>` pour les zones internes (ex. `live-list`, `series-grid`).
- Chaque surcouche : `FocusZone boundary` + `useReturnFocus()` + `useBackHandler(fermer)` + sélection initiale explicite.

## Review Focus

1. **`ConflictDialog` pendant une navigation** : il apparaît sans action de l'utilisateur ; la sélection doit y aller, Retour ne doit **pas** le fermer silencieusement (aucun choix implicite), et après le choix la sélection revient où elle était. → e2e Task 5.
2. **Champs numériques et mots de passe des Réglages** : ← → Retour arrière doivent éditer (pas naviguer) — `isTextField` couvre `number`/`password`. → test Task 7.
3. **Lettre tapée alors qu'un champ est sélectionné** : doit s'écrire dans le champ, pas ouvrir la recherche globale ; Ctrl/Alt + lettre ne déclenchent rien. → test `typedSearchChar` Task 6.
4. **Ligne de chaîne dont le guide se charge en retard** : la sélection ne doit pas sauter quand l'EPG de la ligne apparaît. → vérification manuelle Task 3 (sélection par clé stable `live-row-<streamId>`).
5. **Barre du lecteur visible pendant une lecture** : ↓ depuis l'écran doit pouvoir l'atteindre, ← → sur le curseur de position règlent la position sans quitter la barre. → e2e Task 8.

---

### Task 1: Séries — écran et fiche

**Files:** Modify `features/series/SeriesScreen.tsx`, `SeriesGrid.tsx`, `SeriesCard.tsx`, `SeriesDetail.tsx`.

**Interfaces:** Consumes `useGridNavigation`, `SelectMenu`, primitives (étape 1).

- [ ] **Step 1:** zones `series-categories`, `series-toolbar`, `series-grid` comme Films ; `SelectMenu` pour le tri ; `SeriesGrid` via `useGridNavigation` (la grille n'est pas virtualisée : `columns` = nombre de colonnes mesuré à partir de la largeur et de la largeur minimale de carte, comme `PosterGrid`).
- [ ] **Step 2:** `SeriesDetail` : frontière, sélection initiale sur « Reprendre » de l'épisode en cours sinon premier épisode ; saisons = rangée de boutons ; épisodes = liste (chaque ligne : OK = lire/reprendre ; → atteint « Depuis le début » puis « Vu ») ; remplacer l'écouteur Échap (`SeriesDetail.tsx:69-75`) par `useBackHandler`.
- [ ] **Step 3:** vérifier dans l'app ; commit `feat(remote): Séries navigables`.

### Task 2: Recherche globale

**Files:** Modify `features/search/SearchScreen.tsx`.

- [ ] **Step 1:** zones `search-field`, puis une zone par section (`search-movies`, `search-series`, `search-channels`) ; ↓ depuis le champ va à la première section non vide ; « Tout voir » focusable ; `ChannelGuide` ouvert d'ici suit la Task 3.
- [ ] **Step 2:** retirer `autoFocus` du champ au profit de `setFocus('search-field')` à l'arrivée sur l'écran (sinon la sélection Norigin et le focus DOM divergent).
- [ ] **Step 3:** commit `feat(remote): recherche globale navigable`.

### Task 3: Direct — liste, guide, rattrapage

**Files:** Modify `features/live/LiveScreen.tsx`, `LiveChannelRow.tsx`, `ChannelGuide.tsx`, `GuideSearchResults.tsx`.

- [ ] **Step 1:** `LiveChannelRow` : la ligne est une zone `live-row-<streamId>` dont le premier élément (logo + nom) est sélectionné par défaut ; OK = lire ; → = « Guide », puis favori. Clés stables par `streamId`.
- [ ] **Step 2:** `ChannelGuide` : frontière, sélection initiale sur le programme en cours, onglets de jours en rangée, « Revoir » / « Du début » focusables ; Retour ferme (il n'avait aucun Échap).
- [ ] **Step 3:** `GuideSearchResults` : chaque résultat focusable (logo/nom = lire la chaîne) ; le bouton logo en `tabIndex={-1}` reste hors navigation.
- [ ] **Step 4:** case à cocher de `LiveScreen` (`LiveScreen.tsx:178`) : OK bascule (via `useFocusItem` sur le `<label>`/`<input>`).
- [ ] **Step 5:** commit `feat(remote): Direct, guide et rattrapage navigables`.

### Task 4: Téléchargements et Programmés

**Files:** Modify `features/downloads/DownloadsScreen.tsx` (+ `DownloadRow`), `features/reminders/ScheduledScreen.tsx`.

- [ ] **Step 1:** chaque ligne = zone ; actions (pause, reprise, annuler, ouvrir, supprimer) focusables de gauche à droite ; les 3 sections de Programmés empilées verticalement.
- [ ] **Step 2:** commit `feat(remote): Téléchargements et Programmés navigables`.

### Task 5: Fenêtres de confirmation et conflit d'enregistrement

**Files:** Modify `App.tsx` (confirmation « Tout mettre à jour ? », `App.tsx:553-578`), `features/reminders/ConflictDialog.tsx`.

- [ ] **Step 1:** confirmation « Tout mettre à jour ? » : frontière, sélection initiale sur « Annuler », Retour = Annuler.
- [ ] **Step 2:** `ConflictDialog` : frontière ; à l'apparition, `setFocus` sur le choix qui **ne coupe rien** (continuer la lecture en cours) ; Retour **ne fait rien** (le dialogue a déjà son délai de 30 s) ; `useReturnFocus()`.
- [ ] **Step 3:** e2e — le dialogue n'est pas simulable par le faux fournisseur sans planification : ajouter au parcours la confirmation « Tout mettre à jour ? » (ouvrir au clavier, sélection sur « Annuler », Retour ferme, sélection revenue sur le bouton du menu). Commit `feat(remote): confirmations et conflit d'enregistrement au clavier`.

### Task 6: Taper une lettre ouvre la recherche

**Files:** Create `src/renderer/src/lib/remote/typing.ts` ; Modify `RemoteRuntime.ts`, `App.tsx` ; Test `test/renderer/remoteTyping.test.ts`.

**Interfaces:** Produces `typedSearchChar(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }, ctx: { inTextField: boolean }): string | null` ; `RemoteRuntime` appelle le gestionnaire enregistré par `setTypeToSearchHandler` (étape 1) quand `typedSearchChar` renvoie un caractère, et fait alors `preventDefault()`.

- [ ] **Step 1: Tests**

```ts
expect(typedSearchChar({ key: 'a' }, { inTextField: false })).toBe('a')
expect(typedSearchChar({ key: 'É' }, { inTextField: false })).toBe('É')
expect(typedSearchChar({ key: '7' }, { inTextField: false })).toBe('7')
expect(typedSearchChar({ key: 'a' }, { inTextField: true })).toBeNull()
expect(typedSearchChar({ key: 'k', ctrlKey: true }, { inTextField: false })).toBeNull()
expect(typedSearchChar({ key: 'Enter' }, { inTextField: false })).toBeNull()
expect(typedSearchChar({ key: ' ' }, { inTextField: false })).toBeNull()
```

- [ ] **Step 2: FAIL → implémenter (une seule lettre/chiffre Unicode, `\p{L}|\p{N}`) → PASS.**
- [ ] **Step 3:** dans `App`, `setTypeToSearchHandler((c) => …)` → `setGlobalQuery(c)`, `navigate('search')`, `setFocus('search-field')` (curseur en fin de texte). Ignoré si une surcouche est ouverte : `backStack.size() > 1`.
- [ ] **Step 4:** e2e : depuis la grille Films, taper `e` → écran Recherche, champ = `e`. Commit `feat(remote): taper une lettre ouvre la recherche`.

### Task 7: Réglages et « Tester la télécommande »

**Files:** Modify `features/settings/SettingsScreen.tsx` ; Create `features/settings/RemoteTester.tsx`, `src/renderer/src/lib/remote/describeKey.ts` ; Test `test/renderer/remoteDescribeKey.test.ts`, ajout à `test/renderer/remoteKeys.test.ts`.

**Interfaces:** Produces `describeKey(e: { key: string; code: string; keyCode: number }, ctx): { key: string; code: string; keyCode: number; action: RemoteAction | null }`.

- [ ] **Step 1: Tests** — `describeKey` renvoie l'action de `keyToAction` ; ajouter à `remoteKeys.test.ts` : `isTextField` vrai pour `input[type=number]` et `input[type=password]`, faux pour `input[type=checkbox]` (éléments créés avec un faux objet `{ tagName, type }`, `isTextField` doit donc lire `tagName`/`type`/`isContentEditable` et non `instanceof`).
- [ ] **Step 2:** sections des Réglages en zones verticales ; champs, cases à cocher et boutons focusables.
- [ ] **Step 3:** `RemoteTester` : bouton « Tester la télécommande » → surcouche (frontière) qui liste les 10 dernières touches (`key`, `code`, `keyCode`, action reconnue) ; pendant le test, Retour est affiché comme les autres touches ; **pour sortir : appuyer deux fois sur Retour** (ou bouton « Fermer » à la souris). Implémentation : pendant l'ouverture, un gestionnaire `useBackHandler` compte les appuis.
- [ ] **Step 4:** commit `feat(remote): Réglages navigables et testeur de télécommande`.

### Task 8: Barre du lecteur

**Files:** Modify `features/player/PlayerView.tsx`, `SeekBar.tsx`, `VolumeSlider.tsx`.

- [ ] **Step 1:** la barre est une zone `player-bar` placée sous l'écran (↓ y mène) ; boutons via `useFocusItem` ; `SeekBar` et `VolumeSlider` via `useFocusItem({ onArrow })` : ← → ajustent (réutiliser la logique de `onKeyDown` existante) et renvoient `false` ; ↑ ↓ renvoient `true` (sortie).
- [ ] **Step 2:** e2e (lecture réelle déjà présente dans `smoke.mjs`) : pendant la lecture, atteindre le curseur de position au clavier, `ArrowRight` → la position avance de ~10 s. Commit `feat(remote): barre du lecteur navigable`.

### Task 9: Revue, PR, version de test

- [ ] Identique à l'étape 1 (Task 9) : `qa-reviewer`, corrections, `typecheck` + `vitest run` + `test:e2e`, PR « étape 2 : tous les écrans », build Windows, retour de l'utilisateur, fusion sur demande explicite.
