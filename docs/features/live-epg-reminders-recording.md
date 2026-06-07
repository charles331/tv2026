# Feature — Guide EPG complet, rappels de programmes & enregistrement programmé

> Statut : **proposition / analyse** (aucune implémentation encore).
> Branche : `feat/live-epg-reminders-recording`.
> Domaine : Live TV. Étend la section « Direct » existante (EPG now/next déjà en place).

## 1. Besoin (user stories)

En tant qu'utilisateur de la section **Direct**, je veux :

1. **Voir la grille complète** des programmes d'une chaîne (pas seulement « en cours / à suivre »), comme dans les autres applis IPTV.
2. **Mettre un programme précis en favori / rappel** (ex. un match, un film à 20 h 30).
3. **Recevoir une notification sur mon PC** quand ce programme démarre (et idéalement quelques minutes avant), **dans l'application** (notification système Windows, tant que l'app tourne).
4. **Programmer l'enregistrement** d'un programme à l'avance, pour être sûr de ne pas le rater même si je ne suis pas devant.

## 2. Faisabilité EPG (réponse directe à la question)

**Oui, la grille complète est fournie par l'EPG.** Aujourd'hui le code n'utilise que `get_short_epg` (now/next, `liveService.getShortEpg`). Xtream Codes expose en plus :

| Endpoint | Renvoie | Usage ici |
|---|---|---|
| `player_api.php?action=get_short_epg&stream_id=X&limit=N` | les N prochains programmes | déjà utilisé (now/next) |
| `player_api.php?action=get_simple_data_table&stream_id=X` | **toute la grille** de la chaîne | **à ajouter** (guide complet) |
| `xmltv.php` | XMLTV global (toutes chaînes) | hors scope (trop volumineux) |

Le format de `get_simple_data_table` est le même `epg_listings[]` que le short EPG (type `RawEpgListing` existant) : `id`, `epg_id`, `title`/`description` (base64), `start`/`end`, `start_timestamp`/`stop_timestamp` (epoch, UTC), `now_playing`, `has_archive`. On réutilise donc le mapper `mapEpg` existant.

**Limites connues :**
- La **profondeur** dépend du fournisseur (certains ne renvoient que la journée, d'autres 3–7 jours ; quelques-uns presque rien).
- Les **IDs EPG** (`id`/`epg_id`) ne sont pas garantis stables entre deux rafraîchissements → on identifie un programme par une **clé naturelle** `(stream_id, start_timestamp, title)`.
- Le champ `has_archive` (catch-up) ouvre la voie au « replay », mais c'est **hors scope** de cette feature.

## 3. Découpage technique

### Composant A — Guide EPG complet (lecture seule, faible risque)
- `XtreamClient.getFullEpg(streamId)` → `get_simple_data_table`, réutilise `mapEpg`.
- `liveService` : cache court (ex. 5 min) par chaîne.
- IPC : `live.fullEpg(streamId)` → `EpgEntry[]` (triés par `startSecs`).
- UI : panneau **« Guide »** par chaîne (liste groupée par jour, programme en cours surligné), ouvert depuis `LiveChannelRow` ou une vue dédiée.

### Composant B — Persistance des rappels (migration SQLite v5)
Nouvelle table `programme_reminders` :

| colonne | type | rôle |
|---|---|---|
| `id` | INTEGER PK | id interne |
| `stream_id` | INTEGER | chaîne |
| `channel_name`, `channel_icon` | TEXT | snapshot affichage |
| `epg_id` | TEXT NULL | id fournisseur si présent |
| `title`, `description` | TEXT | snapshot programme |
| `start_secs`, `end_secs` | INTEGER | horaires (epoch) |
| `lead_secs` | INTEGER | rappel X s **avant** le début |
| `mode` | TEXT | `notify` \| `record` \| `notify_record` |
| `status` | TEXT | `scheduled` \| `notified` \| `recording` \| `completed` \| `missed` \| `failed` \| `canceled` \| `conflict` |
| `file_path` | TEXT NULL | fichier d'enregistrement |
| `created_at`, `updated_at` | INTEGER | |

Unicité naturelle : `(stream_id, start_secs, title)`.

### Composant C — Scheduler (processus principal)
- `ReminderScheduler` singleton : au démarrage + **tick** (toutes ~20–30 s), lit les rappels à venir/à déclencher.
- **Notifications** : `Notification` native d'Electron, déclenchée à `start − lead`. Clic → ouvrir/lire la chaîne. Anti-doublon via `status = notified`.
- **Recalage / app éteinte** : un programme dont l'heure est passée pendant que l'app était fermée → `missed` (option : notif « raté »).
- Logique **pure et testable** (calcul des échéances, transitions d'état, détection de conflits) isolée du timer/OS.

### Composant D — Enregistrement programmé (le point délicat)
- **Mécanisme headless** : `mpv --stream-dump=<dossier Live>/<titre> <date>.ts <url-live>` — pas de fenêtre, pas de décodage, **copie brute** du flux (idéal). Démarre à `start − padBefore`, s'arrête à `end + padAfter`.
- `RecordingController` **séparé** du `PlayerController` interactif (suivi pid + échéance d'arrêt + fichier). Réutilise `downloadSubfolder('live')`.
- **⚠️ Contrainte connexion unique (`ConnectionLock`)** — point structurant :
  - Un enregistrement live = **une** connexion fournisseur.
  - vs **téléchargements** : l'enregistrement prend la priorité (les téléchargements se mettent en pause, comme pour la lecture).
  - vs **lecture en cours** : on ne peut pas regarder la chaîne B **et** enregistrer la chaîne A en même temps (1 seule connexion). → **on demande sur le moment** (continuer la lecture / basculer sur l'enregistrement) — voir §6.
  - **Deux enregistrements** qui se chevauchent = impossible → le second passe en `conflict` + notification.
- **app/PC doivent tourner** : pas d'enregistrement si l'app est fermée (voir Composant F).

### Composant E — UI / réglages
- **Guide chaîne** : par programme, boutons **« 🔔 Rappel »** et **« ⏺ Enregistrer »**.
- Nouvel onglet/section **« Programmés »** : rappels & enregistrements (à venir / en cours / passés) avec leur statut, annulation possible.
- **Notification native** au démarrage ; clic → ouvre la chaîne.
- **Réglages** : délai de rappel par défaut (`lead`), marges d'enregistrement (`padBefore`/`padAfter`), « l'enregistrement programmé interrompt-il une lecture en cours ? ».

### Composant F — Fonctionnement en arrière-plan (étape ultérieure)
Pour que rappels/enregistrements marchent sans fenêtre ouverte : **icône en zone de notification (tray)** + **lancement au démarrage de Windows**. Proposé comme **étape 6 (optionnelle)**, pas dans le MVP.

## 4. IPC / API ajoutés (aperçu)
- `live.fullEpg(streamId)` → `EpgEntry[]`.
- `reminders.list()` / `add(req)` / `cancel(id)` / `update(id, patch)`.
- Événements main → renderer : rappel déclenché, enregistrement démarré/arrêté/échoué (pour rafraîchir l'UI « Programmés »).

## 5. Plan d'implémentation (incrémental, chaque étape testable et mergeable)
1. **EPG complet** : client + IPC + vue Guide. *(pur lecture, aucun risque)*
2. **Persistance rappels** : migration v5 + repo + IPC + boutons « Rappel » dans le guide *(sans scheduler)*.
3. **Scheduler + notifications natives** (mode `notify`).
4. **Enregistrement programmé headless** : `RecordingController`, intégration `ConnectionLock`, politique de conflit, padding.
5. **Vue « Programmés » + réglages** (lead, padding, interruption lecture).
6. **(Option/futur)** tray + lancement au démarrage pour fonctionner en arrière-plan.

## 6. Décisions retenues

1. **Délai de rappel** par défaut : **2 min** avant le début (réglable).
2. **Conflit de connexion** (un enregistrement programmé doit démarrer pendant une lecture) : **demander sur le moment** — une notification/dialogue propose de *continuer la lecture* ou de *basculer sur l'enregistrement*. (Vis-à-vis des téléchargements, l'enregistrement reste prioritaire et les met en pause, comme la lecture.)
3. **Marges d'enregistrement** par défaut : **+1 min avant / +2 min après** (réglables).
4. **Mode arrière-plan** (tray + autostart) : **étape 6, plus tard**. MVP = rappels/enregistrements actifs **tant que l'app est ouverte**.
5. **Périmètre de la 1re livraison** : **étapes 1 → 5 en une fois** (guide, rappels, scheduler/notifications, enregistrement programmé, vue « Programmés » + réglages). L'étape 6 (arrière-plan) viendra ensuite.

## 7. Risques / hypothèses
- Profondeur et qualité de l'EPG **dépendent du fournisseur**.
- Fuseaux horaires : on s'appuie sur `start_timestamp`/`stop_timestamp` (epoch) pour éviter les ambiguïtés.
- IDs EPG instables → clé `(stream_id, start_secs, title)`.
- `mpv --stream-dump` : à **valider sur Windows** (lisibilité du `.ts`, gestion EOF/coupures réseau, relance éventuelle).
- Notifications & enregistrements **uniquement si l'app tourne** (jusqu'à l'étape 6).
- Tests : logique du scheduler (échéances, transitions, conflits) en unitaire ; enregistrement headless validé sur le build Windows.
