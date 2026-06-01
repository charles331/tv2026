import type { ReactElement, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest
  }
}

export const IconSearch = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const IconPlay = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M6 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconPause = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStop = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
)

export const IconDownload = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
    <path d="M5 19h14" />
  </svg>
)

export const IconResume = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M8 5v14l11-7L8 5Z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconX = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
)

export const IconCheck = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="m5 12 4.5 4.5L19 7" />
  </svg>
)

export const IconSettings = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
)

export const IconFilm = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
)

export const IconQueue = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M4 6h12M4 12h12M4 18h7" />
    <path d="M18 14v6m0 0 2.5-2.5M18 20l-2.5-2.5" />
  </svg>
)

export const IconRefresh = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M20 11A8 8 0 1 0 18.3 16" />
    <path d="M20 4v5h-5" />
  </svg>
)

export const IconFolder = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
)

export const IconChevronLeft = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="m14 6-6 6 6 6" />
  </svg>
)

export const IconStar = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path
      d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17.9 6.7 20.6l1-5.8-4.2-4.1 5.9-.9L12 3.5Z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
)

export const IconVolume = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </svg>
)

export const IconVolumeMute = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="m16 9 5 6M21 9l-5 6" />
  </svg>
)

export const IconFullscreen = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M8 3H4v4M16 3h4v4M16 21h4v-4M8 21H4v-4" />
  </svg>
)

export const IconSubtitles = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 14h4M13 14h4M7 11h2M11 11h6" />
  </svg>
)

export const IconExternal = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <path d="M14 5h5v5M19 5l-8 8M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
  </svg>
)

export const IconGrip = (p: IconProps): ReactElement => (
  <svg {...base(p)}>
    <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </svg>
)
