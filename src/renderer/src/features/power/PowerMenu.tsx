/**
 * TV mode « Éteindre »: quit the app, put the PC to sleep or shut it down —
 * each confirmed first, with « Annuler » selected (a mistaken OK must not
 * switch the TV's PC off). Sleep / shut down exist on Windows only.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { api, unwrap } from '../../lib/ipc'
import { Button } from '../../components/ui'
import { FocusZone, useBackHandler, useReturnFocus } from '../../lib/remote/focus'

type PowerAction = 'quit' | 'sleep' | 'shutdown'

const LABEL: Record<PowerAction, string> = {
  quit: 'Quitter TV2026',
  sleep: 'Mettre le PC en veille',
  shutdown: 'Éteindre le PC'
}

export function PowerMenu({ onClose }: { onClose: () => void }): ReactElement {
  const [windows, setWindows] = useState(false)
  const [confirm, setConfirm] = useState<PowerAction | null>(null)
  useReturnFocus()
  // Back: from the confirmation to the menu, from the menu out.
  useBackHandler(() => (confirm ? setConfirm(null) : onClose()))
  useEffect(() => {
    void api()
      .app.info()
      .then((r) => setWindows(unwrap(r).platform === 'win32'))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    setFocus(confirm ? 'power-cancel' : 'power-quit')
  }, [confirm])
  const actions: PowerAction[] = windows ? ['quit', 'sleep', 'shutdown'] : ['quit']

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <FocusZone
        focusKey="power-menu"
        boundary
        className="fade-in w-full max-w-sm rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {confirm ? (
          <>
            <h2 className="text-lg font-semibold text-white">{LABEL[confirm]} ?</h2>
            <div className="mt-5 flex justify-end gap-3">
              <Button focusKey="power-cancel" variant="ghost" onClick={() => setConfirm(null)}>
                Annuler
              </Button>
              <Button variant="danger" onClick={() => void api().app.power({ action: confirm })}>
                {LABEL[confirm]}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-white">Éteindre</h2>
            <div className="mt-4 flex flex-col gap-2">
              {actions.map((a) => (
                <Button key={a} focusKey={`power-${a}`} onClick={() => setConfirm(a)}>
                  {LABEL[a]}
                </Button>
              ))}
              <Button variant="ghost" onClick={onClose}>
                Annuler
              </Button>
            </div>
          </>
        )}
      </FocusZone>
    </div>
  )
}
