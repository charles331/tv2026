# Bibliothèque des fichiers téléchargés — conception

Date : 2026-11-24. Projet 1 sur 2 de l'évolution des téléchargements (le projet 2, torrents, sera conçu séparément ; la bibliothèque doit seulement lui laisser une place).

## Intention

Aujourd'hui, pour regarder un film téléchargé, l'utilisateur va dans l'onglet Téléchargements, clique sur le titre (la fiche s'ouvre), puis sur Lire. Ce qui est fini y est mélangé à la file d'attente et aux échecs, et il n'existe aucune liste « mes fichiers ». Sur le mini PC branché à la TV (pilotage à la télécommande, livré en v0.19.0), c'est encore plus pénible.

But : **retrouver d'un coup d'œil ce qui est sur le disque et le lancer en un appui**, et **pouvoir libérer de la place** sans risque d'erreur.

## Objectifs

- Un onglet **Bibliothèque** dans le menu principal : grille d'affiches de ce qui est téléchargé, OK lance la lecture.
- Une source de vérité **propre à la bibliothèque**, remplie au fil des téléchargements et enregistrements, et qui garde ce qu'on sait de chaque fichier (série, affiche).
- **Actualiser** : retrouver les fichiers vidéo ajoutés à la main dans le dossier de téléchargement.
- **Supprimer** un fichier, avec double vérification.
- Utilisable entièrement à la télécommande (primitives de `src/renderer/src/lib/remote/`) comme à la souris.

## Non-objectifs

- Torrents (projet 2). La bibliothèque prévoit seulement une colonne d'origine (`source`).
- Suggestions automatiques de ménage, suppression automatique des films vus.
- Fichiers hors du dossier de téléchargement configuré ; synchronisation entre PC (décision de l'utilisateur, déjà prise pour la télécommande).
- Modifier l'onglet Téléchargements, sauf ce qui est dit plus bas.

## Anti-objectifs (échec même si « ça marche »)

- Un fichier supprimé par un seul appui distrait, ou supprimé définitivement sans passer par la Corbeille.
- La bibliothèque qui se vide parce que le dossier est momentanément inaccessible (disque externe débranché).
- Une entrée qui reste affichée alors que le fichier n'existe plus (erreur au moment de lire).
- L'actualisation qui sort du dossier de téléchargement (liens symboliques, chemins remontants) ou qui ajoute des fichiers non vidéo.

## Contraintes

- Electron 44, React 19, better-sqlite3 (migrations dans `src/main/store/schema.ts`), IPC typé (`src/shared/ipc/*`), sécurité Electron existante (pas d'accès disque depuis le renderer).
- Arborescence actuelle : `<downloadDir>/Films`, `<downloadDir>/Séries`, `<downloadDir>/Live` (`downloadSubfolder`, `src/main/downloads/helpers.ts`), chemins vérifiés par `assertPathWithin`.
- Une seule connexion au fournisseur : la bibliothèque doit fonctionner sans réseau (tout ce qu'elle affiche est en base ou sur le disque ; affiches = URL déjà connues, absentes hors ligne → vignette par défaut).
- Progression de lecture existante (`watch_progress`, `ProgressKind = 'movie' | 'series' | 'live'` ; un épisode est rangé sous la clé `series` + id d'épisode) : la bibliothèque la réutilise, avec une correspondance `episode` → `series`.
- `download_history` n'est jamais vidé (« Vider l'historique » ne touche que les lignes terminées de `download_queue`) ; il ne contient ni série, ni affiche, ni numéro de saison/épisode.
- Préfixes FR masqués à l'affichage (`displayName`).

## Approches envisagées

1. **Table dédiée remplie à la fin de chaque téléchargement** — retenue par l'utilisateur. Indépendante de l'historique, prête pour les torrents (`source`), un peu plus de travail (migration + reprise de l'existant).
2. S'appuyer sur `download_history` (terminés + fichier présent) — plus rapide, mais l'historique ne sait rien des séries ni des affiches, et les torrents n'y ont pas leur place. (Correction après relecture du code : « Vider l'historique » ne touche pas `download_history`, contrairement à ce qui avait été dit à l'utilisateur ; cela ne change pas le choix.)
3. Parcourir le dossier et reconnaître les fichiers par leur nom — trouve les ajouts manuels mais fragile. **Retenue en complément** de l'approche 1, sous forme du bouton « Actualiser » (demande de l'utilisateur).

## Ce que l'utilisateur a décidé

- Onglet **Bibliothèque** dans le menu (pas une catégorie dans Films/Séries, pas un simple bouton Lire dans l'historique).
- OK sur un film = lecture directe.
- Approche 1 + **actualisation** pour les films ajoutés à la main.
- **Suppression avec double vérification.**

## Conception

### Données

Nouvelle table `library_items` (migration suivante) :

| colonne | sens |
|---|---|
| `id` | clé |
| `kind` | `movie` \| `episode` \| `recording` \| `file` (fichier non reconnu) |
| `source` | `download` (file d'attente), `recording` (enregistrement du direct), `scan` (trouvé par Actualiser) ; `torrent` réservé au projet 2 |
| `stream_id` | film ou épisode du fournisseur, null si inconnu |
| `series_id` | série de l'épisode, null sinon |
| `title` | nom brut (affiché via `displayName`) |
| `image` | URL d'affiche connue, null sinon |
| `file_path` | chemin absolu, **unique** |
| `size_bytes` | taille au moment de l'ajout/actualisation |
| `added_at` | date d'ajout (tri) |

Alimentation :
- **Fin de téléchargement réussie** (`DownloadManager`, statut `completed`) → insertion (film ou épisode). La série et l'affiche ne sont **pas** connues de la file aujourd'hui : ajouter `series_id`, `image` (et saison/épisode) à `download_queue` et à la requête d'ajout (`DOWNLOADS_ADD`), renseignés par la fiche film / série au moment du clic sur Télécharger.
- **Fin d'un enregistrement du direct**, programmé (`ReminderScheduler`) **ou lancé à la main depuis le lecteur** (`PLAYER_START_RECORDING`) → insertion `recording` (titre = « chaîne — programme » ou nom de la chaîne).
- **Migration** : reprise des lignes `download_history` terminées dont le fichier existe encore (si plusieurs lignes ont le même chemin, la plus récente). Films : affiche retrouvée dans `vod_streams` par `stream_id`. Épisodes : série retrouvée dans `series_info_cache` quand l'épisode y figure ; sinon, série et `SxxEyy` lus dans le nom (les noms sont de la forme « Série S01E02 ») → groupés sous ce nom de série, vignette par défaut. Seuls les épisodes dont le nom ne donne rien vont dans « Autres fichiers ».
- **Actualiser** (voir plus bas) → insertion `scan`.
- À chaque ouverture de l'onglet et à chaque actualisation, les entrées dont le fichier n'existe plus sont **retirées** (pas d'entrée fantôme) — **sauf si le dossier qui les contient est lui-même introuvable** (disque débranché) : on n'efface rien et l'écran l'indique (« Dossier de téléchargement introuvable »).
- **Dossier changé dans les Réglages** : les entrées de l'ancien dossier restent listées et restent lisibles et supprimables. La lecture et la suppression se font par l'identifiant de l'entrée : le main process lit le chemin en base et vérifie sur le disque qu'il n'est pas devenu un lien symbolique ; le renderer n'envoie jamais de chemin. L'actualisation ne parcourt que le dossier actuel.

### Écran Bibliothèque

- Entrée de menu « Bibliothèque » (icône à créer), entre Direct et Téléchargements ; clé de focus `nav-library`, zone `screen-library`.
- En-tête : titre, **espace libre du disque** du dossier de téléchargement et place occupée par la bibliothèque, bouton **Actualiser**.
- Onglets en rangée : **Films**, **Séries**, **Enregistrements**, et **Autres fichiers** (affiché seulement s'il y en a).
- Grille d'affiches (même carte que Films : `CardCaption`, barre de progression, « Vu »), taille du fichier en méta. Tri : plus récent en premier.
- **Film** : OK = lecture du fichier local (reprise si commencé, comme `MovieDetail`). Le bouton « Fiche » (ou clic droit / bouton secondaire) ouvre la fiche du film quand il est encore au catalogue.
- **Série** : une affiche par série. OK ouvre une fenêtre (frontière, Retour ferme) qui liste les épisodes téléchargés, triés par saison/épisode, sélection sur le prochain épisode non vu ; OK = lecture ; « Épisode suivant » du lecteur reste limité à ce que fait déjà le lecteur.
- **Enregistrement** / **Autre fichier** : vignette par défaut, nom du fichier ; OK = lecture.
- Pilotage télécommande : mêmes règles que les autres écrans (zones, grille indexée, Retour, retour de sélection).
- État vide : message expliquant que les téléchargements terminés apparaîtront ici, avec un lien vers Films.

### Lecture

Lecture **toujours du fichier local**, sans passer par le fournisseur (fonctionne hors ligne et ne prend pas la connexion unique). Réutilise le lecteur existant (mpv) avec le titre et la clé de progression de l'élément (`movie` + id du film, `series` + id de l'épisode). Pour `recording` et `file`, une clé de progression propre à la bibliothèque (ex. `file` + `id`) si le modèle de progression le permet ; sinon pas de reprise pour ces deux types (au constructeur de trancher, voir plus bas).

### Actualiser

- Parcourt `<downloadDir>/Films`, `/Séries`, `/Live` et la racine du dossier, **récursivement**, sans suivre les liens symboliques ni sortir du dossier (`assertPathWithin` sur chaque chemin réel).
- Garde seulement les extensions vidéo : `.mkv .mp4 .avi .m4v .mov .ts .webm .wmv .mpg .mpeg`. Ignore les `.part`, les fichiers de moins de 1 Mo et **les fichiers en cours d'écriture** (enregistrement du direct en cours, téléchargement en cours).
- Fichier déjà connu (même chemin) : met à jour sa taille. Fichier nouveau :
  - dans `Films` ou à la racine : essai de reconnaissance d'un film du catalogue par le nom (titre normalisé avec la normalisation de recherche existante `search_norm`, année entre parenthèses si présente). **Une seule correspondance** → `movie` avec son affiche ; sinon → `file`.
  - dans `Séries` : motif `SxxEyy` dans le nom → `episode`, rattaché à la série du catalogue si son nom est reconnu, sinon groupé sous le nom lu (vignette par défaut, comme pour la reprise) ; pas de motif → `file`.
  - Un fichier déjà connu garde ses informations (série, affiche, origine) : seule sa taille est mise à jour.
  - dans `Live` : `recording`.
- Fin : message « N fichiers ajoutés, M retirés ».

### Suppression (double vérification)

- Bouton « Supprimer » sur l'élément sélectionné (dans la fenêtre d'épisodes pour une série : par épisode ; pas de suppression d'une série entière d'un coup).
- **1re confirmation** : « Supprimer “Titre” (4,2 Go) ? » — boutons Annuler (sélectionné) / Supprimer.
- **2e confirmation** : « Vraiment ? Le fichier ira dans la Corbeille. » — Annuler (sélectionné) / Oui, supprimer. Retour = Annuler aux deux étapes.
- Le main process vérifie que le chemin est dans le dossier de téléchargement, puis `shell.trashItem` (Corbeille). Si la Corbeille échoue, **on ne supprime pas définitivement** : message d'erreur.
- Si une lecture de ce fichier, ou un enregistrement / téléchargement qui l'écrit, est en cours : refus avec message.
- Après suppression : entrée retirée, espace libre mis à jour, « Vu »/progression conservés.

### Onglet Téléchargements

Inchangé (« Vider l'historique » ne touche que la liste de la session et n'a aucun effet sur la bibliothèque).

## Décisions prises après la relecture (à valider par l'utilisateur)

- Épisodes déjà téléchargés dont la série est inconnue : groupés par le nom de série lu dans le fichier.
- Dossier de téléchargement changé : les anciens fichiers restent lisibles et supprimables.
- Enregistrements lancés à la main : ajoutés automatiquement, comme les programmés.
- Dossier introuvable : on n'efface rien de la bibliothèque.

## Laissé au constructeur

- Nom et dessin de l'icône, libellés exacts, disposition fine de l'en-tête.
- Détail de la reconnaissance par nom (seuils, nettoyage des noms de fichiers), tant que « une seule correspondance sinon `file` » est respecté.
- Clé de progression pour `recording`/`file` (ou pas de reprise pour eux) selon ce que le modèle `watch_progress` permet sans migration lourde.
- Découpage des étapes du plan, tests unitaires des fonctions pures (filtre d'extensions, reconnaissance par nom, parcours borné), parcours e2e avec le faux fournisseur.
