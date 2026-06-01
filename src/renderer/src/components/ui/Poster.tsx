import { useState, type ReactElement } from 'react'
import { cn } from './cn'

/**
 * Lazy-loaded poster image with a shimmer placeholder and graceful fallback.
 * Native `loading="lazy"` + `decoding="async"` keeps the 26k-item grid cheap.
 */
export function Poster({
  src,
  alt,
  className
}: {
  src: string | null
  alt: string
  className?: string
}): ReactElement {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const showImage = src && !failed

  return (
    <div className={cn('relative overflow-hidden bg-surface-overlay', className)}>
      {!loaded && showImage && <div className="absolute inset-0 shimmer" />}
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-overlay to-surface-raised p-3 text-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            className="text-gray-600"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="m4 15 4-4 5 5 3-3 4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="8" r="1.5" fill="currentColor" />
          </svg>
        </div>
      )}
    </div>
  )
}
