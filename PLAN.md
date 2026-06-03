# Plan — Application IPTV de téléchargement de films (VOD)

> App de bureau **Electron + TypeScript**, catalogue cliquable, **téléchargement** de films
> + **lecture intégrée**. Source : panel Xtream Codes `mon-panel.exemple`.

---

## 1. Faits techniques vérifiés (en direct, avec tes identifiants)

| Élément | Valeur confirmée |
|---|---|
| Type de fournisseur | **Xtream Codes** — API `player_api.php` |
| URL de base | `http://mon-panel.exemple:8080` |
| Compte | Actif, expire ~2026, **1 connexion simultanée max** |
| Catalogue films | **26 680 films**, classés par catégories |
| Métadonnées | Poster TMDB, note, genre, bande-annonce, synopsis (`get_vod_info`) |
| URL de téléchargement | `…/movie/USER/PASS/{stream_id}.{ext}` (ex. `.mkv`, `.ts`) |
| Comportement serveur | `302` redirection → backend, puis `206 Partial Content` |
| Reprise de DL | ✅ `Accept-Ranges` supporté → téléchargements **reprenables** |
| Taille typique | ~5 Go / film FHD |

### Endpoints API utiles
```
# Infos compte
/player_api.php?username=U&password=P
# Catégories de films
/player_api.php?username=U&password=P&action=get_vod_categories
# Films d'une catégorie (ou tous)
/player_api.php?username=U&password=P&action=get_vod_streams[&category_id=ID]
# Détails d'un film (synopsis, durée, casting…)
/player_api.php?username=U&password=P&action=get_vod_info&vod_id=ID
# Fichier à télécharger / streamer
/movie/U/P/{stream_id}.{container_extension}
```

---

## 2. Contraintes importantes (à garder en tête)

1. **1 seule connexion simultanée** → impossible de télécharger ET streamer en même temps.
   - File de téléchargement **séquentielle** (un film à la fois).
   - Mettre les téléchargements **en pause** pendant la lecture.
2. **Gros fichiers (~5 Go)** → reprise indispensable, vérifier l'espace disque.
3. **Lecture .mkv/.ts** : Chromium (Electron) ne lit pas ces conteneurs nativement →
   on embarque le moteur **mpv** (lit tout : mkv, ts, h264/h265, sous-titres).
4. **Token de DL temporaire** : l'URL `302` redirige vers un lien signé → toujours
   laisser le client suivre les redirections, ne pas mettre en cache l'URL finale.

---

## 3. Architecture

```
┌──────────────────────────── Electron App ────────────────────────────┐
│                                                                       │
│  RENDERER (UI)  — React + Vite + TypeScript                           │
│   • Catalogue (grille de posters, catégories, recherche)              │
│   • Fiche film (synopsis, note, bande-annonce, boutons DL / Lire)     │
│   • Panneau "Téléchargements" (file, progression, pause/reprise)      │
│   • Lecteur intégré (mpv)                                             │
│            ▲ IPC (typé)                                               │
│            ▼                                                          │
│  MAIN (Node.js) — TypeScript                                          │
│   • XtreamClient      → appels API + cache                            │
│   • DownloadManager   → file séquentielle, reprise (Range), progress  │
│   • PlayerController   → pilote mpv (lecture stream ou fichier local)  │
│   • Store (SQLite)    → cache catalogue, file de DL, réglages         │
│   • Secrets           → identifiants chiffrés (safeStorage)           │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
        │ HTTP (httpx/undici)                    │ lit fichiers locaux
        ▼                                        ▼
  Panel Xtream Codes                       Dossier de téléchargement
```

### Stack précise
- **Electron** + **electron-vite** (template Electron + Vite + TS prêt à l'emploi)
- **React** + **TypeScript** côté UI ; **TailwindCSS** pour le style
- **better-sqlite3** : cache du catalogue (26k films) + file de DL persistante
- **undici** (client HTTP rapide intégré à Node) pour API + téléchargements
- **mpv** (binaire) piloté via `node-mpv` ou IPC socket — lecture universelle
- **electron-builder** : packaging Linux (AppImage / .deb)

---

## 4. Découpage en étapes (jalons)

### Étape 0 — Scaffold
- Init projet `electron-vite` (Electron + React + TS).
- Tailwind, ESLint/Prettier, structure dossiers (`main/`, `renderer/`, `shared/`).
- Pont IPC typé entre main et renderer.

### Étape 1 — Connexion & réglages
- Écran de réglages : URL base + user + password (pré-remplis avec les tiens).
- Stockage **chiffré** des identifiants (`safeStorage`).
- Bouton "Tester la connexion" → affiche statut compte + date d'expiration.

### Étape 2 — Catalogue
- `XtreamClient` : récupère catégories + films, met en cache dans SQLite.
- UI : barre latérale catégories, grille de posters, **recherche** (sur 26k titres),
  pagination/scroll infini (ne pas tout charger d'un coup).
- Fiche film : synopsis (`get_vod_info`), note, genre, bande-annonce (lien YouTube).

### Étape 3 — Téléchargement (cœur du besoin) ⭐
- Construire l'URL `/movie/U/P/{id}.{ext}`.
- `DownloadManager` :
  - téléchargement vers fichier `.part` puis renommage final ;
  - **reprise** via en-tête `Range` si interruption ;
  - **file séquentielle** (respecte la limite 1 connexion) ;
  - progression (octets, %, vitesse, ETA) envoyée à l'UI en temps réel ;
  - pause / reprise / annuler ;
  - file **persistée** en SQLite (survit à un redémarrage).
- Réglage : dossier de destination + nommage propre (`Titre (Année).mkv`).
- Notification système à la fin d'un téléchargement.

### Étape 4 — Lecture intégrée
- `PlayerController` pilote **mpv** :
  - lire un **film déjà téléchargé** (fichier local) ;
  - ou **streamer** directement depuis l'URL (avant de télécharger).
- Mise en **pause automatique des téléchargements** pendant la lecture
  (à cause de la limite 1 connexion).
- Contrôles : play/pause, barre de progression, volume, plein écran, sous-titres.

### Étape 5 — Finitions
- Thème sombre, états de chargement, gestion des erreurs (token expiré, réseau).
- Indicateur "déjà téléchargé" sur les fiches.
- Gestion de l'espace disque (avertir si insuffisant).

### Étape 6 — Packaging
- **Cible retenue : Windows (.exe)** — l'app tournera sous Windows, WSL2 servant au dev.
- `electron-builder` → installeur Windows (NSIS `.exe`) + version portable.
- Le **dossier de téléchargement** sera un dossier Windows (ex. `C:\Users\...\Vidéos`).
- mpv : on embarque le binaire **Windows** de mpv dans le package.

---

## 5. Questions ouvertes / à décider en cours de route
- **Cible = Windows (.exe)** ✅ décidé. Dev sous WSL2, exécution sous Windows.
- Dossier de téléchargement par défaut (ex. `C:\Users\...\Vidéos` ou un disque dédié).
- Faut-il aussi gérer les **séries** (saisons/épisodes) plus tard, ou films seulement ?
- Sous-titres : extraire ceux intégrés au mkv suffit, ou télécharger des `.srt` externes ?

---

## 6. Rappel
Usage strictement personnel via **ton propre abonnement**. L'app ne fait que
récupérer des fichiers que ton compte est autorisé à lire.
