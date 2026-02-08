import React from 'react'

export default function LazyImage({ src, alt, aspectRatio = 16/9 }: { src: string, alt?: string, aspectRatio?: number }) {
  const paddingTop = `${100 / aspectRatio}%`
  return (
    <div style={{ position: 'relative', width: '100%', paddingTop }}>
      <img src={src} alt={alt} loading="lazy" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  )
}
