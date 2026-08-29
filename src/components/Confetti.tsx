import { useMemo } from 'react'
import { motion } from 'motion/react'

const COLORS = ['#4f6ef7', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#f0a202']

interface Piece {
  id: number
  x: number
  delay: number
  duration: number
  drift: number
  rotate: number
  color: string
  w: number
  h: number
}

/** 通关彩带：从顶部迸发飘落的轻量粒子（motion 驱动，挂载即播一次） */
export default function Confetti({ count = 90 }: { count?: number }) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2.4 + Math.random() * 1.8,
        drift: -50 + Math.random() * 100,
        rotate: 420 + Math.random() * 720,
        color: COLORS[i % COLORS.length],
        w: 9 + Math.random() * 6,
        h: 13 + Math.random() * 8,
      })),
    [count],
  )

  return (
    <div className="confetti-layer" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="confetti-piece"
          style={{ left: `${p.x}%`, background: p.color, width: p.w, height: p.h }}
          initial={{ y: -30, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '105vh', x: p.drift, rotate: p.rotate, opacity: [1, 1, 0.85, 0] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}
