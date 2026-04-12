const VARIANT_CLASSES = {
  text: 'h-4 rounded',
  title: 'h-6 rounded-md',
  avatar: 'rounded-full',
  card: 'rounded-xl',
  button: 'h-10 rounded-lg'
}

export function Skeleton({ variant = 'text', className = '', ...rest }) {
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.text
  return (
    <div
      className={`ds-skeleton ${variantClass} ${className}`}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      {...rest}
    />
  )
}
