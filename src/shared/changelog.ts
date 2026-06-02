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
