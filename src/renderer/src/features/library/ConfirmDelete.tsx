/**
 * Deleting a Bibliothèque file: two confirmations in a row, each opening on
 * « Annuler », so a distracted double OK deletes nothing. Back cancels. The file
 * goes to the Recycle Bin (main process), never deleted for good.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { LibraryItem } from '@shared/index'
import { displayName } from '@shared/displayName'
import { Button } from '../../components/ui'
import { FocusZone, useBackHandler, useReturnFocus } from '../../lib/remote/focus'
import { formatBytes } from '../../lib/format'

export function ConfirmDelete({
  item,
  onCancel,
  onConfirm
}: {
  item: LibraryItem
  onCancel: () => void
  onConfirm: () => void
}): ReactElement {
  const [step, setStep] = useState<1 | 2>(1)
  useReturnFocus()
  useBackHandler(onCancel)
  useEffect(() => {
    setFocus(`library-delete-cancel-${step}`)
  }, [step])
  const size = item.sizeBytes ? ` (${formatBytes(item.sizeBytes)})` : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <FocusZone
        focusKey="library-delete"
        boundary
        className="fade-in w-full max-w-md rounded-2xl border border-white/10 bg-surface-raised p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 ? (
          <>
            <h2 className="text-lg font-semibold text-white">
              Supprimer « {displayName(item.title)} »{size} ?
            </h2>
            <div className="mt-5 flex justify-end gap-3">
              <Button focusKey="library-delete-cancel-1" variant="ghost" onClick={onCancel}>
                Annuler
              </Button>
              <Button variant="danger" onClick={() => setStep(2)}>
                Supprimer
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-white">Vraiment ?</h2>
            <p className="mt-2 text-sm text-gray-400">Le fichier ira dans la Corbeille.</p>
            <div className="mt-5 flex justify-end gap-3">
              <Button focusKey="library-delete-cancel-2" variant="ghost" onClick={onCancel}>
                Annuler
              </Button>
              <Button variant="danger" onClick={onConfirm}>
                Oui, supprimer
              </Button>
            </div>
          </>
        )}
      </FocusZone>
    </div>
  )
}
