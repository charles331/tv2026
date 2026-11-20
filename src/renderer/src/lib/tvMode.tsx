/**
 * TV mode in the renderer: the effective value (setting, or launched with
 * --tv) pushed by the main process. The <html> element gets the `tv` class,
 * which the stylesheet uses (larger text, safe margins).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { api } from './ipc'
import { setTvModeForRemote } from './remote/RemoteRuntime'

const TvModeContext = createContext(false)

export function TvModeProvider({ children }: { children: ReactNode }): ReactElement {
  const [tvMode, setTvMode] = useState(false)
  useEffect(() => {
    let alive = true
    void api()
      .app.getTvMode()
      .then((r) => {
        if (alive && r.ok) setTvMode(r.data.tvMode)
      })
    const off = api().app.onTvMode((e) => setTvMode(e.tvMode))
    return () => {
      alive = false
      off()
    }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('tv', tvMode)
    setTvModeForRemote(tvMode)
  }, [tvMode])
  return <TvModeContext.Provider value={tvMode}>{children}</TvModeContext.Provider>
}

export function useTvMode(): boolean {
  return useContext(TvModeContext)
}
