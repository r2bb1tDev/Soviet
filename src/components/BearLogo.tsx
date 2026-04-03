interface Props {
  size?: number
  style?: React.CSSProperties
}

export default function BearLogo({ size = 64, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      {/* Уши */}
      <circle cx="28" cy="28" r="14" fill="#F0F0F0" stroke="#D8D8D8" strokeWidth="1.5"/>
      <circle cx="72" cy="28" r="14" fill="#F0F0F0" stroke="#D8D8D8" strokeWidth="1.5"/>
      <circle cx="28" cy="28" r="9" fill="#E0E0E0"/>
      <circle cx="72" cy="28" r="9" fill="#E0E0E0"/>
      {/* Голова */}
      <ellipse cx="50" cy="56" rx="32" ry="30" fill="#F8F8F8" stroke="#E0E0E0" strokeWidth="1.5"/>
      {/* Морда */}
      <ellipse cx="50" cy="67" rx="14" ry="10" fill="#EEEEEE"/>
      {/* Нос */}
      <ellipse cx="50" cy="62" rx="6" ry="4" fill="#333333"/>
      {/* Глаза */}
      <circle cx="37" cy="52" r="4.5" fill="#222222"/>
      <circle cx="63" cy="52" r="4.5" fill="#222222"/>
      {/* Блики */}
      <circle cx="38.5" cy="50.5" r="1.5" fill="white"/>
      <circle cx="64.5" cy="50.5" r="1.5" fill="white"/>
      {/* Рот */}
      <path d="M 44 68 Q 50 74 56 68" stroke="#888" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  )
}
