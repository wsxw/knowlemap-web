import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KnowledgeNode } from '../domain/models'
import { appModel, useAppState } from '../useAppModel'
import type { NodeStatus } from '../domain/models'

const NODE_WIDTH = 168
const NODE_HEIGHT = 60
const MARGIN = 40
const MIN_SCALE = 0.3
const MAX_SCALE = 3

/** 视口变换：内容坐标 → 屏幕坐标 */
interface Viewport {
  tx: number
  ty: number
  scale: number
}

function contentRect(nodes: { layout: { x: number; y: number } }[]) {
  if (nodes.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.layout.x - NODE_WIDTH / 2)
    minY = Math.min(minY, n.layout.y - NODE_HEIGHT / 2)
    maxX = Math.max(maxX, n.layout.x + NODE_WIDTH / 2)
    maxY = Math.max(maxY, n.layout.y + NODE_HEIGHT / 2)
  }
  return {
    x: minX - MARGIN,
    y: minY - MARGIN,
    width: maxX - minX + MARGIN * 2,
    height: maxY - minY + MARGIN * 2,
  }
}

/**
 * 求线段（起点 rect 中心 → 终点 rect 中心）与两个矩形边界的交点。
 * 按矩形边界精确求交，保证连线端点落在节点框边缘。
 */
function edgeEndpoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return null

  // tExit：中心出发的射线离开半宽 hw / 半高 hh 矩形的参数
  const exitRect = (cx: number, cy: number, sgn: number) => {
    const tx = dx !== 0 ? Math.abs(NODE_WIDTH / 2 / dx) : Infinity
    const ty = dy !== 0 ? Math.abs(NODE_HEIGHT / 2 / dy) : Infinity
    const t = Math.min(tx, ty)
    return { x: cx + sgn * dx * t, y: cy + sgn * dy * t }
  }
  const gap = 14
  const ux = dx / len
  const uy = dy / len
  const start = exitRect(a.x, a.y, 1)
  const endRaw = exitRect(b.x, b.y, -1)
  const end = { x: endRaw.x - ux * gap, y: endRaw.y - uy * gap }
  return { start, end }
}

/** 二次贝塞尔曲线路径：控制点取中点沿法线偏移，弯而不乱 */
function bezierPath(start: { x: number; y: number }, end: { x: number; y: number }): { d: string; endAngle: number } {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  const off = Math.min(56, len * 0.16)
  const cx = (start.x + end.x) / 2 + (-dy / len) * off
  const cy = (start.y + end.y) / 2 + (dx / len) * off
  const endAngle = Math.atan2(end.y - cy, end.x - cx)
  return { d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`, endAngle }
}

/** 彩色状态（可用渐变高光 + 白字），灰态（锁定/待上线）用灰底 */
const COLORED_STATUSES: NodeStatus[] = ['available', 'inProgress', 'mastered']

function statusColor(status: NodeStatus): string {
  switch (status) {
    case 'locked': return 'var(--node-locked)'
    case 'available': return 'var(--node-available-flat)'
    case 'inProgress': return 'var(--node-inprogress-flat)'
    case 'mastered': return 'var(--node-mastered-flat)'
    case 'comingSoon': return 'var(--node-soon)'
  }
}

function statusBadge(status: NodeStatus): string | null {
  switch (status) {
    case 'mastered': return '✓ 已掌握'
    case 'inProgress': return '● 进行中'
    case 'locked': return '🔒'
    case 'comingSoon': return '🕒 待上线'
    default: return null
  }
}

interface Props {
  nodes: KnowledgeNode[]
}

/** 知识地图：SVG 自绘，圆点网格 + 贝塞尔学习路径 + 游戏风节点 + 平移缩放 */
export default function MapCanvas({ nodes }: Props) {
  useAppState() // 订阅进度变化以重绘节点状态
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [viewport, setViewport] = useState<Viewport>({ tx: 0, ty: 0, scale: 1 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  /** 一键适配视口：仅在挂载、容器尺寸或节点集合变化时执行 */
  const fit = useCallback(() => {
    const rect = contentRect(nodes)
    if (!rect || size.w <= 0 || size.h <= 0 || rect.width <= 0 || rect.height <= 0) return
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(size.w / rect.width, size.h / rect.height)))
    setViewport({
      scale,
      tx: size.w / 2 - rect.x * scale - (rect.width * scale) / 2,
      ty: size.h / 2 - rect.y * scale - (rect.height * scale) / 2,
    })
  }, [nodes, size.w, size.h])

  useEffect(() => {
    fit()
  }, [fit])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // MARK: 手势（平移 + 缩放）

  const dragState = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number; moved: boolean; pointerId: number } | null>(null)

  const endDrag = () => {
    dragState.current = null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // 不使用 setPointerCapture：捕获会把后续事件直接派发给 svg，
    // 节点 <g> 的 pointerup 将收不到冒泡而无法选中
    const v = viewportRef.current
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      baseTx: v.tx, baseTy: v.ty,
      moved: false,
      pointerId: e.pointerId,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragState.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true
    if (d.moved) {
      setViewport((v) => ({ ...v, tx: d.baseTx + dx, ty: d.baseTy + dy }))
    }
  }

  /** 只有按住指针的拖拽才平移；松手一律结束拖拽状态 */
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragState.current || e.pointerId === dragState.current.pointerId) {
      dragState.current = null
    }
  }

  /** 以光标为锚点缩放 */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current
    if (!el) return
    const bounds = el.getBoundingClientRect()
    const px = clientX - bounds.left
    const py = clientY - bounds.top
    setViewport((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      const k = scale / v.scale
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }
    })
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div className="map-canvas-wrap" ref={containerRef}>
      <svg
        className="map-svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          {/* 圆点网格：随内容一起平移缩放，白板质感 */}
          <pattern id="km-dots" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.7" fill="var(--canvas-dot)" />
          </pattern>
          {/* 节点顶部高光，游戏按钮质感 */}
          <linearGradient id="km-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
          <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#km-dots)" />

          {/* 前置关系连线（贝塞尔曲线） */}
          {nodes.map((node) =>
            node.prerequisites.map((preId) => {
              const pre = nodeById.get(preId)
              if (!pre) return null
              const ep = edgeEndpoints(pre.layout, node.layout)
              if (!ep) return null
              const targetStatus = appModel.statusOf(node)
              const bothMastered = appModel.isMastered(pre.id) && appModel.isMastered(node.id)
              const flowing = targetStatus === 'available'
              const color = bothMastered
                ? 'var(--edge-mastered)'
                : flowing
                  ? 'var(--edge-flow)'
                  : 'var(--edge-normal)'
              const { d, endAngle } = bezierPath(ep.start, ep.end)
              const arrowLen = 12
              const arrowAngle = Math.PI / 7
              const p1 = `${ep.end.x},${ep.end.y}`
              const p2 = `${ep.end.x - arrowLen * Math.cos(endAngle - arrowAngle)},${ep.end.y - arrowLen * Math.sin(endAngle - arrowAngle)}`
              const p3 = `${ep.end.x - arrowLen * Math.cos(endAngle + arrowAngle)},${ep.end.y - arrowLen * Math.sin(endAngle + arrowAngle)}`
              return (
                <g key={`${preId}->${node.id}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={bothMastered ? 2.6 : 1.8}
                    strokeLinecap="round"
                    className={flowing ? 'edge-flow-line' : undefined}
                    style={bothMastered ? { filter: 'drop-shadow(0 0 5px var(--edge-mastered))' } : undefined}
                  />
                  <polygon points={`${p1} ${p2} ${p3}`} fill={color} />
                </g>
              )
            }),
          )}

          {/* 节点：外层 g 定位，内层 g 承担 hover/选中动效（CSS transform 不与定位属性冲突） */}
          {[...nodes].reverse().map((node) => {
            const status = appModel.statusOf(node)
            const isSelected = appModel.getSnapshot().selectedNodeId === node.id
            const colored = COLORED_STATUSES.includes(status)
            const lockedOrSoon = status === 'locked' || status === 'comingSoon'
            const badge = statusBadge(status)
            return (
              <g key={node.id} transform={`translate(${node.layout.x} ${node.layout.y})`}>
                <g
                  className={`map-node ${isSelected ? 'selected' : ''} ${status === 'available' ? 'glow' : ''}`}
                  onPointerUp={() => {
                    // 不阻断冒泡：让 svg 的 onPointerUp 结束拖拽状态
                    if (!dragState.current?.moved) {
                      appModel.selectNode(node.id)
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    className="body"
                    x={-NODE_WIDTH / 2} y={-NODE_HEIGHT / 2}
                    width={NODE_WIDTH} height={NODE_HEIGHT}
                    rx={16}
                    fill={statusColor(status)}
                    stroke={
                      isSelected ? 'var(--accent)' :
                      status === 'comingSoon' ? 'var(--text-tertiary)' :
                      status === 'locked' ? 'var(--node-locked-stroke)' :
                      'rgba(255, 255, 255, 0.4)'
                    }
                    strokeWidth={isSelected ? 3.5 : 1.4}
                    strokeDasharray={status === 'comingSoon' ? '6 4' : undefined}
                  />
                  {colored && (
                    <rect
                      x={-NODE_WIDTH / 2} y={-NODE_HEIGHT / 2}
                      width={NODE_WIDTH} height={NODE_HEIGHT}
                      rx={16}
                      fill="url(#km-sheen)"
                      pointerEvents="none"
                    />
                  )}
                  <text
                    textAnchor="middle"
                    y={badge ? -8 : 5}
                    fontSize={14}
                    fontWeight={700}
                    fill={lockedOrSoon ? 'var(--text-secondary)' : '#ffffff'}
                    style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                    stroke={lockedOrSoon ? 'none' : 'rgba(15, 23, 60, 0.18)'}
                    strokeWidth={lockedOrSoon ? 0 : 2.5}
                  >
                    {node.title}
                  </text>
                  {badge && (
                    <text
                      textAnchor="middle"
                      y={NODE_HEIGHT / 2 - 10}
                      fontSize={11}
                      fontWeight={600}
                      fill={lockedOrSoon ? 'var(--text-tertiary)' : 'rgba(255, 255, 255, 0.92)'}
                      style={{ pointerEvents: 'none' }}
                    >
                      {badge}
                    </text>
                  )}
                </g>
              </g>
            )
          })}
        </g>
      </svg>

      {nodes.length === 0 && (
        <div className="map-filter-empty">
          当前级别筛选下没有节点，换个级别试试。
        </div>
      )}

      <div className="zoom-controls">
        <button onClick={() => zoomAtCenter(1.25)} title="放大">＋</button>
        <button onClick={() => zoomAtCenter(1 / 1.25)} title="缩小">－</button>
        <button onClick={() => fit()} title="适配窗口">⛶</button>
      </div>

      <div className="map-legend">
        {[
          ['var(--node-mastered-flat)', '已掌握'],
          ['var(--node-inprogress-flat)', '进行中'],
          ['var(--node-available-flat)', '可学习'],
          ['var(--node-locked)', '未解锁'],
          ['var(--node-soon)', '待上线'],
        ].map(([color, label]) => (
          <span key={label} className="legend-item">
            <span className="legend-dot" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )

  function zoomAtCenter(factor: number) {
    const el = containerRef.current
    if (!el) return
    const b = el.getBoundingClientRect()
    zoomAt(b.left + b.width / 2, b.top + b.height / 2, factor)
  }
}
