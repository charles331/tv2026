/**
 * End-to-end smoke test of the BUILT app (out/), driven by Playwright, against
 * the fake provider (test/e2e/fakeProvider.mjs) and a throw-away profile: no
 * real provider, no real user data. Run with `pnpm test:e2e` (builds first).
 *
 * Needs a display (Linux: DISPLAY, e.g. WSLg :0). Exit code 1 on failure.
 * The XTREAM_* environment variables take priority over the repo's .env in dev
 * builds (see src/main/secrets/credentials.ts), so the app talks to the fake.
 */
/* global process, console, document, window */
import { _electron as electron } from 'playwright'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeProvider } from './fakeProvider.mjs'

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const profile = mkdtempSync(join(tmpdir(), 'tv2026-e2e-'))

// A real 200 s video (tiny test pattern) so mpv can really play, seek and end.
// Needs ffmpeg + mpv; without them the real-playback checks are skipped.
const videoPath = join(profile, 'video.mp4')
const hasTool = (name) => spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0
const realPlayback =
  hasTool('ffmpeg') &&
  spawnSync('mpv', ['--version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync(
    'ffmpeg',
    ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5', '-t', '200',
     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath],
    { stdio: 'ignore' }
  ).status === 0
const provider = await startFakeProvider({ fail: ['series'], videos: realPlayback ? { 43: videoPath, 1000: videoPath, 1001: videoPath } : {}
})
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
      seasons: [{ seasonNumber: 1, name: null, episodes: [
        { episodeId: 1000, title: 'Ép 1', season: 1, episodeNum: 1, containerExtension: 'mkv', durationSecs: 2600, plot: null, rating: null, image: null },
        { episodeId: 1001, title: 'Ép 2', season: 1, episodeNum: 2, containerExtension: 'mkv', durationSecs: 2600, plot: null, rating: null, image: null }
      ] }]
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
  // Un film commencé (43:12 sur 1 h 40) : à reprendre.
  db.prepare(
    `INSERT INTO watch_progress (kind,item_id,position_secs,duration_secs,watched,updated_at,name,container_extension)
     VALUES ('movie',42,2592,6000,0,?,'FR - Le Film Test (2026)','mkv')`
  ).run(now)
  db.close()

  app = await launch()
  const page = await app.firstWindow()
  await page.waitForTimeout(2500)
  const body = () => page.locator('body').innerText()
  // La barre de lecture se ferme par « Arrêter », ou « Fermer » si la lecture a échoué.
  const closePlayer = page.getByRole('button', { name: /^(Arrêter|Fermer)$/ })
  const playerStatus = async () => (await page.evaluate(() => window.api.player.status())).data
  // Attendre que mpv lise vraiment (« playing » arrive avant le chargement du fichier).
  const waitPlaying = async () => {
    for (let i = 0; i < 150; i++) {
      const s = await playerStatus()
      if (s.state === 'playing' && s.positionSecs > 0.3) return
      await page.waitForTimeout(200)
    }
    throw new Error('la lecture n’a pas démarré')
  }
  const progressOf = (kind, id) => {
    const ro = new Database(join(profile, 'tv2026.db'), { readonly: true })
    try {
      return ro.prepare('SELECT * FROM watch_progress WHERE kind = ? AND item_id = ?').get(kind, id)
    } finally {
      ro.close()
    }
  }

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
  // Reprise de lecture : barre sur l'affiche, « Reprendre à » sur la fiche.
  const dialogText = await page.getByRole('dialog').innerText()
  check(
    'Fiche : propose de reprendre',
    /Reprendre à 43:12/.test(dialogText) && /Depuis le début/.test(dialogText)
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check('Affiche : barre de progression', await poster.getByRole('progressbar').isVisible())
  check('Affiche : taille sans recharger', /[GM]o/.test(await poster.innerText()), (await poster.innerText()).replace(/\n/g, ' | '))

  // « Reprendre » dans la barre latérale : la liste, puis retirer un film.
  await page.getByPlaceholder(/rechercher/i).first().fill('')
  await page.getByRole('button', { name: /^▶ Reprendre/ }).click()
  await page.getByText(/Arrêté à 43:12/).waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Reprendre : le film commencé est listé', /Arrêté à 43:12 · reste 56 min/.test(await body()))
  await page.getByRole('button', { name: 'Retirer' }).click()
  await page.getByText('Rien à reprendre').waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Reprendre : retirer vide la liste', /Rien à reprendre/.test(await body()))
  await page.getByRole('button', { name: /^Tous les films/ }).click()

  // Lecture réelle : la position est enregistrée à l'arrêt, puis la lecture reprend là.
  if (realPlayback) {
    await page.getByPlaceholder(/rechercher/i).first().fill('Autre Film')
    const other = page.locator('button[title="FR - Autre Film (2025) CAM"]').first()
    await other.click()
    await page.getByRole('dialog').getByRole('button', { name: /^Lire/ }).click()
    await waitPlaying()
    await page.evaluate(() => window.api.player.seek({ positionSecs: 100 }))
    await page.waitForTimeout(2000)
    await closePlayer.click()
    await page.waitForTimeout(800)
    const saved = progressOf('movie', 43)
    check(
      'Lecture réelle : position enregistrée à l’arrêt',
      saved != null && saved.position_secs >= 100 && saved.position_secs < 110 && saved.watched === 0,
      saved ? `${saved.position_secs} s sur ${Math.round(saved.duration_secs)} s` : 'aucune ligne'
    )
    await other.click()
    await page.getByRole('dialog').getByRole('button', { name: /^Reprendre à 1:4\d/ }).click()
    await waitPlaying()
    await page.waitForTimeout(1000)
    const resumed = await playerStatus()
    check(
      'Lecture réelle : reprend où on s’était arrêté',
      resumed.positionSecs >= 95 && resumed.positionSecs < 115,
      `${Math.round(resumed.positionSecs)} s`
    )
    // Aller presque à la fin : le film passe en « vu » et quitte « Reprendre ».
    await page.evaluate(() => window.api.player.seek({ positionSecs: 197 }))
    await page.waitForFunction(() => !/Arrêter/.test(document.body.innerText), null, { timeout: 20_000 })
    const done = progressOf('movie', 43)
    check('Lecture réelle : film terminé marqué « vu »', done != null && done.watched === 1 && done.position_secs === 0)
    await page.getByPlaceholder(/rechercher/i).first().fill('')

    // Épisode suivant : bouton dans la barre, et enchaînement en fin d'épisode.
    await page.getByRole('button', { name: 'Séries', exact: true }).click()
    await page.locator('button[title="La Série Test"]').first().click()
    const episodes = page.getByRole('dialog')
    await episodes.getByText('Ép 1').waitFor()
    await episodes.getByRole('button', { name: 'Lire' }).first().click()
    await waitPlaying()
    const nextEp = page.getByRole('button', { name: 'Épisode suivant' })
    const prevEp = page.getByRole('button', { name: 'Épisode précédent' })
    check(
      'Épisode : « suivant » proposé, « précédent » grisé au premier',
      (await nextEp.isEnabled()) && (await prevEp.isDisabled())
    )
    await page.evaluate(() => window.api.player.seek({ positionSecs: 197 }))
    // Fin du fichier : l'épisode 2 démarre tout seul.
    let chained = null
    for (let i = 0; i < 100; i++) {
      chained = await playerStatus()
      if (/S01E02/.test(chained.title ?? '') && chained.state === 'playing' && chained.positionSecs > 0.3) break
      await page.waitForTimeout(200)
    }
    check('Épisode : le suivant s’enchaîne en fin de lecture', /S01E02/.test(chained?.title ?? ''), chained?.title ?? '')
    check('Épisode : le premier est marqué « vu »', progressOf('series', 1000)?.watched === 1)
    check('Épisode : la barre reste ouverte', await closePlayer.isVisible())
    await prevEp.click()
    for (let i = 0; i < 100; i++) {
      chained = await playerStatus()
      if (/S01E01/.test(chained.title ?? '') && chained.state === 'playing') break
      await page.waitForTimeout(200)
    }
    check('Épisode : « précédent » revient au premier', /S01E01/.test(chained?.title ?? ''), chained?.title ?? '')
    await closePlayer.click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Catalogue' }).first().click()
  } else {
    console.log('– Lecture réelle ignorée (ffmpeg ou mpv absent)')
  }

  // Recherche tolérante : sans accents, mots dans le désordre.
  await page.getByPlaceholder(/rechercher/i).first().fill('bleu elephant')
  const elephant = page.locator('button[title="FR - L’Éléphant bleu (2024)"]').first()
  await elephant.waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Recherche sans accents, mots dans le désordre', await elephant.isVisible())

  // Recherche globale : films, séries et chaînes d'un seul champ, puis « Tout voir ».
  await page.keyboard.press('Control+k')
  const globalField = page.getByPlaceholder(/rechercher partout/i)
  await globalField.fill('test')
  await page.getByRole('heading', { name: /^Chaînes/ }).waitFor({ timeout: 5000 }).catch(() => undefined)
  const found = await body()
  check(
    'Recherche globale : films, séries et chaînes',
    /Le Film Test/.test(found) && /La Série Test/.test(found) && /Chaîne Test HD/.test(found)
  )
  await globalField.fill('film')
  const seeAll = page.getByRole('button', { name: /^Tout voir/ })
  // 3 films « film » < 12 affichés : pas de « Tout voir » ; la requête reste en revenant.
  check('Recherche globale : pas de « Tout voir » si tout est affiché', (await seeAll.count()) === 0)
  await page.getByRole('button', { name: 'Catalogue' }).first().click()
  await page.getByRole('button', { name: /^Recherche/ }).first().click()
  check('Recherche globale : la requête est conservée', (await globalField.inputValue()) === 'film')
  await page.getByRole('button', { name: 'Catalogue' }).first().click()
  await page.waitForTimeout(400)

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

  // Zapping : chaîne suivante / précédente de la catégorie, puis chaînes récentes.
  await page.getByPlaceholder(/rechercher/i).first().fill('')
  await page.locator('button[title="Regarder Solo TV"]').first().click()
  await page.locator('p[title="Solo TV"]').waitFor({ timeout: 5000 }).catch(() => undefined)
  await page.getByRole('button', { name: 'Chaîne suivante' }).click()
  await page.locator('p[title="Chaîne Test HD"]').waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Zapping : chaîne suivante (retour à la première)', await page.locator('p[title="Chaîne Test HD"]').isVisible())
  await page.getByRole('button', { name: 'Chaîne précédente' }).click()
  await page.locator('p[title="Solo TV"]').waitFor({ timeout: 5000 }).catch(() => undefined)
  check('Zapping : chaîne précédente', await page.locator('p[title="Solo TV"]').isVisible())
  if (await closePlayer.isVisible()) await closePlayer.click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^🕘 Récentes/ }).click()
  const recentNames = await page.locator('button[title^="Regarder "]').evaluateAll((els) => els.map((e) => e.title))
  check(
    'Chaînes récentes : la dernière regardée en premier',
    recentNames[0] === 'Regarder Solo TV' && recentNames.includes('Regarder Chaîne Test HD'),
    recentNames.join(' | ')
  )

  // Nouveautés : 3 versions, les autres repliées.
  await page.getByRole('button', { name: /^Réglages/ }).first().click()
  await page.getByText('Application', { exact: true }).first().click()
  await page.waitForTimeout(600)
  const news = await body()
  check('Nouveautés : versions précédentes repliées', /Afficher les versions précédentes \(\d+\)/.test(news))
} catch (e) {
  check(
    'scénario terminé sans exception',
    false,
    e instanceof Error ? e.message.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ') : String(e)
  )
} finally {
  await app?.close().catch(() => undefined)
  provider.close()
  rmSync(profile, { recursive: true, force: true })
}

console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert')
process.exit(failures.length ? 1 : 0)
