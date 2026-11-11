import { describe, expect, it } from 'vitest'
import {
  bulletsForCommits,
  latestStaticVersion,
  parseNewsSection,
  parseSubject
} from '../../scripts/generate-changelog.mjs'

describe('generate-changelog', () => {
  it('parses conventional commit titles with their PR number', () => {
    expect(parseSubject('feat(downloads): ouvrir la fiche (#66)')).toEqual({
      type: 'feat',
      breaking: false,
      description: 'ouvrir la fiche',
      pr: 66
    })
    expect(parseSubject('fix!: tout casser')?.breaking).toBe(true)
    expect(parseSubject('Merge branch main')).toBeNull()
  })

  it('reads the bullets of the "## Nouveautés" section only', () => {
    const body = [
      '## Résumé',
      '- technique, pas pour l’utilisateur',
      '',
      '## Nouveautés',
      '<!-- une puce par changement visible -->',
      '- Le **titre** d’un téléchargement ouvre la `fiche`.',
      '- Une puce sur',
      '  deux lignes.',
      '### Détail (sous-titre, toujours dans la section)',
      '* [Lien](https://example.com) conservé en texte',
      '',
      '## Vérifié',
      '- tests'
    ].join('\n')
    expect(parseNewsSection(body)).toEqual([
      'Le titre d’un téléchargement ouvre la fiche.',
      'Une puce sur deux lignes.',
      'Lien conservé en texte'
    ])
    expect(parseNewsSection('## Résumé\n- x')).toEqual([])
    expect(parseNewsSection(null)).toEqual([])
  })

  it('keeps user-facing commits, preferring the PR section over the title', () => {
    const commits = [
      { subject: 'feat(downloads): cliquer ouvre la fiche (#66)' },
      { subject: 'fix(settings): nouveautés à jour (#65)' },
      { subject: 'ci(dependabot): 60 jours (#70)' },
      { subject: 'chore(deps): bump x (#71)' }
    ]
    const bodies = new Map<number, string | null>([
      [66, '## Nouveautés\n- Cliquer sur un téléchargement ouvre sa fiche.'],
      [65, null]
    ])
    expect(bulletsForCommits(commits, bodies)).toEqual([
      'Cliquer sur un téléchargement ouvre sa fiche.',
      'Nouveautés à jour'
    ])
  })

  it('finds the newest hand-written version', () => {
    expect(latestStaticVersion("version: '0.9.0' version: '0.16.1' version: '0.10.0'")).toBe('0.16.1')
  })
})
