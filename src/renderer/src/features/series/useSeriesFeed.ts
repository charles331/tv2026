/**
 * Infinite, paginated series feed (browse or search), mirroring useStreamFeed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Page, SeriesStream } from '@shared/index'
import { api, describeError, unwrap } from '../../lib/ipc'

export const PAGE_SIZE = 60

export interface SeriesFeedParams {
  categoryId: string | null
  query: string
  sortBy: 'name' | 'lastModified' | 'rating' | 'year'
  sortDir: 'asc' | 'desc'
}

export interface SeriesFeed {
  items: SeriesStream[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  reload: () => void
}

export function useSeriesFeed(params: SeriesFeedParams): SeriesFeed {
  const { categoryId, query, sortBy, sortDir } = params
  const [items, setItems] = useState<SeriesStream[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reqToken = useRef(0)

  const fetchPage = useCallback(
    async (pageToLoad: number): Promise<Page<SeriesStream>> => {
      const trimmed = query.trim()
      if (trimmed.length > 0) {
        return unwrap(
          await api().series.search({
            query: trimmed,
            categoryId,
            page: pageToLoad,
            pageSize: PAGE_SIZE
          })
        )
      }
      return unwrap(
        await api().series.list({ categoryId, page: pageToLoad, pageSize: PAGE_SIZE, sortBy, sortDir })
      )
    },
    [categoryId, query, sortBy, sortDir]
  )

  useEffect(() => {
    const token = ++reqToken.current
    setLoading(true)
    setError(null)
    setItems([])
    setPage(1)
    fetchPage(1)
      .then((res) => {
        if (token !== reqToken.current) return
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e) => {
        if (token !== reqToken.current) return
        setError(describeError(e))
        setItems([])
        setTotal(0)
      })
      .finally(() => {
        if (token === reqToken.current) setLoading(false)
      })
  }, [fetchPage])

  const hasMore = items.length < total

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    const token = reqToken.current
    const next = page + 1
    setLoadingMore(true)
    fetchPage(next)
      .then((res) => {
        if (token !== reqToken.current) return
        setItems((prev) => {
          const seen = new Set(prev.map((it) => it.seriesId))
          const merged = [...prev]
          for (const it of res.items) if (!seen.has(it.seriesId)) merged.push(it)
          return merged
        })
        setTotal(res.total)
        setPage(next)
      })
      .catch((e) => {
        if (token === reqToken.current) setError(describeError(e))
      })
      .finally(() => {
        if (token === reqToken.current) setLoadingMore(false)
      })
  }, [fetchPage, hasMore, loading, loadingMore, page])

  const reload = useCallback(() => {
    reqToken.current++
    setPage(1)
    setLoading(true)
    setError(null)
    setItems([])
    const token = reqToken.current
    fetchPage(1)
      .then((res) => {
        if (token !== reqToken.current) return
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e) => {
        if (token === reqToken.current) setError(describeError(e))
      })
      .finally(() => {
        if (token === reqToken.current) setLoading(false)
      })
  }, [fetchPage])

  return { items, total, loading, loadingMore, error, hasMore, loadMore, reload }
}
