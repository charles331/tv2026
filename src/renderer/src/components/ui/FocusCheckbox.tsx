import type { InputHTMLAttributes, ReactElement } from 'react'
import { useFocusItem } from '../../lib/remote/focus'

/** A checkbox the remote control can select; OK toggles it. */
export function FocusCheckbox({
  focusKey,
  onMouseDown,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { focusKey?: string }): ReactElement {
  const { ref, itemProps } = useFocusItem<HTMLInputElement>({
    focusKey,
    focusable: !rest.disabled
  })
  return (
    <input
      ref={ref}
      type="checkbox"
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
