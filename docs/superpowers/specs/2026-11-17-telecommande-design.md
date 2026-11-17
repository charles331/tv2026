# Pilotage à la télécommande et mode TV — conception

Date : 2026-11-17 · Statut : à valider (relu par un relecteur ; réponses de l'utilisateur intégrées)

## 1. Intention

L'utilisateur veut brancher un mini PC Windows sur sa télévision et piloter
TV2026 avec une télécommande : **haut, bas, gauche, droite, OK, retour**. Le PC
de bureau (souris + clavier) reste utilisé en parallèle : **les deux usages
coexistent**.

Aujourd'hui, l'interface est pensée pour la souris : la sélection n'est pas
visible, des actions n'apparaissent qu'au survol, les fenêtres se ferment au
clic sur le fond, et la vidéo s'ouvre dans une fenêtre mpv séparée de 70 %.

Réussite = depuis le canapé, sans souris, on peut tout faire : choisir un film
ou une série et le lancer, zapper en direct, revoir un programme, reprendre une
lecture, gérer favoris et téléchargements, chercher (avec le clavier au dos de
la télécommande), puis revenir à l'application après la vidéo.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Toute l'application navigable avec ↑ ↓ ← → / OK / Retour, sur PC comme sur TV.
- Un « mode TV » : plein écran, lisible à 3 m, vidéo plein écran pilotable à la
  télécommande, retour automatique à l'application.
- Le mode PC reste aussi pratique à la souris qu'aujourd'hui, et gagne la
  navigation au clavier.

**Non-objectifs (pour l'instant)**
- Clavier virtuel à l'écran (la télécommande visée a un clavier au dos).
- Pilotage par la télécommande du téléviseur via HDMI-CEC.
- Télécommande sur téléphone, manette de jeu (Gamepad API).
- Réintégrer la vidéo dans la fenêtre de l'application (échec connu sous
  Windows, cf. `PlayerController.ts`).
- Refonte visuelle de type « interface TV » (carrousels, accueil éditorial).
- **Partage entre machines** (décision de l'utilisateur) : le PC de bureau et le
  mini PC sont deux installations indépendantes ; favoris, reprises et
  programmations ne sont pas synchronisés. Le fournisseur n'autorisant qu'une
  connexion, regarder sur les deux en même temps en coupera un : limite connue,
  non traitée.

**Anti-objectifs (échec même si « ça marche »)**
- Une sélection qu'on perd de vue, ou qui saute à un endroit inattendu.
- Retour qui ferme l'application ou fait perdre l'endroit où l'on était.
- Un écran ou une fenêtre où l'on reste bloqué sans souris.
- Le mode PC dégradé (anneaux de sélection pendant l'usage à la souris,
  vidéo imposée en plein écran sur le PC).

## 3. Contraintes

- Electron 44 + React 19 + Tailwind 4 ; pas de routeur (route = `useState` dans
  `App.tsx`) ; overlays en `fixed inset-0` sans piège de focus.
- La grille des films (~26 700) est virtualisée maison (`PosterGrid.tsx`) : les
  cartes hors écran **n'existent pas dans le DOM**.
- Les autres listes (séries, chaînes) sont paginées par `IntersectionObserver`.
- mpv reste le lecteur (codecs, décodage matériel). Fenêtre séparée.
- Fournisseur limité à 1 connexion (inchangé, pas concerné).
- Fusion d'une PR seulement sur demande explicite de l'utilisateur.

## 4. Ce qui est déjà validé (essai jetable, branche `spike/tv-remote`)

Testé par l'utilisateur sous Windows le 2026-11-17, **tout fonctionne** :
- mpv lancé avec `--fullscreen=yes --ontop=yes --input-conf=<fichier>` ;
- touches définies dans ce fichier ; celles que l'application doit traiter
  envoient `script-message tv2026 <action>`, reçu sur l'IPC JSON existante
  comme événement `client-message` ;
- Retour (Échap / Retour arrière / `BACK`) → `stop()` puis
  `mainWindow.show()+focus()` : Windows rend bien la main à l'application.
- Noms de touches mpv vérifiés : `BACK`, `MBTN_BACK`, `PLAYPAUSE`, `KP_ENTER`
  (pas `XF86_BACK`).

## 5. Approches considérées

| Approche | Pour | Contre |
|---|---|---|
| **A. Bibliothèque Norigin Spatial Navigation** (`@noriginmedia/norigin-spatial-navigation` 3.4, MIT, React ≥ 16.8) | Conçue pour les applications React de TV ; zones de focus imbriquées, frontières (modales), mémoire du dernier élément par zone, carte de touches configurable | Une dépendance ; ne gère pas seule les listes virtualisées |
| B. Navigation spatiale intégrée à Chromium (`--enable-spatial-navigation`) | Zéro code | Expérimentale, aucun contrôle (modales, mémoire, grilles virtualisées), comportement imprévisible |
| C. Navigation faite maison (géométrie DOM) | Contrôle total | Réécrit ce que A fait déjà, plus de bugs |

**Choix : A** (décision de Claude, l'utilisateur a délégué le « comment »),
complétée par une **navigation par index** pour les grandes grilles (§6.4).

Pour la vidéo, approche retenue et validée : **mpv plein écran au premier plan
avec un jeu de touches dédié** (§4). Écartées : vidéo intégrée (échec connu),
fenêtre transparente au-dessus de mpv (fragile sous Windows).

## 6. Conception

### 6.1 Couche « touches »
Un module unique `src/renderer/src/lib/remote/keys.ts` traduit un
`KeyboardEvent` en action : `up | down | left | right | ok | back | playpause | null`.
- `ok` : Entrée, Entrée du pavé numérique.
- `back` : Échap ; Retour arrière **hors champ de saisie** ;
  `BrowserBack` (keyCode 166) ; bouton « précédent » de la souris (button 3).
- Sous Windows, certaines télécommandes envoient la commande d'application
  `browser-backward` : le processus principal écoute `app-command` sur la
  fenêtre et la relaie au rendu comme une action `back` (nouvel événement IPC).
- Fonction pure, testée unitairement.
- Type de télécommande inconnu à ce jour : la conception vaut pour une
  télécommande « clavier » comme pour une « air mouse » (qui bouge aussi le
  pointeur et dont OK peut arriver comme un clic).
- **Taper une lettre hors champ de saisie** (clavier au dos de la
  télécommande) ouvre la Recherche globale avec cette lettre déjà saisie
  (décision de Claude).

### 6.2 Pile « Retour »
Un hook `useBackHandler(handler, active)` empile un gestionnaire ; l'action
`back` appelle **le plus récent**. Ordre attendu :
1. fenêtre/modale ouverte → la fermer ;
2. champ de saisie actif → quitter le champ (le texte reste) ;
3. fiche film / série → la fermer, la sélection revient sur l'affiche d'origine ;
4. contenu d'un écran → sélection sur le menu de catégories, puis sur le menu
   principal (`AppNav`) ;
5. menu principal → rien (pas de fermeture de l'application).

Remplace les écouteurs Échap actuels de `MovieDetail` et `SeriesDetail`.
Le raccourci Ctrl+K reste.

### 6.3 Zones de focus et mémoire
- Zones : `AppNav` (gauche) | catégories | barre d'outils (recherche, tri) |
  contenu. ← / → passent d'une zone à l'autre.
- Chaque overlay (`MovieDetail`, `SeriesDetail`, `ChannelGuide`,
  `ConflictDialog`, confirmations) est une **frontière de focus** : la
  sélection ne peut pas en sortir. À l'ouverture, elle va sur l'action
  principale (Lire / Reprendre ; `ConflictDialog` : le choix qui ne coupe rien).
  À la fermeture, elle revient sur l'élément qui l'a ouverte.
- **Mémoire par écran** : en quittant une route, on retient la clé de
  l'élément sélectionné (et, pour une grille, son index + la catégorie) ; en
  revenant, on la restaure. Les routes étant démontées au changement, la
  mémoire vit dans un contexte au niveau de `App`.
- Le focus DOM suit la sélection (`shouldFocusDOMNode`), pour que les champs de
  saisie et les lecteurs d'écran fonctionnent.

### 6.4 Grandes listes
- `PosterGrid` (virtualisée) et `SeriesGrid` : la grille est **une seule zone**
  qui gère elle-même les flèches par index : ← / → = ±1, ↑ / ↓ = ± nombre de
  colonnes ; elle fait défiler pour garder l'élément visible, déclenche le
  chargement de la page suivante à l'approche de la fin, et rend la main à la
  zone voisine aux bords (↑ sur la première ligne → barre d'outils, ← sur la
  première colonne → catégories). Calcul de l'index = fonction pure testée.
- Listes de chaînes, épisodes, guide, téléchargements : navigation Norigin
  standard (éléments présents dans le DOM) + défilement pour garder visible.
- `LiveChannelRow` : la ligne entière est une cible ; OK = lire ; → = bouton
  « Guide » de la ligne ; favori accessible de la même façon.

### 6.5 Composants à adapter
- **Style de sélection global** : anneau épais couleur d'accent + léger
  agrandissement des cartes. En mode PC, visible seulement après usage du
  clavier (masqué quand on bouge la souris, comme `:focus-visible`). **En mode
  TV, toujours visible** : une air mouse bouge le pointeur sans arrêt, la
  sélection ne doit jamais disparaître (décision de Claude).
- La navigation aux flèches et le nouveau Retour sont actifs pour tous dès
  l'étape 1, sans option : ils ne gênent pas l'usage à la souris (décision de
  Claude).
- **Survol uniquement** : bouton « retirer des favoris » (`FavoritesView`)
  visible aussi quand la carte est sélectionnée ; soulignements de survol
  doublés d'un style de sélection.
- **Sélecteurs de tri** (`<select>` natifs, `CatalogScreen`, `SeriesScreen`) :
  remplacés par un bouton qui ouvre une petite liste navigable (le menu natif
  intercepte mal les flèches).
- **Cases à cocher** : OK bascule.
- **Curseurs** (`SeekBar`, `VolumeSlider`) : ← / → ajustent quand ils sont
  sélectionnés ; ↑ / ↓ sortent.
- **Champs de saisie** : ← / → déplacent le curseur de texte ; ↑ / ↓ sortent
  du champ ; OK valide (va aux résultats).
- **Fonds cliquables des modales** : inchangés pour la souris.
- Poignée de redimensionnement de `CategorySidebar` : souris seulement, masquée
  en mode TV.
- **Boutons-icônes** : en mode TV, le libellé de l'élément sélectionné est
  affiché (les infobulles `title` ne s'affichent pas sans souris) ; `AppNav`
  s'élargit avec ses libellés quand il a la sélection.

### 6.6 Mode TV
- Activation : réglage « Mode TV » (`AppSettings.tvMode`), **ou** argument de
  lancement `--tv` qui le force (raccourci du mini PC). Changement à chaud.
- Effets :
  - fenêtre principale en plein écran ;
  - classe `tv` sur `<html>` : taille de police racine agrandie (Tailwind est en
    `rem`, tout suit), marges de sécurité ~4 % pour les téléviseurs qui rognent ;
  - curseur masqué après 3 s sans mouvement de souris ;
  - entrée « Éteindre » dans `AppNav` (plus de barre de fenêtre) : Quitter
    l'application, Mettre le PC en veille, Éteindre le PC, chacun avec
    confirmation — quitter seul laisserait l'utilisateur sur le bureau Windows
    sans souris (décision de Claude) ;
  - **lecture** : arguments mpv de l'essai (§4) — plein écran, premier plan,
    touches télécommande, retour → arrêt + application au premier plan ;
    le fichier de touches est écrit dans le dossier privé de l'application
    (`userData`), pas dans le dossier temporaire ;
  - option « Lancer TV2026 au démarrage de Windows » (`setLoginItemSettings`,
    avec `--tv`).
- **Retour automatique à l'application** (mode TV, décision de Claude) : fin
  d'un film ou du dernier épisode → arrêt + application au premier plan ;
  épisode suivant → enchaîné comme aujourd'hui ; erreur définitive → application
  au premier plan avec le message d'erreur ; direct en reconnexion → reste
  dans mpv avec un message « Reconnexion… » à l'écran.
- **Alertes pendant une vidéo** (décision de l'utilisateur : « ramener
  l'application ») : un conflit d'enregistrement ou un rappel fait passer
  l'application devant la vidéo (mpv `ontop` désactivé + fenêtre au premier
  plan) et affiche la question (`ConflictDialog`) ou le rappel (nouvelle
  fenêtre dans l'application « X commence sur Y — Regarder / Ignorer ») au
  lieu de la notification Windows. Après le choix, si la vidéo continue, mpv
  repasse devant.
  **Risque à vérifier sous Windows** : l'application ne peut pas donner le
  focus clavier à la fenêtre mpv. Prévu : tant qu'une vidéo est en cours en
  mode TV et que l'application a le focus, elle relaie les touches à mpv
  (commande IPC `keypress`, qui passe par le même fichier de touches).
- Hors mode TV, le lecteur reste exactement comme aujourd'hui.
- Touches mpv en mode TV : celles de l'essai (film : OK pause, ← / → −10 s /
  +30 s, ↑ / ↓ audio / sous-titres, Page préc./suiv. épisode ; direct :
  ← → ↑ ↓ zapping, OK nom de la chaîne ; Retour quitter).

### 6.7 Diagnostic
Réglages → « Tester la télécommande » : affiche, pour chaque touche pressée,
`key`, `code`, `keyCode` et l'action reconnue. Sert à adapter la carte de
touches à la télécommande réelle sans recompiler (la carte reste dans le code ;
on ajoute la touche manquante dans une version suivante).

## 7. Découpage en étapes (une PR chacune)

1. **Socle + Films** : dépendance, couche touches, pile Retour, style de
   sélection, `AppNav`, écran Films complet (catégories, recherche, tri, grille
   virtualisée), `MovieDetail`, mémoire de sélection. C'est le plus risqué :
   validé par l'utilisateur au clavier avant la suite.
2. **Tous les autres écrans** : Séries + `SeriesDetail`, Direct (+ guide,
   recherche dans les guides, rattrapage), Recherche globale (+ « taper une
   lettre ouvre la recherche »), Reprendre,
   Favoris, Programmés + `ConflictDialog`, Téléchargements, Réglages,
   confirmations, barre du lecteur, écran « Tester la télécommande ».
3. **Mode TV** : réglage + `--tv`, plein écran, mise à l'échelle et marges,
   curseur, menu Éteindre, libellés des icônes, touches mpv (repris de
   l'essai, fichier dans `userData`), relais `app-command`, retour
   automatique, alertes pendant la vidéo + relais des touches à mpv,
   démarrage avec Windows.
   Suppression de la branche `spike/tv-remote`.

Chaque étape est publiée (version CI) et testée par l'utilisateur sous Windows
avant la suivante.

## 8. Qualité (cycle complet)

- TDD sur les fonctions pures : carte de touches, pile Retour, navigation par
  index dans une grille, arguments mpv / fichier de touches du mode TV.
- E2E (`test/e2e/smoke.mjs`, Playwright + Electron, faux fournisseur) : un
  parcours **au clavier seul** par étape (ex. étape 1 : menu → Films →
  catégorie → film → Retour → sélection revenue sur l'affiche ; étape 2 :
  chaîne → guide → Retour ; étape 3 : `--tv` → plein écran, classe `tv`).
- Revue de code (agent `qa-reviewer`) avant chaque PR ; CI verte.
- Test manuel par l'utilisateur sous Windows avec la télécommande.

## 9. Laissé au constructeur

Noms exacts des composants/fichiers, valeurs visuelles (taille de police TV,
épaisseur de l'anneau), délai de masquage du curseur, découpage interne des
commits, organisation des tests e2e.
