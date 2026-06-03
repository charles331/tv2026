/**
 * Application changelog — SOURCE OF TRUTH for the "Nouveautés" section in
 * Réglages and the "what's new" badge after an update.
 *
 * Keep this list newest-first. When you bump `version` in package.json, add a
 * matching entry here (a unit test asserts the current version is documented).
 * Dates are ISO `YYYY-MM-DD`. `changes` are short, user-facing French bullets.
 */

export interface ChangelogEntry {
  /** Semantic version, matching a published release (e.g. "0.1.1"). */
  version: string
  /** Release date, ISO `YYYY-MM-DD`. */
  date: string
  /** Short, user-facing change bullets (French). */
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.7.0',
    date: '2026-06-03',
    changes: [
      'Favoris : ajoutez films, séries et chaînes en favori avec l’étoile (sur les fiches et les chaînes).',
      'Chaque section affiche une catégorie « ★ Favoris » en tête, listant vos favoris.',
      'Un favori dont la source a disparu après un rafraîchissement reste listé avec un statut « Hors ligne » (rouge).',
      'Le logo en haut à gauche est désormais distinct du bouton Catalogue.'
    ]
  },
  {
    version: '0.6.0',
    date: '2026-06-03',
    changes: [
      'Le logo en haut à gauche ramène désormais au catalogue (Accueil).',
      'Colonne des catégories : largeur ajustable (glisser le bord) et champ de filtre.',
      'Bouton « Tout mettre à jour » (films + séries + direct) dans la barre de gauche, avec confirmation et notification de fin.'
    ]
  },
  {
    version: '0.5.0',
    date: '2026-06-02',
    changes: [
      'Direct (TV) : nouvelle section pour parcourir les chaînes par catégorie, avec le programme en cours / à suivre (EPG) et la lecture en direct.'
    ]
  },
  {
    version: '0.4.0',
    date: '2026-06-02',
    changes: [
      'Séries : navigation par catégories, recherche, fiche série avec saisons et épisodes, lecture et téléchargement par épisode.',
      'Fiches films : la note du fournisseur et la note TMDB sont affichées toutes les deux, avec un lien vers IMDb.',
      'Téléchargements : bouton « Réessayer » sur un téléchargement échoué (reprend là où il s’est arrêté).'
    ]
  },
  {
    version: '0.3.0',
    date: '2026-06-02',
    changes: [
      'Note TMDB en direct sur les fiches films (clé API TMDB facultative, stockée chiffrée).',
      'Correctif : un téléchargement bloqué au renommage sous Windows (antivirus/indexeur, « EBUSY ») se termine désormais tout seul, sans tout retélécharger.'
    ]
  },
  {
    version: '0.2.1',
    date: '2026-06-02',
    changes: [
      'Releases : l’installeur et la version portable ont enfin des libellés distincts.'
    ]
  },
  {
    version: '0.2.0',
    date: '2026-06-02',
    changes: [
      'Nouvelle section « Nouveautés » dans les réglages, avec un repère après chaque mise à jour.',
      'Publication automatique des nouvelles versions (basée sur les messages de commit).'
    ]
  },
  {
    version: '0.1.1',
    date: '2026-06-02',
    changes: ['Correctif de lecture : la vidéo s’ouvre désormais dans une fenêtre mpv dédiée.']
  },
  {
    version: '0.1.0',
    date: '2026-06-01',
    changes: [
      'Première version de TV2026.',
      'Connexion à un panel Xtream Codes (identifiants chiffrés localement).',
      'Catalogue VOD : catégories, recherche, fiches détaillées.',
      'Téléchargement de films avec reprise après coupure et file séquentielle.',
      'Lecture intégrée via mpv (fichier local ou streaming direct).',
      'Mise à jour automatique via GitHub Releases.'
    ]
  }
]
