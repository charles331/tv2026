import type { ButtonHTMLAttributes, ReactElement } from 'react'
import type { Direction } from '@noriginmedia/norigin-spatial-navigation'
import { useFocusItem } from '../../lib/remote/focus'

/**
 * A plain <button> that the remote-control navigation can select (for the
 * places that do not use the styled <Button>). Same props as <button>.
 */
export function FocusButton({
  focusKey,
  focusable,
  onArrow,
  onMouseDown,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  focusKey?: string
  /** Default: selectable unless disabled. */
  focusable?: boolean
  /** Arrow pressed while selected; return false to handle it here. */
  onArrow?: (dir: Direction) => boolean
}): ReactElement {
  const { ref, itemProps } = useFocusItem<HTMLButtonElement>({
    focusKey,
    focusable: focusable ?? !rest.disabled,
    onArrow
  })
  return (
    <button
      ref={ref}
      data-remote-focus={itemProps['data-remote-focus']}
      data-remote=""
      onMouseDown={(e) => {
        itemProps.onMouseDown()
        onMouseDown?.(e)
      }}
      {...rest}
    />
  )
}
