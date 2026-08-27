'use client'

import { useState } from 'react'
import { Pill } from 'lucide-react'

interface MedImageProps {
  src?: string | null
  alt: string
  className?: string
}

/** Medicine/prescription image with a gradient + Pill fallback when missing or broken. */
export default function MedImage({ src, alt, className = '' }: MedImageProps) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`med-gradient flex items-center justify-center ${className}`}
      >
        <Pill className="h-1/2 w-1/2 max-h-8 max-w-8 text-white" strokeWidth={2.2} />
      </div>
    )
  }

  return (
    <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />
  )
}
