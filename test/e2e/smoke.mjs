/**
 * End-to-end smoke test of the BUILT app (out/), driven by Playwright, against
 * the fake provider (test/e2e/fakeProvider.mjs) and a throw-away profile: no
 * real provider, no real user data. Run with `pnpm test:e2e` (builds first).
 *
 * Needs a display (Linux: DISPLAY, e.g. WSLg :0). Exit code 1 on failure.
 * The XTREAM_* environment variables take priority over the repo's .env in dev
 * builds (see src/main/secrets/credentials.ts), so the app talks to the fake.
 */
/* global process, console, document */
import { _electron as electron } from 'playwright'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeProvider } from './fakeProvider.mjs'

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const provider = await startFakeProvider({ fail: ['series'] })
const profile = mkdtempSync(join(tmpdir(), 'tv2026-e2e-'))
const env = {
  ...process.env,
  XTREAM_URL: provider.url,
  XTREAM_USER: 'demo',
  XTREAM_PASS: 'demo',
  DISPLAY: process.env.DISPLAY || ':0'
}
delete env.ELECTRON_RUN_AS_NODE
const launch = () =>
  electron.launch({ args: ['out/main/index.js', `--user-data-dir=${profile}`], env })

let app
try {
  // 1st launch creates the database; then seed downloads + a cached series.
  app = await launch()
  await (await app.firstWindow()).waitForTimeout(2500)
  await app.close()
  const db = new Database(join(profile, 'tv2026.db'))
  const now = Date.now()
  db.prepare(`INSERT INTO series (series_id,name,updated_at) VALUES (7,'La Série Test',?)`).run(now)
  db.prepare(`INSERT INTO series_info_cache (series_id,info_json,fetched_at) VALUES (7,?,?)`).run(
    JSON.stringify({
      seriesId: 7, name: 'La Série Test', plot: null, cast: null, director: null, genre: null,
      year: null, rating: null, cover: null, backdropUrls: [], trailer: null,
      seasons: [{ seasonNumber: 1, name: null, episodes: [{ episodeId: 1000, title: 'Ép 1', season: 1, episodeNum: 1, containerExtension: 'mkv', durationSecs: 2600, plot: null, rating: null, image: null }] }]
    }),
    now
  )
  const q = db.prepare(
    `INSERT INTO download_queue (stream_id,name,file_name,dest_path,container_extension,status,total_bytes,received_bytes,created_at,updated_at,kind)
     VALUES (?,?,?,?,'mkv',?,1000,?,?,?,?)`
  )
  q.run(42, 'FR - Le Film Test (2026)', 'film.mkv', join(profile, 'film.mkv'), 'paused', 400, now, now, 'movie')
  q.run(1000, 'La Série Test S01E01', 'ep.mkv', join(profile, 'ep.mkv'), 'completed', 1000, now, now, 'series')
  q.run(99, 'Film disparu', 'gone.mkv', join(profile, 'gone.mkv'), 'failed', 0, now, now, 'movie')
  db.close()

  app = await launch()
  const page = await app.firstWindow()
  await page.waitForTimeout(2500)
  const body = () => page.locator('body').innerText()

  // « Tout mettre à jour » : séries en panne, films et chaînes quand même à jour.
  await page.getByRole('button', { name: /^Tout mettre à jour/ }).first().click()
  await page.getByRole('button', { name: 'Tout mettre à jour', exact: true }).last().click()
  await page.waitForFunction(() => /Échec pour|Catalogues à jour/.test(document.body.innerText), null, { timeout: 30_000 })
  const toast = (await body()).match(/(Mis à jour[^\n]*|Catalogues à jour[^\n]*)/)?.[0] ?? ''
  check('Tout mettre à jour continue après une panne', /3 films/.test(toast) && /séries/.test(toast) && /chaînes/.test(toast), toast)

  // Journal : une ligne par catalogue, réussite ou échec.
  await page.getByRole('button', { name: /^Réglages/ }).first().click()
  await page.getByText('Journal', { exact: true }).first().click()
  await page.waitForTimeout(800)
  const journal = await body()
  check('Journal : films mis à jour', /Catalogue des films mis à jour : 3 films/.test(journal))
  check('Journal : échec des séries', /Catalogue des séries non mis à jour/.test(journal))

  // Fiche film : la taille vérifiée apparaît aussi sur l'affiche, sans recharger.
  await page.getByRole('button', { name: 'Accueil' }).first().click()
  await page.getByPlaceholder(/rechercher/i).first().fill('Film Test')
  await page.waitForTimeout(1200)
  const poster = page.locator('button[title="FR - Le Film Test (2026)"]').first()
  check('Affiche sans taille avant la fiche', !/[GM]o/.test(await poster.innerText()))
  await poster.click()
  await page.getByRole('dialog').waitFor()
  await page.waitForFunction(() => !/Vérification du fichier…/.test(document.body.innerText), null, { timeout: 15_000 })
  check('Fiche : taille du fichier', /1,8\s?Go|1,7\s?Go|1\.8\s?G/.test(await page.getByRole('dialog').innerText()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('Affiche : taille sans recharger', /[GM]o/.test(await poster.innerText()), (await poster.innerText()).replace(/\n/g, ' | '))

  // Recherche tolérante : sans accents, mots dans le désordre.
  await page.getByPlaceholder(/rechercher/i).first().fill('bleu elephant')
  const elephant = page.locator('button[title="FR - L’Éléphant bleu (2024)"]').first()
  await elephant.waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Recherche sans accents, mots dans le désordre', await elephant.isVisible())

  // Téléchargements : le titre ouvre la fiche (film, série, ou message).
  await page.getByRole('button', { name: 'Téléchargements' }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'FR - Le Film Test (2026)' }).click()
  await page.getByRole('dialog').waitFor()
  check('Téléchargement → fiche du film', /Le Film Test/.test(await page.getByRole('dialog').innerText()))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'La Série Test S01E01' }).click()
  await page.waitForTimeout(1000)
  check('Téléchargement → fiche de la série', await page.getByRole('dialog').getByText('Saison 1').first().isVisible())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Film disparu' }).click()
  await page.waitForTimeout(600)
  check('Film disparu → message', /plus dans le catalogue/.test(await body()))

  // Direct, recherche dans les guides : la chaîne d'un programme à venir s'ouvre au clic.
  await page.getByRole('button', { name: 'Direct' }).first().click()
  await page.getByLabel('Chercher aussi dans les guides').check()
  await page.getByPlaceholder(/rechercher/i).first().fill('Marathon')
  await page.getByText('Marathon solo').first().waitFor({ timeout: 20_000 })
  // La barre de lecture se ferme par « Arrêter », ou « Fermer » si la lecture a échoué.
  const closePlayer = page.getByRole('button', { name: /^(Arrêter|Fermer)$/ })
  for (const name of ['Solo TV', 'Chaîne Test FHD']) {
    // « Chaîne Test FHD » : la variante du programme de demain (dernier bouton de ce nom).
    const target = page.getByRole('button', { name, exact: true }).last()
    const clickable = (await target.count()) > 0 && (await target.isEnabled())
    // Le titre de la barre de lecture : un <p title="nom de la chaîne">.
    const playing = page.locator(`p[title="${name}"]`)
    if (clickable) {
      await target.click()
      await playing.waitFor({ timeout: 5000 }).catch(() => undefined)
    }
    const opened = clickable && (await playing.isVisible())
    check(`Programme à venir → ouvre la chaîne « ${name} »`, opened, clickable ? '' : 'rien à cliquer')
    if (await closePlayer.isVisible()) await closePlayer.click()
    await page.waitForTimeout(600)
  }

  // Direct, liste des chaînes : cliquer sur la chaîne (logo ou nom) la lance.
  await page.getByPlaceholder(/rechercher/i).first().fill('Solo')
  const row = page.locator('button[title="Regarder Solo TV"]')
  await row.first().waitFor({ timeout: 10_000 }).catch(() => undefined)
  const rowClickable = (await row.count()) > 0
  if (rowClickable) {
    await row.first().click()
    await page.locator('p[title="Solo TV"]').waitFor({ timeout: 5000 }).catch(() => undefined)
  }
  check(
    'Liste des chaînes → clic sur la chaîne la lance',
    rowClickable && (await page.locator('p[title="Solo TV"]').isVisible()),
    rowClickable ? '' : 'rien à cliquer'
  )
  if (await closePlayer.isVisible()) await closePlayer.click()
  await page.waitForTimeout(600)

  // Nouveautés : 3 versions, les autres repliées.
  await page.getByRole('button', { name: /^Réglages/ }).first().click()
  await page.getByText('Application', { exact: true }).first().click()
  await page.waitForTimeout(600)
  const news = await body()
  check('Nouveautés : versions précédentes repliées', /Afficher les versions précédentes \(\d+\)/.test(news))
} catch (e) {
  check('scénario terminé sans exception', false, e instanceof Error ? e.message.split('\n')[0] : String(e))
} finally {
  await app?.close().catch(() => undefined)
  provider.close()
  rmSync(profile, { recursive: true, force: true })
}

console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert')
process.exit(failures.length ? 1 : 0)
