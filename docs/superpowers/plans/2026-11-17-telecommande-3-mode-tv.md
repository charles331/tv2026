# Télécommande — étape 3 : mode TV — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sur le mini PC branché à la TV, TV2026 démarre en plein écran, lisible à 3 m, la vidéo se pilote à la télécommande et l'application revient d'elle-même ; alertes visibles pendant la vidéo ; on peut éteindre depuis le canapé.

**Architecture:** un drapeau `tvMode` (réglage, ou forcé par l'argument `--tv`) est lu par le processus principal et poussé au rendu. Côté rendu : classe `tv` sur `<html>` (mise à l'échelle `rem`, marges, curseur), libellés visibles, menu Éteindre. Côté principal : arguments mpv de l'essai validé (`spike/tv-remote`, commit sur cette branche), fichier de touches dans `userData`, actions `script-message` reçues sur l'IPC mpv, retour au premier plan, alertes, relais des touches vers mpv, commandes d'alimentation.

**Tech Stack:** Electron 44 (`BrowserWindow.setFullScreen`, `app.setLoginItemSettings`, événement `app-command`), mpv IPC JSON (`keypress`, `set_property ontop`, `client-message`), React, Vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-17-telecommande-design.md` (§4, §6.6, §7 étape 3). **Prérequis :** étapes 1 et 2 fusionnées.

## Global Constraints

- Mêmes commandes, conventions et règle de fusion que l'étape 1.
- Hors mode TV, **rien ne change** pour le lecteur (arguments mpv identiques à aujourd'hui).
- Touches mpv en mode TV (§6.6), noms vérifiés : `ENTER`, `KP_ENTER`, `LEFT`, `RIGHT`, `UP`, `DOWN`, `PGUP`, `PGDWN`, `SPACE`, `PLAYPAUSE`, et pour Retour `ESC`, `BS`, `BACK`, `MBTN_BACK`, `Alt+LEFT`.
  - Film/épisode : `ENTER`/`KP_ENTER`/`SPACE`/`PLAYPAUSE` → `cycle pause; show-progress` ; `LEFT` → `seek -10; show-progress` ; `RIGHT` → `seek 30; show-progress` ; `UP` → `cycle audio` ; `DOWN` → `cycle sub` ; `PGUP`/`PGDWN` → `script-message tv2026 previous|next`.
  - Direct : `ENTER`/`KP_ENTER` → `show-text "${media-title}" 3000` ; `LEFT`/`UP` → `script-message tv2026 previous` ; `RIGHT`/`DOWN` → `script-message tv2026 next`.
  - Retour (les deux) : `script-message tv2026 back`.
- Le fichier de touches est écrit dans `app.getPath('userData')/mpv-remote-<live|vod>.conf` (jamais dans le dossier temporaire partagé).
- Les commandes d'alimentation n'acceptent qu'une valeur d'une liste fermée (`'quit' | 'sleep' | 'shutdown'`), validée côté principal ; aucune chaîne venue du rendu n'est passée à un shell.
- Le dossier de l'essai : reprendre la logique de `git show spike/tv-remote:src/main/player/PlayerController.ts` (fonctions `onRemote`, `remoteInputConf`, branchement `client-message`), puis **supprimer** la branche `spike/tv-remote` (locale et distante) à la fin.

## Review Focus

1. **Lancement avec `--tv` alors qu'une instance tourne déjà** (`requestSingleInstanceLock`, `src/main/index.ts:122`) : la seconde instance doit faire passer la première en mode TV et au premier plan, pas être ignorée. → test `parseLaunchFlags` + gestion `second-instance` (Task 1).
2. **Retour pressé pendant le chargement d'une vidéo** (mpv lancé, fichier pas encore ouvert) : doit arrêter proprement et rendre la main, sans laisser un mpv noir au premier plan. → test unitaire Task 3 (`onRemote('back')` en état `loading`).
3. **Alerte pendant la vidéo puis choix « continuer »** : mpv doit repasser devant **et** les touches doivent continuer d'agir sur la vidéo (relais) ; un second appui sur Retour doit toujours quitter la vidéo. → manuel sous Windows (Task 5), relais testé unitairement.
4. **Air mouse** : le pointeur bouge sans arrêt ; en mode TV l'anneau ne doit jamais disparaître et le curseur doit se masquer après 3 s d'immobilité. → e2e Task 2 (`mousemove` puis anneau toujours présent).
5. **Éteindre le PC par erreur** : chaque action d'alimentation demande une confirmation, sélection initiale sur « Annuler ». → e2e Task 6 (ouvrir, vérifier la sélection, Retour ferme).

---

### Task 1: Drapeau mode TV (réglage + `--tv`)

**Files:** Modify `src/shared/types/settings.ts` (`AppSettings.tvMode: boolean`, défaut `false`), `src/main/store/settingsRepo.ts`, `src/main/index.ts` ; Create `src/main/app/launchFlags.ts` ; IPC : `InvokeChannels.APP_TV_MODE_GET` (`'app:tvMode:get'`) et `EventChannels.APP_TV_MODE` (`'event:app:tvMode'`, payload `{ tvMode: boolean }`) dans `channels.ts`, `contract.ts`, `api.ts`, `preload/index.ts`, handler + validateur ; Test `test/main/launchFlags.test.ts`.

**Interfaces:** Produces `parseLaunchFlags(argv: string[]): { tv: boolean }` ; `effectiveTvMode(settings: AppSettings, flags: { tv: boolean }): boolean` ; côté rendu `useTvMode(): boolean` (`src/renderer/src/lib/tvMode.tsx`, contexte alimenté par `api().app.getTvMode()` + `onTvMode`).

- [ ] **Step 1: Tests** — `parseLaunchFlags(['app.exe', '--tv']).tv === true` ; `['app.exe']` → `false` ; `['app.exe', '--tvx']` → `false` ; `effectiveTvMode({ tvMode: false }, { tv: true }) === true` ; `({ tvMode: true }, { tv: false }) === true`.
- [ ] **Step 2: FAIL → implémenter → PASS.**
- [ ] **Step 3:** `second-instance` : relire les arguments de la nouvelle instance ; si `--tv`, activer le mode TV pour la session et pousser l'événement ; toujours restaurer + mettre au premier plan la fenêtre.
- [ ] **Step 4:** case « Mode TV » dans les Réglages (changement à chaud, événement poussé à tous). Commit `feat(tv): drapeau mode TV (réglage et --tv)`.

### Task 2: Présentation TV

**Files:** Modify `src/main/index.ts` (plein écran), `src/renderer/src/assets/main.css`, `App.tsx`, `components/AppNav.tsx`, `features/catalog/CategorySidebar.tsx`, `lib/remote/RemoteRuntime.ts`.

- [ ] **Step 1:** principal : `mainWindow.setFullScreen(tvMode)` à chaque changement.
- [ ] **Step 2:** rendu : `document.documentElement.classList.toggle('tv', tvMode)` ; CSS `html.tv { font-size: 150%; }` (tout est en `rem`) et marges de sécurité `html.tv body { padding: 4vh 4vw; }` ; en mode TV, `RemoteRuntime` garde `data-input="keys"` en permanence (le `mousemove` ne le change plus) ; curseur : classe `cursor-none` sur `<html>` après **3 s** sans mouvement, retirée au mouvement.
- [ ] **Step 3:** `AppNav` en mode TV : quand la zone `nav` a un enfant sélectionné (`hasFocusedChild`), elle s'élargit et montre les libellés ; ailleurs, le libellé de tout bouton-icône sélectionné est affiché sous lui (attribut `aria-label` déjà présent). Poignée de redimensionnement de `CategorySidebar` masquée.
- [ ] **Step 4:** e2e : lancer avec `--tv` → `document.documentElement.classList.contains('tv')`, fenêtre plein écran (`BrowserWindow.isFullScreen()` via `app.evaluate`), après `mouse.move` l'élément sélectionné garde `data-focused="true"` et `data-input === 'keys'`. Commit `feat(tv): présentation plein écran lisible à distance`.

### Task 3: Lecteur en mode TV

**Files:** Modify `src/main/player/PlayerController.ts` ; Create `src/main/player/remoteBindings.ts` ; IPC `EventChannels.PLAYER_REMOTE` (`'event:player:remote'`, `{ action: 'next' | 'previous' }`) ; Modify `App.tsx` ; Test `test/main/remoteBindings.test.ts`, `test/main/playerRemote.test.ts`.

**Interfaces:**
- Produces `remoteBindings(live: boolean): string[]` (lignes du fichier, valeurs des Global Constraints) ; `PlayerController.setTvMode(on: boolean)` ; `PlayerController.attachFocusApp(fn: () => void)` ; `PlayerController.handleRemote(action: string): Promise<void>` (public pour les tests).
- Comportement de `handleRemote` : `back` → `stop()` puis `focusApp()` ; `next`/`previous` → émet `PLAYER_REMOTE` ; autre → ignoré.
- `buildMpvArgs` ajoute en mode TV seulement : `--fullscreen=yes`, `--ontop=yes`, `--input-conf=<userData>/mpv-remote-<live|vod>.conf`.
- Retour automatique (mode TV) : fin de fichier sans épisode suivant enchaîné → `stop()` + `focusApp()` ; erreur définitive → `focusApp()` (l'état d'erreur reste affiché dans la barre) ; direct en reconnexion → `show-text "Reconnexion…"` dans mpv. L'enchaînement « épisode suivant » reste décidé par le rendu (`onEnded`), qui renvoie `false` quand il n'y en a pas → le rendu appelle alors `api().player.stop()` et le principal fait `focusApp()` sur l'arrêt en mode TV.

- [ ] **Step 1: Tests** — `remoteBindings(true)` contient `LEFT script-message tv2026 previous` et `ESC script-message tv2026 back` ; `remoteBindings(false)` contient `RIGHT seek 30; show-progress` et `PGDWN script-message tv2026 next`, et ne contient aucun `script-message tv2026 next` sur `RIGHT` ; `handleRemote('back')` pendant l'état `loading` → `stop` appelé puis `focusApp` appelé (contrôleur avec faux mpv, comme `test/main/playerProgress.test.ts`) ; arguments hors mode TV identiques à avant (pas de `--fullscreen=yes` ni `--input-conf`).
- [ ] **Step 2: FAIL → implémenter → PASS.**
- [ ] **Step 3:** rendu : abonnement `onRemote` → voisin précédent/suivant (déjà fait dans l'essai : `previousRef`/`nextRef` dans `App.tsx`). Commit `feat(tv): lecteur plein écran piloté à la télécommande`.

### Task 4: Relais des touches et commande « précédent » de Windows

**Files:** Modify `src/main/index.ts`, `PlayerController.ts`, `lib/remote/RemoteRuntime.ts` ; IPC `InvokeChannels.PLAYER_REMOTE_KEY` (`'player:remoteKey'`, payload `{ key: MpvRemoteKey }`, liste fermée) et `EventChannels.APP_BACK` (`'event:app:back'`).

**Interfaces:** Produces `type MpvRemoteKey = 'ENTER' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'ESC' | 'PGUP' | 'PGDWN'` ; `PlayerController.relayKey(key: MpvRemoteKey)` → commande IPC mpv `keypress <key>` (passe par le fichier de touches).

- [ ] **Step 1:** rendu : en mode TV, si une vidéo est en cours (état `playing`/`paused`/`loading`) et qu'aucune surcouche n'est ouverte (`backStack.size() === 1`), toute action télécommande est relayée à mpv (`relayKey`) au lieu de naviguer.
- [ ] **Step 2:** principal : `mainWindow.on('app-command', (_e, cmd) => cmd === 'browser-backward' && emit(APP_BACK))` ; rendu : `APP_BACK` → `backStack.dispatch()`.
- [ ] **Step 3:** test unitaire : validateur de `PLAYER_REMOTE_KEY` refuse `'q'` et `'ENTER; quit'`. Commit `feat(tv): relais des touches vers la vidéo, touche précédent de Windows`.

### Task 5: Alertes pendant la vidéo

**Files:** Modify `src/main/reminders/ReminderScheduler.ts` (`fireNotification`, `ReminderScheduler.ts:144`), `PlayerController.ts`, `features/reminders/ConflictDialog.tsx` ; Create `features/reminders/ReminderPrompt.tsx` ; IPC `EventChannels.REMINDER_PROMPT` (`'event:reminder:prompt'`, payload `Reminder`).

**Interfaces:** Produces `PlayerController.bringAppToFront(): Promise<void>` (mpv `set_property ontop false` + `focusApp()`) et `PlayerController.restoreVideoToFront(): Promise<void>` (`ontop true`).

- [ ] **Step 1:** en mode TV, `fireNotification` émet `REMINDER_PROMPT` au lieu de la notification Windows, et appelle `bringAppToFront()` si une vidéo est en cours ; idem à l'apparition d'un conflit d'enregistrement.
- [ ] **Step 2:** `ReminderPrompt` : surcouche « <titre> commence sur <chaîne> » avec « Regarder » (sélection initiale) et « Ignorer » ; Retour = Ignorer. Après un choix qui laisse la vidéo continuer (Ignorer, ou conflit résolu en gardant la lecture) → `restoreVideoToFront()` ; le relais (Task 4) assure les touches.
- [ ] **Step 3:** test unitaire du choix « notification Windows ou invite » selon `tvMode` (fonction pure extraite `alertChannel(tvMode: boolean): 'notification' | 'prompt'`). Commit `feat(tv): rappels et conflits visibles pendant la vidéo`.

### Task 6: Menu Éteindre et démarrage avec Windows

**Files:** Create `src/main/app/power.ts` ; IPC `InvokeChannels.APP_POWER` (`'app:power'`, `{ action: 'quit' | 'sleep' | 'shutdown' }`) et `InvokeChannels.APP_SET_LOGIN_ITEM` (`'app:loginItem:set'`, `{ enabled: boolean }`) ; Modify `components/AppNav.tsx`, `features/settings/SettingsScreen.tsx` ; Test `test/main/power.test.ts`.

**Interfaces:** Produces `powerCommand(action: 'sleep' | 'shutdown', platform: NodeJS.Platform): { file: string; args: string[] } | null` — win32 : sleep → `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` ; shutdown → `shutdown.exe /s /t 0` ; autres plateformes → `null` (bouton masqué). `quit` → `app.quit()`. Exécution par `execFile` (pas de shell).

- [ ] **Step 1: Tests** — valeurs exactes ci-dessus pour `win32`, `null` pour `linux` ; le validateur refuse toute autre action.
- [ ] **Step 2: FAIL → implémenter → PASS.**
- [ ] **Step 3:** `AppNav` (mode TV) : bouton « Éteindre » → surcouche avec Quitter / Mettre en veille / Éteindre le PC, puis confirmation (sélection initiale « Annuler ») ; Réglages : case « Lancer TV2026 au démarrage de Windows » → `app.setLoginItemSettings({ openAtLogin, args: ['--tv'] })` (Windows uniquement).
- [ ] **Step 4:** e2e : en `--tv`, ouvrir Éteindre → Quitter → la confirmation a « Annuler » sélectionné ; Retour ferme. Commit `feat(tv): menu Éteindre et démarrage avec Windows`.

### Task 7: Revue, PR, essai sur le mini PC, ménage

- [ ] **Step 1:** `qa-reviewer` (focus : commandes d'alimentation, validateurs IPC, fichier de touches, focus Windows) ; corrections ; `typecheck`, `vitest run`, `test:e2e`.
- [ ] **Step 2:** PR « étape 3 : mode TV », build Windows ; protocole de test pour l'utilisateur : raccourci avec `--tv`, film jusqu'à la fin, Retour pendant le chargement, rappel programmé pendant une vidéo, veille.
- [ ] **Step 3:** après fusion sur demande explicite : `git push origin --delete spike/tv-remote` et `git branch -D spike/tv-remote`.
