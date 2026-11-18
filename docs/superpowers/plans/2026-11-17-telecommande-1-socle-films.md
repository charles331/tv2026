# Télécommande — étape 1 : socle de navigation + écran Films — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** naviguer dans le menu principal, tout l'écran Films et la fiche film avec ↑ ↓ ← → / OK / Retour seulement, sans gêner la souris.

**Architecture:** la bibliothèque Norigin gère les zones de focus et la navigation géométrique. Un routeur de touches maison (écoute `keydown` en phase de capture sur `window`) traduit les touches en actions, traite Retour via une pile de gestionnaires, et protège les champs de saisie. Les grandes grilles naviguent par index (fonction pure). Les écrans de navigation principaux restent montés (cachés) quand on les quitte, ce qui conserve catégorie, défilement et sélection.

**Tech Stack:** React 19, TypeScript, Tailwind 4, `@noriginmedia/norigin-spatial-navigation` 3.4 (cœur 4.2), Vitest (environnement node, fonctions pures), Playwright `_electron` (e2e).

**Spec:** `docs/superpowers/specs/2026-11-17-telecommande-design.md` (§6.1 à §6.5, §7 étape 1, §8).

## Global Constraints

- Commandes : `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` puis `corepack pnpm@9.15.9 <script>` (le shim pnpm 12 est cassé). Tests : `corepack pnpm@9.15.9 vitest run <fichier>`. Types : `corepack pnpm@9.15.9 typecheck`. E2E : `corepack pnpm@9.15.9 test:e2e`.
- Branche : `feat/telecommande` (déjà créée depuis `main`, contient la conception). Une PR à la fin de cette étape ; **ne pas fusionner** sans demande explicite de l'utilisateur.
- Touches : `up | down | left | right | ok | back`. Retour = Échap, Retour arrière hors champ, `BrowserBack` (keyCode 166), bouton « précédent » de la souris (`button === 3`).
- La navigation et le nouveau Retour sont actifs pour tous, sans option.
- L'anneau de sélection n'est visible qu'après une touche de navigation ; il disparaît au mouvement de la souris (`html[data-input="keys" | "pointer"]`).
- Retour au niveau du menu principal ne fait rien (jamais de fermeture de l'application).
- Ctrl+K continue d'ouvrir la recherche globale.
- Textes visibles en français ; commentaires de code en anglais (convention du dépôt).
- Commits terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Champ de recherche sélectionné** : ← → doivent déplacer le curseur de texte, Retour arrière doit effacer un caractère (pas « Retour »), ↓ doit sortir du champ. → test `keyToAction` (Task 1) + parcours e2e (Task 8).
2. **Fiche ouverte puis fermée par Retour** : la sélection doit revenir sur l'affiche qui l'a ouverte, pas en haut de la grille. → e2e Task 8.
3. **Fin de la grille chargée** : descendre jusqu'aux dernières lignes doit charger la page suivante et continuer, sans bloquer ni sauter. → test `shouldLoadMore` (Task 3).
4. **Usage à la souris** : cliquer une affiche ou un bouton fonctionne comme avant et ne laisse pas d'anneau de sélection visible. → e2e Task 8 (clic puis absence de `data-input="keys"`).
5. **Retour dans le menu principal** : ne fait rien, ne ferme rien. → test `BackStack` vide (Task 2) + e2e Task 8.

---

### Task 1: Carte des touches

**Files:**
- Modify: `package.json` (dépendance `@noriginmedia/norigin-spatial-navigation@3.4.0`)
- Create: `src/renderer/src/lib/remote/keys.ts`
- Test: `test/renderer/remoteKeys.test.ts`

**Interfaces:**
- Produces: `type RemoteAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'` ; `interface KeyLike { key: string; keyCode?: number }` ; `keyToAction(e: KeyLike, ctx: { inTextField: boolean }): RemoteAction | null` ; `isTextField(el: Element | null): boolean` (input text/search/password/number/url, textarea, contenteditable).

- [ ] **Step 1: Installer la dépendance** — `corepack pnpm@9.15.9 add @noriginmedia/norigin-spatial-navigation@3.4.0` ; vérifier que `pnpm-lock.yaml` change.
- [ ] **Step 2: Écrire les tests**

```ts
describe('keyToAction', () => {
  const out = { inTextField: false }, inField = { inTextField: true }
  it('maps arrows, Enter and keypad Enter', () => {
    expect(keyToAction({ key: 'ArrowUp' }, out)).toBe('up')
    expect(keyToAction({ key: 'ArrowRight' }, out)).toBe('right')
    expect(keyToAction({ key: 'Enter' }, out)).toBe('ok')
  })
  it('maps every back key', () => {
    expect(keyToAction({ key: 'Escape' }, out)).toBe('back')
    expect(keyToAction({ key: 'Backspace' }, out)).toBe('back')
    expect(keyToAction({ key: 'BrowserBack' }, out)).toBe('back')
    expect(keyToAction({ key: 'Unidentified', keyCode: 166 }, out)).toBe('back')
  })
  it('leaves text editing keys to a text field', () => {
    expect(keyToAction({ key: 'Backspace' }, inField)).toBeNull()
    expect(keyToAction({ key: 'ArrowLeft' }, inField)).toBeNull()
    expect(keyToAction({ key: 'ArrowRight' }, inField)).toBeNull()
  })
  it('still leaves a text field with up/down, Escape and Enter', () => {
    expect(keyToAction({ key: 'ArrowDown' }, inField)).toBe('down')
    expect(keyToAction({ key: 'Escape' }, inField)).toBe('back')
    expect(keyToAction({ key: 'Enter' }, inField)).toBe('ok')
  })
  it('ignores other keys', () => {
    expect(keyToAction({ key: 'a' }, out)).toBeNull()
  })
})
```

- [ ] **Step 3: Lancer, constater l'échec** — `vitest run test/renderer/remoteKeys.test.ts` → FAIL (module introuvable).
- [ ] **Step 4: Implémenter `keys.ts`** (fonctions pures, sans import React).
- [ ] **Step 5: Lancer, constater la réussite** — PASS.
- [ ] **Step 6: Commit** — `feat(remote): carte des touches de la télécommande`.

### Task 2: Pile « Retour »

**Files:**
- Create: `src/renderer/src/lib/remote/backStack.ts`
- Test: `test/renderer/backStack.test.ts`

**Interfaces:**
- Produces: `class BackStack { push(handler: () => void): () => void; dispatch(): boolean; size(): number }` (dispatch appelle le gestionnaire **le plus récemment empilé et encore actif**, renvoie `false` si la pile est vide) ; `export const backStack = new BackStack()`.

- [ ] **Step 1: Écrire les tests**

```ts
it('calls the most recent handler only', () => { /* push a, push b → dispatch → b called, a not */ })
it('falls back to the previous handler once the latest is removed', () => { /* remove b → dispatch → a */ })
it('removing a handler twice or out of order is harmless', () => { /* remove a then b → dispatch() === false */ })
it('returns false when empty', () => { expect(new BackStack().dispatch()).toBe(false) })
```

- [ ] **Step 2: Lancer → FAIL.**
- [ ] **Step 3: Implémenter** (tableau de jetons `{ handler }` ; `push` renvoie une fonction de retrait idempotente).
- [ ] **Step 4: Lancer → PASS.**
- [ ] **Step 5: Commit** — `feat(remote): pile des gestionnaires Retour`.

### Task 3: Navigation par index dans une grille

**Files:**
- Create: `src/renderer/src/lib/remote/grid.ts`
- Test: `test/renderer/remoteGrid.test.ts`

**Interfaces:**
- Produces: `gridStep(index: number, dir: 'up' | 'down' | 'left' | 'right', columns: number, count: number): number | 'exit'` ; `shouldLoadMore(index: number, columns: number, count: number, hasMore: boolean): boolean` (vrai si l'index est dans les **2 dernières lignes** chargées et `hasMore`).

- [ ] **Step 1: Écrire les tests** (grille 5 colonnes, 12 éléments) :

```ts
expect(gridStep(0, 'right', 5, 12)).toBe(1)
expect(gridStep(4, 'right', 5, 12)).toBe(5)        // wraps to the next row start
expect(gridStep(11, 'right', 5, 12)).toBe('exit')  // last item
expect(gridStep(5, 'left', 5, 12)).toBe('exit')    // first column → leave the grid (categories)
expect(gridStep(0, 'left', 5, 12)).toBe('exit')
expect(gridStep(2, 'up', 5, 12)).toBe('exit')      // first row → toolbar
expect(gridStep(7, 'up', 5, 12)).toBe(2)
expect(gridStep(7, 'down', 5, 12)).toBe(11)        // partial last row: clamp to last item
expect(gridStep(10, 'down', 5, 12)).toBe('exit')   // already on last row
expect(shouldLoadMore(5, 5, 12, true)).toBe(true)
expect(shouldLoadMore(0, 5, 12, true)).toBe(false)
expect(shouldLoadMore(11, 5, 12, false)).toBe(false)
```

Note : ← sur la première colonne sort de la grille même si ce n'est pas l'index 0 (règle du §6.4).

- [ ] **Step 2: Lancer → FAIL.** — **Step 3: Implémenter.** — **Step 4: Lancer → PASS.**
- [ ] **Step 5: Commit** — `feat(remote): navigation par index dans une grille`.

### Task 4: Moteur de navigation, primitives focusables et style de sélection

**Files:**
- Create: `src/renderer/src/lib/remote/RemoteRuntime.ts` (initialisation + routeur de touches)
- Create: `src/renderer/src/lib/remote/focus.tsx` (primitives React)
- Modify: `src/renderer/src/main.tsx` (appel de `startRemote()` avant le rendu)
- Modify: `src/renderer/src/components/ui/Button.tsx`, `src/renderer/src/components/ui/Field.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: `keyToAction`, `isTextField` (Task 1), `backStack` (Task 2).
- Produces :
  - `startRemote(): void` et `setTypeToSearchHandler(fn: ((char: string) => void) | null): void` (branché à l'étape 2 ; à l'étape 1 il reste nul) — `init({ shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true }, throttle: 0 })`, puis un écouteur `keydown` **en capture** sur `window` :
    - action `back` → `preventDefault()` + `stopPropagation()` + `backStack.dispatch()` ;
    - dans un champ de saisie, `ArrowLeft`/`ArrowRight`/`Backspace`/`Home`/`End` → `stopPropagation()` seulement (Norigin ne les voit pas, le curseur bouge) ;
    - toute action non nulle → `document.documentElement.dataset.input = 'keys'` ;
    - un écouteur `mousemove` (déplacement réel > 2 px) et `mousedown` → `dataset.input = 'pointer'` ;
    - `mouseup` avec `button === 3` → `backStack.dispatch()`.
  - `useFocusItem(opts?: { focusKey?: string; onEnter?: () => void; onArrow?: (dir: Direction) => boolean; focusable?: boolean; onFocus?: () => void }): { ref; focused: boolean; focusSelf: () => void; itemProps: { 'data-focused': boolean; onMouseDown: () => void } }` — sans `onEnter`, OK appelle `ref.current.click()` (Norigin empêche l'action native de Entrée) ; `onMouseDown` appelle `focusSelf()` pour que la souris et la télécommande partagent la même sélection ; à la sélection, `scrollIntoView({ block: 'nearest' })`.
  - `FocusZone` : `({ focusKey, boundary?: boolean, preferredChildFocusKey?, focusable?: boolean, className?, children })` — `useFocusable({ focusKey, trackChildren: true, saveLastFocusedChild: true, isFocusBoundary: boundary, focusable })` + `FocusContext.Provider`, rend une `div`.
  - `useReturnFocus(): void` — à l'ouverture mémorise `getCurrentFocusKey()` ; à la fermeture (démontage) refait `setFocus` dessus si `doesFocusableExist`, sinon ne fait rien.
  - `useBackHandler(handler: () => void, active = true): void` — `backStack.push` dans un `useEffect`, retrait au nettoyage ; le gestionnaire le plus récent est lu via une ref (pas de ré-empilement à chaque rendu).
- `Button` et `TextInput` utilisent `useFocusItem` (le `TextInput` : OK → `navigateByDirection('down')`).
- CSS : `html[data-input='keys'] [data-focused='true']` → anneau `outline: 3px solid` couleur d'accent, `outline-offset: 2px` ; cartes d'affiche : `transform: scale(1.04)` en plus. Aucun anneau quand `data-input='pointer'`.

- [ ] **Step 1: Implémenter `RemoteRuntime.ts`, `focus.tsx`, brancher `startRemote()` dans `main.tsx`.**
- [ ] **Step 2: Adapter `Button` et `TextInput`, ajouter le CSS.**
- [ ] **Step 3: Vérifier** — `typecheck` vert ; `vitest run` vert (aucune régression).
- [ ] **Step 4: Commit** — `feat(remote): moteur de navigation, primitives focusables, style de sélection`.

### Task 5: Menu principal, écrans gardés en mémoire, Retour vers le menu

**Files:**
- Modify: `src/renderer/src/components/AppNav.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `FocusZone`, `useFocusItem`, `useBackHandler`, `setFocus` (Task 4).
- Produces: clés de focus `nav` (zone du menu), `nav-<route>` (chaque bouton), `screen-<route>` (zone de chaque écran). Les écrans de l'étape 2 s'appuient sur ces noms.

- [ ] **Step 1: `AppNav`** — enveloppé dans `FocusZone focusKey="nav"` ; chaque bouton via `useFocusItem({ focusKey: 'nav-<route>' })` ; « Tout mettre à jour » et l'accueil aussi.
- [ ] **Step 2: Écrans gardés montés** — `catalog`, `series`, `live`, `search` sont rendus dès leur première visite puis cachés (`hidden`) quand ils ne sont pas actifs ; chacun dans `FocusZone focusKey="screen-<route>" focusable={route === r}`. Les clés existantes (`catalogEpoch`, seed) sont conservées. `scheduled`, `downloads`, `settings` restent montés seulement quand actifs. **Ajouter** `setCatalogEpoch((n) => n + 1)` dans `onCatalogRefreshed` des Réglages (sinon un écran gardé en mémoire garderait d'anciennes données).
- [ ] **Step 3: Focus au changement d'écran** — après `navigate(r)`, `setFocus('screen-<r>')` (Norigin restaure le dernier enfant sélectionné de la zone). Au démarrage : `setFocus('screen-catalog')` (ou `nav-settings` sans identifiants).
- [ ] **Step 4: Retour au niveau écran** — `useBackHandler` dans `AppShell` (le **seul gestionnaire permanent** de la pile : `backStack.size() === 1` signifie « aucune surcouche ouverte ») : si la sélection est dans `screen-<route>` hors de la zone `<route>-categories` et que cette zone existe (`doesFocusableExist`) → `setFocus('<route>-categories')` ; sinon si elle est dans `screen-<route>` → `setFocus('nav-<route>')` ; dans `nav` → rien. Ajouter `size(): number` à `BackStack` (Task 2, avec un test).
- [ ] **Step 5: Vérifier** — `typecheck` ; lancer l'app (`corepack pnpm@9.15.9 dev`, `DISPLAY=:0`) : ↑ ↓ dans le menu, → entre dans l'écran, Retour revient au menu, changer d'écran puis revenir conserve la catégorie et la sélection.
- [ ] **Step 6: Commit** — `feat(remote): menu principal navigable, écrans conservés, Retour vers le menu`.

### Task 6: Écran Films (catégories, barre d'outils, grille, Reprendre, Favoris)

**Files:**
- Modify: `src/renderer/src/features/catalog/CategorySidebar.tsx`, `CatalogScreen.tsx`, `PosterGrid.tsx`, `PosterCard.tsx`
- Create: `src/renderer/src/components/ui/SelectMenu.tsx`
- Modify: `src/renderer/src/features/progress/ContinueView.tsx`, `src/renderer/src/features/favorites/FavoritesView.tsx`

**Interfaces:**
- Consumes: `gridStep`, `shouldLoadMore` (Task 3) ; primitives (Task 4).
- Produces :
  - `SelectMenu<T extends string>({ value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; title: string })` — un bouton qui affiche le libellé courant ; OK ouvre une liste en surcouche (`FocusZone boundary`), ↑ ↓ choisissent, OK valide, Retour ferme sans changer. Réutilisé par Séries à l'étape 2.
  - `useGridNavigation({ count, columns, hasMore, onLoadMore, onActivate, focusKey }): { ref; focused: boolean; activeIndex: number; setActiveIndex(i: number): void }` (dans `src/renderer/src/lib/remote/useGridNavigation.ts`) — la grille est **un seul** élément focusable ; `onArrow` utilise `gridStep` (renvoie `true` sur `'exit'` pour laisser Norigin aller à la zone voisine, sinon met à jour l'index et renvoie `false`) ; appelle `onLoadMore` quand `shouldLoadMore` ; OK → `onActivate(activeIndex)`. Réutilisé par `SeriesGrid` à l'étape 2.
- Zones de l'écran Films : `catalog-categories` (gauche), `catalog-toolbar` (haut), `catalog-grid` (contenu).

- [ ] **Step 1: Catégories** — chaque entrée (Favoris, épinglées, Toutes, catégories) via `useFocusItem` ; le champ de filtre des catégories est un `TextInput` (déjà focusable) ; la poignée de redimensionnement reste hors navigation.
- [ ] **Step 2: Barre d'outils** — champ de recherche (déjà focusable via `TextInput`) ; remplacer le `<select>` de tri par `SelectMenu` (mêmes options, même état).
- [ ] **Step 3: Grille** — `PosterGrid` utilise `useGridNavigation` ; l'affiche active reçoit `active` (anneau + agrandissement via `data-focused`) ; défilement : garder la ligne active visible en ajustant `scrollTop` du conteneur (la ligne n'existe peut-être pas encore dans le DOM : calculer avec `rowHeight`) ; clic souris → `setActiveIndex(i)` puis ouverture comme aujourd'hui. Quand la liste change (catégorie, recherche, tri), `activeIndex` revient à 0.
- [ ] **Step 4: Reprendre / Favoris** — chaque élément via `useFocusItem` ; le bouton « retirer des favoris » est visible quand la carte est sélectionnée (`group-data-[focused=true]:opacity-100` en plus du survol).
- [ ] **Step 5: Vérifier** — `typecheck` ; dans l'app : catégories ↔ grille ↔ barre d'outils ; descendre loin dans « Tous les films » charge les pages suivantes ; ← sur la première colonne revient aux catégories.
- [ ] **Step 6: Commit** — `feat(remote): écran Films entièrement navigable`.

### Task 7: Fiche film

**Files:**
- Modify: `src/renderer/src/features/movie/MovieDetail.tsx`

**Interfaces:**
- Consumes: `FocusZone`, `useBackHandler`, `useReturnFocus`, `setFocus` (Task 4).

- [ ] **Step 1: Frontière** — contenu dans `FocusZone focusKey="movie-detail" boundary` ; `useReturnFocus()`.
- [ ] **Step 2: Sélection initiale** — `setFocus` sur l'action principale à l'ouverture : « Reprendre à … » s'il existe, sinon « Lire » (clés `movie-detail-primary`).
- [ ] **Step 3: Retour** — remplacer l'écouteur Échap (`MovieDetail.tsx:128-135`) par `useBackHandler(onClose)` ; la confirmation « qualité suspecte » a sa propre `FocusZone boundary` + `useBackHandler(() => setConfirmLowQuality(false), confirmLowQuality)` et la sélection initiale sur « Annuler ».
- [ ] **Step 4: Vérifier** — OK sur une affiche ouvre la fiche avec « Lire » sélectionné ; Retour ferme et la sélection revient sur la même affiche.
- [ ] **Step 5: Commit** — `feat(remote): fiche film navigable, Retour et sélection rendue`.

### Task 8: Parcours e2e au clavier seul

**Files:**
- Modify: `test/e2e/smoke.mjs`

- [ ] **Step 1: Ajouter le parcours** (avec le faux fournisseur existant, 3 films) via `page.keyboard.press` uniquement :
  1. au démarrage, la sélection est dans l'écran Films ; `Escape` → `document.activeElement` est le bouton `nav-catalog` (attribut `data-focused="true"`) ; `Escape` encore → rien ne change, la fenêtre est toujours ouverte ;
  2. `ArrowRight` → retour dans l'écran ; aller jusqu'à la grille ; `Enter` → la fiche « Le Film Test » est visible ; l'élément actif est le bouton « Lire » ;
  3. `Escape` → fiche fermée ; l'affiche active est celle du film ouvert ;
  4. aller au champ de recherche, taper `elephant`, `ArrowLeft` puis `Backspace` → la valeur du champ est `elephat` (le curseur a bougé, le caractère a été effacé, la fiche/écran n'a pas été quitté) ; `ArrowDown` → sélection dans la grille, une seule affiche « L'Éléphant bleu » ;
  5. clic souris sur une affiche puis fermeture de la fiche → `document.documentElement.dataset.input === 'pointer'`.
- [ ] **Step 2: Lancer** — `test:e2e` → toutes les vérifications ✓, y compris les anciennes.
- [ ] **Step 3: Commit** — `test(e2e): parcours Films au clavier seul`.

### Task 9: Revue, PR, version de test

- [ ] **Step 1: Revue** — agent `qa-reviewer` sur le diff de la branche (focus : routeur de touches, champs de saisie, régressions souris, fuites d'écouteurs).
- [ ] **Step 2: Corriger** ce qui est confirmé ; relancer `typecheck`, `vitest run`, `test:e2e`.
- [ ] **Step 3: Pousser et ouvrir la PR** vers `main` (« feat: navigation à la télécommande — étape 1 : socle + Films ») ; CI verte.
- [ ] **Step 4: Version de test Windows** — `gh workflow run build-windows.yml --ref feat/telecommande`, donner le lien de l'exe portable à l'utilisateur avec la liste des touches à essayer. Attendre son retour et sa demande explicite avant toute fusion.
