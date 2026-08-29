// 力导向布局引擎（总览图用，Obsidian 图视图风格）：纯函数，便于测试。
// 模型：节点对间库仑斥力 + 前置边弹簧力（胡克定律）+ 弱向心力，
// 速度阻尼 + alpha 冷却；钉住（拖拽）节点不受力、由指针驱动，邻居经弹簧被拉动。

export interface ForcePoint {
  x: number
  y: number
}

export interface ForceNodeInput {
  id: string
  layout: ForcePoint
}

/** 边：source --target（与节点 prerequisites 语义一致：target 的前置是 source） */
export interface ForceEdge {
  source: string
  target: string
}

export interface ForceParams {
  /** 斥力强度 */
  repulsion: number
  /** 弹簧静止长度 */
  restLength: number
  /** 弹簧刚度 */
  stiffness: number
  /** 向心系数（0~1，越靠越居中） */
  gravity: number
  /** 速度阻尼（0~1，每帧保留比例） */
  damping: number
  /** 单步最大位移（防爆） */
  maxDisplacement: number
  /** 锚定节点归位缓动系数（每帧向家点靠拢的比例，越小越慢越平滑） */
  anchorEase: number
}

export const DEFAULT_PARAMS: ForceParams = {
  repulsion: 26000,
  restLength: 215,
  stiffness: 0.06,
  gravity: 0.015,
  damping: 0.82,
  maxDisplacement: 24,
  anchorEase: 0.045,
}

export interface SimState {
  positions: Map<string, ForcePoint>
  velocities: Map<string, ForcePoint>
  /** 冷却系数：每帧衰减，事件（拖拽/初始）时重置到 1；低于阈值认为已稳定 */
  alpha: number
}

export function initSim(
  nodes: ForceNodeInput[],
  start?: Record<string, ForcePoint>,
): SimState {
  const positions = new Map<string, ForcePoint>()
  const velocities = new Map<string, ForcePoint>()
  for (const n of nodes) {
    const p = start?.[n.id] ?? n.layout
    positions.set(n.id, { x: p.x, y: p.y })
    velocities.set(n.id, { x: 0, y: 0 })
  }
  return { positions, velocities, alpha: 1 }
}

/** 一步积分：返回本帧所有节点的总位移（用于判断是否稳定） */
export function simulateStep(
  state: SimState,
  nodes: ForceNodeInput[],
  edges: ForceEdge[],
  params: ForceParams = DEFAULT_PARAMS,
  pinned: Record<string, ForcePoint> = {},
  /** 归位弹簧：节点平滑缓动回家的目标点（如「英语」根节点的画布中心），非硬钉 */
  homeSprings: Record<string, ForcePoint> = {},
): number {
  const { positions, velocities } = state
  const ids = nodes.map((n) => n.id)
  const posOf = (id: string): ForcePoint => pinned[id] ?? positions.get(id) ?? { x: 0, y: 0 }

  const forces = new Map<string, ForcePoint>()
  for (const id of ids) forces.set(id, { x: 0, y: 0 })
  const add = (id: string, fx: number, fy: number) => {
    const f = forces.get(id)!
    f.x += fx
    f.y += fy
  }

  // 1) 库仑斥力：所有节点对，与距离平方成反比
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]
      const b = ids[j]
      const pa = posOf(a)
      const pb = posOf(b)
      let dx = pa.x - pb.x
      let dy = pa.y - pb.y
      let distSq = dx * dx + dy * dy
      if (distSq < 1) {
        // 完全重叠时给一个随机小抖动避免死锁
        dx = (Math.random() - 0.5) * 2
        dy = (Math.random() - 0.5) * 2
        distSq = dx * dx + dy * dy
      }
      const dist = Math.sqrt(distSq)
      const f = params.repulsion / distSq
      const fx = (dx / dist) * f
      const fy = (dy / dist) * f
      add(a, fx, fy)
      add(b, -fx, -fy)
    }
  }

  // 2) 弹簧力：边上胡克定律，拉向静止长度
  for (const e of edges) {
    const pa = posOf(e.source)
    const pb = posOf(e.target)
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const dist = Math.max(1, Math.hypot(dx, dy))
    const stretch = dist - params.restLength
    const f = params.stiffness * stretch
    const fx = (dx / dist) * f
    const fy = (dy / dist) * f
    add(e.target, -fx, -fy)
    add(e.source, fx, fy)
  }

  // 3) 向心力 + 积分（阻尼、限幅）
  let cx = 0
  let cy = 0
  for (const id of ids) {
    const p = posOf(id)
    cx += p.x
    cy += p.y
  }
  cx /= ids.length || 1
  cy /= ids.length || 1

  let totalMove = 0
  for (const id of ids) {
    const p = pinned[id] ?? positions.get(id)!
    if (pinned[id]) {
      // 钉住节点直接落位，速度清零
      positions.set(id, { x: p.x, y: p.y })
      velocities.set(id, { x: 0, y: 0 })
      continue
    }
    const f = forces.get(id)!
    const v = velocities.get(id)!
    v.x = (v.x + f.x - (p.x - cx) * params.gravity) * params.damping
    v.y = (v.y + f.y - (p.y - cy) * params.gravity) * params.damping
    let dx = v.x * state.alpha
    let dy = v.y * state.alpha
    const mag = Math.hypot(dx, dy)
    if (mag > params.maxDisplacement) {
      dx = (dx / mag) * params.maxDisplacement
      dy = (dy / mag) * params.maxDisplacement
    }
    p.x += dx
    p.y += dy
    totalMove += Math.hypot(dx, dy)
    positions.set(id, { x: p.x, y: p.y })
  }

  // 4) 锚定节点归位：指数缓动逼近家点（临界阻尼感，无过冲，速度由 anchorEase 控制）
  for (const [id, home] of Object.entries(homeSprings)) {
    if (pinned[id]) continue
    const p = positions.get(id)
    if (!p) continue
    const dx = home.x - p.x
    const dy = home.y - p.y
    p.x += dx * params.anchorEase
    p.y += dy * params.anchorEase
    velocities.set(id, { x: 0, y: 0 })
    totalMove += Math.hypot(dx, dy) * params.anchorEase
    positions.set(id, { x: p.x, y: p.y })
  }
  return totalMove
}

/** 从 prerequisites 数组构造边表 */
export function edgesFromPrerequisites(nodes: { id: string; prerequisites: string[] }[]): ForceEdge[] {
  const edges: ForceEdge[] = []
  for (const n of nodes) {
    for (const pre of n.prerequisites) {
      edges.push({ source: pre, target: n.id })
    }
  }
  return edges
}
