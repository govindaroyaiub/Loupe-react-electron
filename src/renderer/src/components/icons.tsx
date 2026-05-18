import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({
  size = 16,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function SelectIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 3 L5 18 L9.5 14 L12 20 L14.5 19 L12 13 L18 13 Z" fill="currentColor" stroke="currentColor" />
    </Svg>
  )
}

export function MarqueeIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props} strokeDasharray="3 2">
      <rect x="4" y="5" width="16" height="14" rx="1" />
    </Svg>
  )
}

export function HandIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 11 V6.5 a1.5 1.5 0 0 1 3 0 V11" />
      <path d="M11 11 V5 a1.5 1.5 0 0 1 3 0 V11" />
      <path d="M14 11 V6.5 a1.5 1.5 0 0 1 3 0 V13" />
      <path d="M8 11 V9 a1.5 1.5 0 0 0 -3 0 v5 a7 7 0 0 0 7 7 h1 a5 5 0 0 0 5 -5 V11" />
    </Svg>
  )
}

export function GridIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12 H20 M12 4 V20" />
    </Svg>
  )
}

export function CrosshairIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5 V7 M12 17 V21.5 M2.5 12 H7 M17 12 H21.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function EyeOnIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.25" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function EyeOffIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.25" />
    </Svg>
  )
}

export function FolderIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 7 a1 1 0 0 1 1 -1 h5 l2 2 h9 a1 1 0 0 1 1 1 v9 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 Z" />
    </Svg>
  )
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 5 L16 12 L9 19" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 9 L12 16 L19 9" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 5 V19 M5 12 H19" />
    </Svg>
  )
}

export function MinusIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12 H19" />
    </Svg>
  )
}

export function ArrowRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 12 H20 M14 6 L20 12 L14 18" />
    </Svg>
  )
}

export function EraserIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M16.5 4.5 L20.5 8.5 L9 20 H5 v-4 Z" />
      <path d="M11 7 L18 14" />
    </Svg>
  )
}

export function HelpIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9 a2.5 2.5 0 0 1 5 0 c0 1.5 -2.5 2 -2.5 4" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </Svg>
  )
}
