import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PARAMS,
  ForceEdge,
  ForceNodeInput,
  edgesFromPrerequisites,
  initSim,
  simulateStep,
} from './forceLayout'

const mkNodes = (coords: [string, number, number][]): ForceNodeInput[] =>
  coords.map(([id, x, y]) => ({ id, layout: { x, y } }))

/** 跑 N 步并返回最终位置 */
function run(nodes: ForceNodeInput[], edges: ForceEdge[], steps: number, pinned: Record<string, { x: number; y: number }> = {}) {
  const sim = initSim(nodes)
  let last = sim.positions
  for (let i = 0; i < steps; i++) simulateStep(sim, nodes, edges, DEFAULT_PARAMS, pinned)
  last = sim.positions
  return Object.fromEntries(last)
}

describe('力导向布局引擎', () => {
  it('弹簧力把相连节点拉向静止长度（太近会推开，太远会拉近）', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 40, 0]])
    const edges = [{ source: 'a', target: 'b' }]
    const after = run(nodes, edges, 120)
    const dist = Math.hypot(after['a'].x - after['b'].x, after['a'].y - after['b'].y)
    // 初始 40 → 被弹簧行为推向静止长度附近（斥力会让它略超，但应在合理区间）
    expect(dist).toBeGreaterThan(DEFAULT_PARAMS.restLength * 0.8)
    expect(dist).toBeLessThan(DEFAULT_PARAMS.restLength * 2.2)
  })

  it('斥力使无连边节点互相远离', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 10, 0]])
    const after = run(nodes, [], 60)
    const dist = Math.hypot(after['a'].x - after['b'].x, after['a'].y - after['b'].y)
    expect(dist).toBeGreaterThan(60)
  })

  it('拖拽联动：钉住 a 移动时，与 a 相连的 b 被弹簧拽向 a 的新位置', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 220, 0]])
    const edges = [{ source: 'a', target: 'b' }]
    // 钉住 a 到 (100, 400)（远离 b，弹簧被拉伸），跑若干步
    const after = run(nodes, edges, 80, { a: { x: 100, y: 400 } })
    const afterDist = Math.hypot(after['b'].x - 100, after['b'].y - 400)
    const initialSpan = Math.hypot(100 - 220, 400 - 0) // 若 b 不动，与新 a 的距离
    // b 被拽向 a 的新位置：比「原地不动」更近，且接近弹簧静止长度
    expect(afterDist).toBeLessThan(initialSpan)
    expect(afterDist).toBeGreaterThan(DEFAULT_PARAMS.restLength * 0.5)
    // b 的位置确实动了（跟随联动）
    expect(Math.hypot(after['b'].x - 220, after['b'].y - 0)).toBeGreaterThan(30)
  })

  it('钉住的节点精确停在指针位置，不受力影响', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 500, 500]])
    const after = run(nodes, [], 30, { a: { x: 123, y: 45 } })
    expect(after['a'].x).toBe(123)
    expect(after['a'].y).toBe(45)
  })

  it('锚定归位：指数缓动逐步收敛回家，平滑无过冲', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 400, 0]])
    const sim = initSim(nodes)
    const home = { x: 200, y: 0 }
    let prevDist = 200
    let overshoot = false
    for (let i = 0; i < 200; i++) {
      simulateStep(sim, nodes, [], { ...DEFAULT_PARAMS }, {}, { a: home })
      const p = sim.positions.get('a')!
      const d = Math.hypot(p.x - 200, p.y - 0)
      if (d > prevDist + 0.001) overshoot = true
      prevDist = d
    }
    const p = sim.positions.get('a')!
    expect(Math.hypot(p.x - 200, p.y - 0)).toBeLessThan(1)
    expect(overshoot).toBe(false)
  })

  it('edgesFromPrerequisites 正确展开前置关系', () => {
    const edges = edgesFromPrerequisites([
      { id: 'b', prerequisites: ['a', 'c'] },
      { id: 'c', prerequisites: [] },
    ])
    expect(edges).toEqual([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'b' },
    ])
  })

  it('布局会收敛：连续模拟后总位移趋于极小', () => {
    const nodes = mkNodes([['a', 0, 0], ['b', 100, 100], ['c', -50, 200]])
    const edges = [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]
    const sim = initSim(nodes)
    for (let i = 0; i < 600; i++) simulateStep(sim, nodes, edges, DEFAULT_PARAMS)
    const finalMove = simulateStep(sim, nodes, edges, DEFAULT_PARAMS)
    expect(finalMove).toBeLessThan(1)
  })
})
