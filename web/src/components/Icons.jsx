/**
 * MmjGreen — icon set.
 * Inline SVG so `img-src 'self'` never applies and icons inherit currentColor.
 */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
}

const make = (paths) =>
  function Icon({ size, ...rest }) {
    return (
      <svg {...base} {...(size ? { width: size, height: size } : null)} {...rest}>
        {paths}
      </svg>
    )
  }

export const IconClipboard = make(
  <>
    <path d="M9 4h6v3H9z" />
    <path d="M15 5.5h2.5A1.5 1.5 0 0 1 19 7v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V7a1.5 1.5 0 0 1 1.5-1.5H9" />
    <path d="M8.5 12h7M8.5 16h4.5" />
  </>
)

export const IconMap = make(
  <>
    <path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V4L15 6.2 9 4Z" />
    <path d="M9 4v13.3M15 6.2v13.3" />
  </>
)

export const IconCalendar = make(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    <path d="M8 13.5h3M8 16.8h6" />
  </>
)

export const IconVideo = make(
  <>
    <rect x="2.5" y="6" width="13" height="12" rx="2.2" />
    <path d="M15.5 11l6-3.5v9L15.5 13" />
  </>
)

export const IconId = make(
  <>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.2" />
    <circle cx="8.5" cy="10" r="2.3" />
    <path d="M5 16.2c.6-1.7 1.9-2.6 3.5-2.6s2.9.9 3.5 2.6" />
    <path d="M15 9.5h4M15 13h4" />
  </>
)

export const IconNote = make(
  <>
    <path d="M6 3.5h9l4 4v13H6z" />
    <path d="M15 3.5v4h4" />
    <path d="M9 12h7M9 15.5h7M9 8.5h3" />
  </>
)

export const IconCard = make(
  <>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.4" />
    <path d="M2.5 10h19" />
    <path d="M6 14.5h4" />
  </>
)

export const IconShield = make(
  <>
    <path d="M12 3.2 5 5.8v5.5c0 4.3 2.9 7.8 7 9.5 4.1-1.7 7-5.2 7-9.5V5.8L12 3.2Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </>
)

export const IconBadge = make(
  <>
    <circle cx="12" cy="9.5" r="5.5" />
    <path d="m8.5 14.2-1.2 6.3 4.7-2.4 4.7 2.4-1.2-6.3" />
    <path d="m10.2 9.6 1.3 1.3 2.4-2.5" />
  </>
)

export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2V12l3 1.8" />
  </>
)

export const IconLock = make(
  <>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2.4" />
    <path d="M8 10V7.6a4 4 0 0 1 8 0V10" />
    <path d="M12 14v2.5" />
  </>
)

export const IconChat = make(
  <>
    <path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.6-.34L4 21l1.3-3.6A6.9 6.9 0 0 1 3.5 12.2C3.5 8.2 7.3 5 12 5s8.5 3.2 8.5 7.2Z" />
    <path d="M9 12h6M9 9.4h6" />
  </>
)

export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />)

export const IconStar = ({ size, ...rest }) => (
  <svg {...base} {...(size ? { width: size, height: size } : null)} fill="currentColor" stroke="none" {...rest}>
    <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9L12 3.6Z" />
  </svg>
)

export const IconArrow = ({ size, ...rest }) => (
  <svg {...base} {...(size ? { width: size, height: size } : null)} {...rest}>
    <path d="M5 12h13M12.5 5.5 19 12l-6.5 6.5" />
  </svg>
)

export const IconSpark = make(
  <>
    <path d="M12 3.5 13.9 9 19.5 11 13.9 13 12 18.5 10.1 13 4.5 11 10.1 9 12 3.5Z" />
  </>
)

export const IconPhone = make(
  <>
    <path d="M6.5 3.8h3l1.5 4-2 1.4a11.5 11.5 0 0 0 5.4 5.4l1.4-2 4 1.5v3a1.8 1.8 0 0 1-2 1.8A16.2 16.2 0 0 1 4.7 5.8a1.8 1.8 0 0 1 1.8-2Z" />
  </>
)

export const IconMail = make(
  <>
    <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
    <path d="m3.6 7 8.4 6 8.4-6" />
  </>
)

export const IconPin = make(
  <>
    <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </>
)

export const iconMap = {
  clipboard: IconClipboard,
  map: IconMap,
  calendar: IconCalendar,
  video: IconVideo,
  card: IconCard,
  shield: IconShield,
  badge: IconBadge,
  clock: IconClock,
  lock: IconLock,
  chat: IconChat,
  id: IconId,
  note: IconNote
}

/** Resolves a content-layer icon name to its component. */
export function Icon({ name, ...rest }) {
  const Component = iconMap[name]
  return Component ? <Component {...rest} /> : null
}

/** Botanical mark with a medical cross, shared with the sample card. */
export function BrandMark({ size = 30, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <rect width="64" height="64" rx="20" fill="#174a32" />
      <path d="M32 43C16 39 13 25 17 15c12 0 20 9 15 28Z" fill="#d6e255" />
      <path d="M32 43c-3-16 4-26 17-28 4 13-3 24-17 28Z" fill="#a7cda9" />
      <path d="M32 47V29M48 39v10m-5-5h10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
