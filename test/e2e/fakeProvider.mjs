/**
 * Fake Xtream provider for the e2e tests: a local HTTP server that answers the
 * few player_api.php actions the app uses, plus 1-byte Range requests on movie
 * files (size check). Nothing leaves the machine — the real provider is never
 * contacted, so the tests can run while the real app is downloading.
 *
 * `fail` lists catalogues whose refresh must fail (HTTP 500): 'movies',
 * 'series', 'live'.
 */
/* global URL */
import { createServer } from 'node:http'

export const MOVIES = [
  { stream_id: 42, name: 'FR - Le Film Test (2026)', category_id: 1, container_extension: 'mkv', duration: '01:40:00', size: 1_800_000_000 },
  { stream_id: 43, name: 'FR - Autre Film (2025) CAM', category_id: 1, container_extension: 'mp4', duration: '01:30:00', size: 700_000_000 }
]

export function startFakeProvider({ fail = [] } = {}) {
  const json = (res, body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/player_api.php') {
      const action = url.searchParams.get('action')
      const failing =
        (fail.includes('movies') && action?.startsWith('get_vod_')) ||
        (fail.includes('series') && action?.startsWith('get_series')) ||
        (fail.includes('live') && action?.startsWith('get_live'))
      if (failing && action !== 'get_vod_info') return json(res, { error: 'panne simulée' }, 500)
      switch (action) {
        case null:
          return json(res, {
            user_info: { auth: 1, status: 'Active', username: 'demo', max_connections: '1', active_cons: '0', exp_date: null },
            server_info: { url: '127.0.0.1', timezone: 'Europe/Brussels' }
          })
        case 'get_vod_categories':
          return json(res, [{ category_id: 1, category_name: 'Films test', parent_id: 0 }])
        case 'get_vod_streams':
          return json(
            res,
            MOVIES.map((m) => ({
              stream_id: m.stream_id,
              name: m.name,
              category_id: m.category_id,
              container_extension: m.container_extension,
              rating: '7',
              added: '1762000000'
            }))
          )
        case 'get_vod_info': {
          const m = MOVIES.find((x) => x.stream_id === Number(url.searchParams.get('vod_id')))
          if (!m) return json(res, { info: [], movie_data: [] })
          return json(res, {
            info: { name: m.name, plot: 'Synopsis de test.', duration: m.duration },
            movie_data: { stream_id: m.stream_id, name: m.name, container_extension: m.container_extension }
          })
        }
        case 'get_series_categories':
        case 'get_series':
        case 'get_live_categories':
        case 'get_live_streams':
          return json(res, [])
        default:
          return json(res, [])
      }
    }
    const movie = /^\/movie\/[^/]+\/[^/]+\/(\d+)\.\w+$/.exec(url.pathname)
    if (movie) {
      const m = MOVIES.find((x) => x.stream_id === Number(movie[1]))
      if (!m) return res.writeHead(404).end()
      res.writeHead(206, { 'content-range': `bytes 0-0/${m.size}`, 'content-length': '1' })
      return res.end('x')
    }
    if (url.pathname === '/xmltv.php') {
      res.writeHead(200, { 'content-type': 'application/xml' })
      return res.end('<?xml version="1.0"?><tv></tv>')
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })
    )
  )
}
