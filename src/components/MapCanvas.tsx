import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { KnowledgeNode } from '../domain/models'
import { appModel, useAppState } from '../useAppModel'
import type { NodeStatus } from '../domain/models'
import {
  DEFAULT_PARAMS,
  ForceParams,
  ForcePoint,
  SimState,
  edgesFromPrerequisites,
  initSim,
  simulateStep,
} from './forceLayout'

/** 节点尺寸：子系统地图用默认值；总览传更紧凑的尺寸 */
const DEFAULT_NODE_W = 168
const DEFAULT_NODE_H = 60
const MARGIN = 40
const MIN_SCALE = 0.3
const MAX_SCALE = 3

/** 视口变换：内容坐标 → 屏幕坐标 */
interface Viewport {
  tx: number
  ty: number
  scale: number
}

function contentRect(nodes: { layout: { x: number; y: number } }[], nw: number, nh: number) {
  if (nodes.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.layout.x - nw / 2)
    minY = Math.min(minY, n.layout.y - nh / 2)
    maxX = Math.max(maxX, n.layout.x + nw / 2)
    maxY = Math.max(maxY, n.layout.y + nh / 2)
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
  nw: number,
  nh: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return null

  // tExit：中心出发的射线离开半宽 hw / 半高 hh 矩形的参数
  const exitRect = (cx: number, cy: number, sgn: number) => {
    const tx = dx !== 0 ? Math.abs(nw / 2 / dx) : Infinity
    const ty = dy !== 0 ? Math.abs(nh / 2 / dy) : Infinity
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
  /** 总览模式：覆盖节点状态推导（合成节点没有真实进度记录） */
  statusFor?: (node: KnowledgeNode) => NodeStatus
  /** 总览模式：覆盖状态角标文案（如模块的「3/30」点亮计数） */
  badgeFor?: (node: KnowledgeNode, status: NodeStatus) => string | null
  /** 总览模式：节点内电池进度条（0~1，null/undefined 不显示） */
  progressFor?: (node: KnowledgeNode) => number | null
  /** 总览模式：额外高亮环 + 右上角 📍（当前所在模块） */
  activeId?: string | null
  /** 总览模式：节点点击回调（点模块 → 进入该子系统地图） */
  onNodeClick?: (node: KnowledgeNode) => void
  /** 力导向模式：节点位置由物理模拟驱动，可拖拽且邻居联动；每个节点以初始布局位为「家」，松手平滑归位 */
  force?: boolean
  /** force 模式：力学参数覆盖（以模块常量传入，保持引用稳定） */
  forceParams?: Partial<ForceParams>
  /** 紧凑节点尺寸（总览用）；不传用默认尺寸 */
  nodeSize?: { w: number; h: number }
}

/** 知识地图：SVG 自绘，圆点网格 + 贝塞尔学习路径 + 游戏风节点 + 平移缩放；总览支持力导向拖拽联动 */
export default function MapCanvas({
  nodes, statusFor, badgeFor, progressFor, activeId, onNodeClick,
  force = false, forceParams, nodeSize,
}: Props) {
  useAppState() // 订阅进度变化以重绘节点状态
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [viewport, setViewport] = useState<Viewport>({ tx: 0, ty: 0, scale: 1 })
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  const NW = nodeSize?.w ?? DEFAULT_NODE_W
  const NH = nodeSize?.h ?? DEFAULT_NODE_H
  const params: ForceParams = useMemo(
    () => ({ ...DEFAULT_PARAMS, ...forceParams }),
    [forceParams],
  )

  // MARK: 力导向（force 模式）

  const simRef = useRef<SimState | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const [forcePositions, setForcePositions] = useState<Record<string, ForcePoint>>({})
  const positionsRef = useRef(forcePositions)
  positionsRef.current = forcePositions
  // 进入页面后的首次沉降：自动适配窗口（之后用户手动拖动的沉降不再打扰视角）
  const initialSettleDone = useRef(false)
  // 用户手动平移/缩放/拖拽过视口后，不再自动适配（适配按钮可手动触发）
  const userMovedRef = useRef(false)
  const fitRef = useRef<() => void>(() => {})
  // 拖拽中的节点：钉在光标上，邻居经弹簧联动
  const pinnedRef = useRef<{ id: string; moved: boolean; startX: number; startY: number; content: ForcePoint; node: KnowledgeNode } | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  /** 每步模拟的钉住表：仅拖拽中的节点（跟随光标） */
  const pinnedForSim = useCallback(
    (drag: { id: string; content: ForcePoint } | null): Record<string, ForcePoint> => {
      const p: Record<string, ForcePoint> = {}
      if (drag) p[drag.id] = drag.content
      return p
    },
    [],
  )

  /** 归位目标：force 模式下每个节点以自身初始布局位为家（树形布局不被拖散），拖拽中的节点跟手 */
  const homeSpringsFor = useCallback(
    (dragId: string | null): Record<string, ForcePoint> => {
      const homes: Record<string, ForcePoint> = {}
      for (const n of nodesRef.current) {
        if (n.id !== dragId) homes[n.id] = n.layout
      }
      return homes
    },
    [],
  )

  const ensureLoop = useCallback(() => {
    if (!force || rafRef.current !== undefined) return
    const stepFrame = () => {
      const sim = simRef.current
      if (!sim) {
        rafRef.current = undefined
        return
      }
      const pin = pinnedRef.current
      const move = simulateStep(
        sim,
        nodesRef.current,
        edgesFromPrerequisites(nodesRef.current),
        params,
        pinnedForSim(pin ? { id: pin.id, content: pin.content } : null),
        homeSpringsFor(pin?.id ?? null),
      )
      sim.alpha *= 0.985
      setForcePositions(Object.fromEntries(sim.positions))
      if (sim.alpha > 0.02 && (move > 0.4 || pin)) {
        rafRef.current = requestAnimationFrame(stepFrame)
      } else {
        rafRef.current = undefined
        // 首次沉降（进入页面）：自动适配窗口；用户已手动操作视口则不打扰
        if (!initialSettleDone.current) {
          initialSettleDone.current = true
          if (!userMovedRef.current) fitRef.current()
        }
      }
    }
    rafRef.current = requestAnimationFrame(stepFrame)
  }, [force, params, pinnedForSim, homeSpringsFor])

  useEffect(() => {
    if (!force) return
    simRef.current = initSim(nodes)
    // 进入时低 alpha 起步：树形家点已就位，只做轻微呼吸后即沉降（拖拽时仍会拉满）
    simRef.current.alpha = 0.35
    setForcePositions(Object.fromEntries(simRef.current.positions))
    ensureLoop()
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
    // nodes 随 mapKey 重挂载才变化
  }, [force]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 屏幕坐标 → 内容坐标 */
  const toContent = useCallback((clientX: number, clientY: number): ForcePoint => {
    const bounds = containerRef.current?.getBoundingClientRect()
    const v = viewportRef.current
    return {
      x: (clientX - (bounds?.left ?? 0) - v.tx) / v.scale,
      y: (clientY - (bounds?.top ?? 0) - v.ty) / v.scale,
    }
  }, [])

  /** 节点当前渲染位置 */
  const layoutOf = useCallback(
    (node: KnowledgeNode): ForcePoint => (force ? forcePositions[node.id] ?? node.layout : node.layout),
    [force, forcePositions],
  )

  // MARK: 视口适配

  const fit = useCallback(() => {
    const source = force && Object.keys(positionsRef.current).length > 0
      ? nodes.map((n) => ({ layout: positionsRef.current[n.id] ?? n.layout }))
      : nodes
    const rect = contentRect(source, NW, NH)
    if (!rect || size.w <= 0 || size.h <= 0 || rect.width <= 0 || rect.height <= 0) return
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(size.w / rect.width, size.h / rect.height)))
    setViewport({
      scale,
      tx: size.w / 2 - rect.x * scale - (rect.width * scale) / 2,
      ty: size.h / 2 - rect.y * scale - (rect.height * scale) / 2,
    })
  }, [force, nodes, NW, NH, size.w, size.h])

  fitRef.current = fit

  useEffect(() => {
    // 尺寸已知/内容变化即适配：进入页面立刻生效（不等力模拟沉降）；
    // 用户手动平移缩放过后不再自动拉回视角
    if (!userMovedRef.current) fit()
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

  // MARK: 手势（画布平移 + 滚轮/双指捏合缩放 + force 节点拖拽联动）

  const dragState = useRef<{ startX: number; startY: number; baseTx: number; baseTy: number; moved: boolean; pointerId: number } | null>(null)
  // 多点触控：活动指针表 + 捏合基准（两点距离与当时视口）
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchState = useRef<{ baseDist: number; base: Viewport; midX: number; midY: number } | null>(null)

  const endDrag = () => {
    // force：拖拽节点时指针离开画布 → 解除钉住（不触发点击）
    if (pinnedRef.current) {
      pinnedRef.current = null
      if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.5)
      ensureLoop()
    }
    dragState.current = null
    activePointers.current.clear()
    pinchState.current = null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // 不使用 setPointerCapture：捕获会把后续事件直接派发给 svg，
    // 节点 <g> 的 pointerup 将收不到冒泡而无法选中
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (activePointers.current.size === 2) {
      // 进入捏合：终止单指拖拽
      dragState.current = null
      const [p1, p2] = [...activePointers.current.values()]
      pinchState.current = {
        baseDist: Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y)),
        base: { ...viewportRef.current },
        midX: (p1.x + p2.x) / 2,
        midY: (p1.y + p2.y) / 2,
      }
      return
    }
    if (activePointers.current.size > 2) return
    const v = viewportRef.current
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      baseTx: v.tx, baseTy: v.ty,
      moved: false,
      pointerId: e.pointerId,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // force 模式：拖拽节点（钉住 + 邻居联动），优先于画布平移
    const pin = pinnedRef.current
    if (pin) {
      if (!pin.moved && Math.hypot(e.clientX - pin.startX, e.clientY - pin.startY) > 4) {
        pin.moved = true
        userMovedRef.current = true
      }
      pin.content = toContent(e.clientX, e.clientY)
      if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.9)
      ensureLoop()
      return
    }
    if (!activePointers.current.has(e.pointerId)) return
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // 双指捏合：以两指中点为锚，按距离比例缩放
    if (activePointers.current.size >= 2 && pinchState.current) {
      const [p1, p2] = [...activePointers.current.values()]
      const dist = Math.max(1, Math.hypot(p1.x - p2.x, p1.y - p2.y))
      const midX = (p1.x + p2.x) / 2
      const midY = (p1.y + p2.y) / 2
      const { baseDist, base } = pinchState.current
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, base.scale * (dist / baseDist)))
      const k = scale / base.scale
      userMovedRef.current = true
      setViewport({
        scale,
        tx: midX - (midX - base.tx) * k,
        ty: midY - (midY - base.ty) * k,
      })
      return
    }

    const d = dragState.current
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true
    if (d.moved) {
      userMovedRef.current = true
      setViewport((v) => ({ ...v, tx: d.baseTx + dx, ty: d.baseTy + dy }))
    }
  }

  /** 只有按住指针的拖拽才平移；松手一律结束拖拽状态 */
  const onPointerUp = (e: React.PointerEvent) => {
    // force：松开被拖拽的节点 → 解除拖拽钉住并回弹归位；未移动视为点击
    if (pinnedRef.current) {
      const { moved, node } = pinnedRef.current
      pinnedRef.current = null
      if (simRef.current) simRef.current.alpha = Math.max(simRef.current.alpha, 0.9)
      ensureLoop()
      if (!moved) onNodeClick?.(node)
      return
    }
    activePointers.current.delete(e.pointerId)
    pinchState.current = null
    // 双指松开一指后，剩余手指接力为单指拖拽
    if (activePointers.current.size === 1) {
      const [pid, p] = [...activePointers.current.entries()][0]
      const v = viewportRef.current
      dragState.current = {
        startX: p.x, startY: p.y,
        baseTx: v.tx, baseTy: v.ty,
        moved: true, // 接力不重新判定点击
        pointerId: pid,
      }
      return
    }
    if (!dragState.current || e.pointerId === dragState.current.pointerId) {
      dragState.current = null
    }
  }

  /** 以光标为锚点缩放（滚轮 / 缩放按钮，均属用户手动操作） */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    userMovedRef.current = true
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
          {/* 进度填充的圆角裁剪：整个节点方块就是电池 */}
          <clipPath id="km-node-clip">
            <rect x={-NW / 2} y={-NH / 2} width={NW} height={NH} rx={16} />
          </clipPath>
        </defs>

        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
          <rect x={-4000} y={-4000} width={12000} height={12000} fill="url(#km-dots)" />

          {/* 前置关系连线（贝塞尔曲线） */}
          {nodes.map((node) =>
            node.prerequisites.map((preId) => {
              const pre = nodeById.get(preId)
              if (!pre) return null
              const ep = edgeEndpoints(layoutOf(pre), layoutOf(node), NW, NH)
              if (!ep) return null
              const targetStatus = statusFor ? statusFor(node) : appModel.statusOf(node)
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
            const status = statusFor ? statusFor(node) : appModel.statusOf(node)
            const isSelected = activeId !== undefined
              ? node.id === activeId
              : appModel.getSnapshot().selectedNodeId === node.id
            const colored = COLORED_STATUSES.includes(status)
            const lockedOrSoon = status === 'locked' || status === 'comingSoon'
            const progress = progressFor ? progressFor(node) : null
            const textBadge = progressFor ? null : badgeFor ? badgeFor(node, status) : statusBadge(status)
            const p = layoutOf(node)
            return (
              <g key={node.id} transform={`translate(${p.x} ${p.y})`}>
                <g
                  className={`map-node ${isSelected ? 'selected' : ''} ${status === 'available' ? 'glow' : ''}`}
                  onPointerDown={(e) => {
                    if (!force) return
                    // force 模式：按住节点 = 拖拽联动（阻止画布平移）
                    e.stopPropagation()
                    const c = toContent(e.clientX, e.clientY)
                    pinnedRef.current = {
                      id: node.id, moved: false,
                      startX: e.clientX, startY: e.clientY,
                      content: c, node,
                    }
                    if (simRef.current) simRef.current.alpha = 1
                    ensureLoop()
                  }}
                  onPointerUp={() => {
                    if (force) return // 点击判定与收尾由 svg 层的 onPointerUp 处理
                    // 不阻断冒泡：让 svg 的 onPointerUp 结束拖拽状态
                    if (!dragState.current?.moved) {
                      if (onNodeClick) onNodeClick(node)
                      else appModel.selectNode(node.id)
                    }
                  }}
                  style={{ cursor: force ? 'grab' : 'pointer' }}
                >
                  <rect
                    className="body"
                    x={-NW / 2} y={-NH / 2}
                    width={NW} height={NH}
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
                  {/* 进度填充：整个方块就是电池，从左往右点亮（充电式） */}
                  {progress !== null && progress !== undefined && progress > 0 && (
                    <rect
                      x={-NW / 2}
                      y={-NH / 2}
                      width={NW * Math.min(1, Math.max(0, progress))}
                      height={NH}
                      fill={status === 'mastered' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.92)'}
                      clipPath="url(#km-node-clip)"
                      style={{ pointerEvents: 'none', transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
                    />
                  )}
                  {colored && (
                    <rect
                      x={-NW / 2} y={-NH / 2}
                      width={NW} height={NH}
                      rx={16}
                      fill="url(#km-sheen)"
                      pointerEvents="none"
                    />
                  )}
                  {/* 当前所在模块：右上角 📍 */}
                  {activeId !== undefined && node.id === activeId && (
                    <text x={NW / 2 - 9} y={-NH / 2 + 11} fontSize={11} style={{ pointerEvents: 'none' }}>
                      📍
                    </text>
                  )}
                  <text
                    textAnchor="middle"
                    y={progress !== null && progress !== undefined ? -6 : textBadge ? -8 : 5}
                    fontSize={nodeSize ? 13.5 : 14}
                    fontWeight={700}
                    fill={lockedOrSoon ? 'var(--text-secondary)' : '#ffffff'}
                    style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                    stroke={lockedOrSoon ? 'none' : 'rgba(15, 23, 60, 0.18)'}
                    strokeWidth={lockedOrSoon ? 0 : 2.5}
                  >
                    {node.title}
                  </text>
                  {/* 总览：点亮计数小字 */}
                  {progress !== null && progress !== undefined ? (
                    <text
                      textAnchor="middle"
                      y={15}
                      fontSize={10.5}
                      fontWeight={700}
                      fill="#ffffff"
                      style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                      stroke="rgba(15, 23, 60, 0.35)"
                      strokeWidth={2}
                    >
                      {badgeFor ? badgeFor(node, status) : ''}
                    </text>
                  ) : (
                    textBadge && (
                      <text
                        textAnchor="middle"
                        y={NH / 2 - 10}
                        fontSize={11}
                        fontWeight={600}
                        fill={lockedOrSoon ? 'var(--text-tertiary)' : 'rgba(255, 255, 255, 0.92)'}
                        style={{ pointerEvents: 'none' }}
                      >
                        {textBadge}
                      </text>
                    )
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
