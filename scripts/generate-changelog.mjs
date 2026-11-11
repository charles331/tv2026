#!/usr/bin/env node
/**
 * Génère les entrées « Nouveautés » des versions publiées après le dernier
 * historique écrit à la main (src/shared/changelog.ts), dans
 * src/shared/changelog.generated.json. Lancé par la CI juste avant le build
 * d'une release (semantic-release prepareCmd, job release-linux).
 *
 *   node scripts/generate-changelog.mjs [versionEnCours]
 *
 * Pour chaque version (tag vX.Y.Z, plus `versionEnCours` pas encore taguée) :
 * les commits feat / fix / perf de l'intervalle. Chaque commit de fusion porte
 * « (#NN) » : on lit la section « ## Nouveautés » de la PR NN (puces écrites pour
 * l'utilisateur). Sans cette section, ou hors ligne, le titre du commit sert de
 * puce. Les commits sans intérêt pour l'utilisateur (ci, chore, docs…) sont
 * ignorés ; une version qui n'a que ça n'apparaît pas.
 *
 * Sans tag ni réseau (développement local), le fichier reste tel quel.
 */
/* global process, console, fetch, AbortSignal */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/shared/changelog.generated.json')
const STATIC = join(ROOT, 'src/shared/changelog.ts')
const USER_TYPES = new Set(['feat', 'fix', 'perf'])

/** "1.10.0" → [1, 10, 0] ; null si ce n'est pas un semver simple. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

/**
 * Titre de commit conventionnel → { type, description, pr } ; null si le titre
 * ne suit pas le format. « feat(player)!: x (#12) » → feat, "x", 12.
 */
export function parseSubject(subject) {
  const m = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/.exec(subject.trim())
  if (!m) return null
  let description = m[3].trim()
  let pr = null
  const prMatch = /\s*\(#(\d+)\)\s*$/.exec(description)
  if (prMatch) {
    pr = Number(prMatch[1])
    description = description.slice(0, prMatch.index).trim()
  }
  return { type: m[1].toLowerCase(), breaking: Boolean(m[2]), description, pr }
}

/** Première lettre en majuscule (style des puces). */
export function toBullet(text) {
  const t = text.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Retire le balisage Markdown courant d'une puce (gras, code, liens). */
export function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Les puces de la section « ## Nouveautés » d'une description de PR (jusqu'au
 * titre suivant de même niveau ou supérieur). Commentaires HTML ignorés ; une
 * ligne indentée qui suit une puce la prolonge. [] si pas de section.
 */
export function parseNewsSection(body) {
  if (!body) return []
  const text = body.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^#{1,3}\s*Nouveautés\b/i.test(l.trim()))
  if (start < 0) return []
  const level = /^(#+)/.exec(lines[start].trim())[1].length
  const bullets = []
  for (const line of lines.slice(start + 1)) {
    const heading = /^(#+)\s/.exec(line.trim())
    if (heading && heading[1].length <= level) break
    const item = /^\s*[-*]\s+(.*)$/.exec(line)
    if (item) {
      bullets.push(item[1])
    } else if (bullets.length > 0 && /^\s{2,}\S/.test(line)) {
      bullets[bullets.length - 1] += ' ' + line.trim()
    }
  }
  return bullets.map(stripMarkdown).filter(Boolean)
}

/**
 * Puces d'une version à partir de ses commits ({ subject }) et des descriptions
 * de PR déjà récupérées (Map numéro → body).
 */
export function bulletsForCommits(commits, prBodies) {
  const bullets = []
  for (const { subject } of commits) {
    const parsed = parseSubject(subject)
    if (!parsed || !(USER_TYPES.has(parsed.type) || parsed.breaking)) continue
    const fromPr = parsed.pr != null ? parseNewsSection(prBodies.get(parsed.pr)) : []
    if (fromPr.length > 0) bullets.push(...fromPr.map(toBullet))
    else bullets.push(toBullet(parsed.description))
  }
  return [...new Set(bullets)]
}

/** Plus haute version écrite à la main dans src/shared/changelog.ts. */
export function latestStaticVersion(source) {
  const versions = [...source.matchAll(/version:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((v) => parseVersion(v))
  return versions.sort(compareVersions).at(-1) ?? '0.0.0'
}

// ---------------------------------------------------------------- exécution --

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  try {
    const url = git('remote', 'get-url', 'origin')
    return /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)?.[1] ?? null
  } catch {
    return null
  }
}

async function fetchPrBody(slug, number) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (!slug || !token) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/pulls/${number}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'tv2026-changelog'
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    return (await res.json()).body ?? null
  } catch {
    return null
  }
}

async function main() {
  const pending = process.argv[2]?.replace(/^v/, '') || null
  if (pending && !parseVersion(pending)) throw new Error(`version invalide : ${pending}`)

  const floor = latestStaticVersion(readFileSync(STATIC, 'utf8'))
  let tags
  try {
    tags = git('tag', '--list', 'v*').split('\n').filter((t) => parseVersion(t))
  } catch {
    console.log('changelog : pas de dépôt git, fichier inchangé')
    return
  }
  tags.sort(compareVersions)

  // Intervalles [tag précédent, version] pour chaque version > floor.
  const ranges = []
  const all = tags.map((t) => ({ version: t.slice(1), ref: t }))
  if (pending && !all.some((t) => t.version === pending)) all.push({ version: pending, ref: 'HEAD' })
  for (let i = 0; i < all.length; i++) {
    if (compareVersions(all[i].version, floor) <= 0) continue
    ranges.push({ ...all[i], from: i > 0 ? all[i - 1].ref : null })
  }

  const slug = repoSlug()
  const today = new Date().toISOString().slice(0, 10)
  const entries = []
  for (const r of ranges) {
    const range = r.from ? `${r.from}..${r.ref}` : r.ref
    const log = git('log', '--no-merges', '--format=%s', range)
    const commits = log ? log.split('\n').map((subject) => ({ subject })) : []
    const prBodies = new Map()
    for (const c of commits) {
      const pr = parseSubject(c.subject)?.pr
      if (pr != null && !prBodies.has(pr)) prBodies.set(pr, await fetchPrBody(slug, pr))
    }
    const changes = bulletsForCommits(commits, prBodies)
    if (changes.length === 0) continue
    const date = r.ref === 'HEAD' ? today : git('log', '-1', '--format=%cs', r.ref)
    entries.push({ version: r.version, date, changes })
  }
  entries.sort((a, b) => compareVersions(b.version, a.version))

  writeFileSync(OUT, JSON.stringify(entries, null, 2) + '\n')
  console.log(
    `changelog : ${entries.length} version(s) après ${floor}` +
      (entries.length ? ` (${entries.map((e) => e.version).join(', ')})` : '')
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    // Jamais bloquant : une release sans Nouveautés vaut mieux que pas de release.
    console.warn(`changelog : génération ignorée (${e.message})`)
  })
}
