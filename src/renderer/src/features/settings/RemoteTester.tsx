/**
 * "Tester la télécommande": shows what each key of the remote sends (key,
 * code, keyCode) and the action the app recognises, to adapt the key map to a
 * real remote. Back is shown like any other key; press it twice in a row to
 * leave (or use the "Fermer" button).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import { Button } from '../../components/ui'
import { FocusZone, useBackHandler, useFocusItem, useReturnFocus } from '../../lib/remote/focus'
import { describeKey, type KeyDescription } from '../../lib/remote/describeKey'

const SHOWN = 10
const ACTION_LABEL: Record<string, string> = {
  up: 'haut',
  down: 'bas',
  left: 'gauche',
  right: 'droite',
  ok: 'OK',
  back: 'Retour'
}

export function RemoteTester({ onClose }: { onClose: () => void }): ReactElement {
  const [keys, setKeys] = useState<KeyDescription[]>([])
  const backPresses = useRef(0)
  useReturnFocus()
  // Back: the first press is recorded like any key, a second one in a row closes.
  useBackHandler(() => {
    backPresses.current += 1
    if (backPresses.current >= 2) onClose()
  })
  useEffect(() => {
    setFocus('remote-tester-log')
    const onKey = (e: KeyboardEvent): void => {
      const d = describeKey(e)
      if (d.action !== 'back') backPresses.current = 0
      setKeys((k) => [d, ...k].slice(0, SHOWN))
    }
    // Capture phase: runs even for the keys the navigation stops.
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])
  // The log is the selected element: OK and the arrows do nothing there.
  const log = useFocusItem<HTMLDivElement>({
    focusKey: 'remote-tester-log',
    onEnter: () => undefined,
    onArrow: (dir) => dir === 'down'
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <FocusZone
        focusKey="remote-tester"
        boundary
        className="fade-in w-full max-w-lg rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-white">Tester la télécommande</h2>
        <p className="mt-1 text-sm text-gray-400">
          Appuyez sur les touches : chacune s’affiche avec l’action reconnue. Appuyez deux fois de
          suite sur Retour pour quitter.
        </p>
        <div
          ref={log.ref}
          tabIndex={-1}
          data-remote=""
          data-remote-focus={log.focused}
          className="mt-4 min-h-[16rem] rounded-lg bg-surface-sunken p-3 font-mono text-xs outline-none"
        >
          {keys.length === 0 ? (
            <p className="text-gray-600">En attente d’une touche…</p>
          ) : (
            <table className="w-full text-left">
              <thead className="text-gray-500">
                <tr>
                  <th className="pb-1 font-normal">key</th>
                  <th className="pb-1 font-normal">code</th>
                  <th className="pb-1 font-normal">keyCode</th>
                  <th className="pb-1 font-normal">action</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {keys.map((k, i) => (
                  <tr key={i}>
                    <td>{k.key}</td>
                    <td>{k.code || '—'}</td>
                    <td>{k.keyCode}</td>
                    <td className={k.action ? 'text-emerald-300' : 'text-gray-600'}>
                      {k.action ? ACTION_LABEL[k.action] : 'aucune'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </FocusZone>
    </div>
  )
}
