import type { ReactElement, ReactNode } from 'react'

/**
 * Title (+ optional meta line) under a poster card. The title takes up to two
 * lines; on the card selected with the remote it shows in full, floating over
 * what is below so the grid does not move (main.css, .card-caption).
 * The caption always takes the same height: virtualized grids reserve it.
 */
export function CardCaption({ title, meta }: { title: string; meta?: ReactNode }): ReactElement {
  return (
    <div className="card-caption mt-2 w-full min-w-0">
      <div className="card-caption-inner px-0.5">
        <p className="card-title text-sm font-medium leading-5 text-gray-100 group-hover:text-white">
          {title}
        </p>
        {meta != null && <p className="truncate text-xs leading-4 text-gray-500">{meta}</p>}
      </div>
    </div>
  )
}

/** Height a CardCaption takes, margin included, in rem (keep in sync with main.css). */
export const CARD_CAPTION_REM = 4
