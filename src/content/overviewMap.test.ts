import { describe, expect, it } from 'vitest'
import { loadDefaultContent } from './contentStore'
import { OVERVIEW_ROOT_ID, buildOverviewNodes, moduleMasteredCount } from './overviewMap'
import { allModules, emptyProfile } from '../domain/models'

const store = loadDefaultContent()
const nodes = buildOverviewNodes(store.pack)
const byId = new Map(nodes.map((n) => [n.id, n]))

describe('总览树形布局', () => {
  it('「英语」根在最底部，其余节点全部在它上方', () => {
    const root = byId.get(OVERVIEW_ROOT_ID)!
    for (const n of nodes) {
      if (n.id === OVERVIEW_ROOT_ID) continue
      expect(n.layout.y, `${n.title} 应在英语上方`).toBeLessThan(root.layout.y)
    }
  })

  it('树形结构：每个模块只有一个父节点，且从根全部可达、无环', () => {
    const modules = nodes.filter((n) => n.id !== OVERVIEW_ROOT_ID)
    for (const n of modules) {
      expect(n.prerequisites, `${n.title} 应恰好一个父节点`).toHaveLength(1)
      expect(n.prerequisites[0]).not.toBe(n.id)
    }
    // 从根沿「父 → 子」方向 BFS，所有模块都应可达
    const childrenOf = new Map<string, string[]>()
    for (const n of modules) {
      const p = n.prerequisites[0]
      childrenOf.set(p, [...(childrenOf.get(p) ?? []), n.id])
    }
    const seen = new Set([OVERVIEW_ROOT_ID])
    const queue = [OVERVIEW_ROOT_ID]
    while (queue.length) {
      const cur = queue.shift()!
      for (const c of childrenOf.get(cur) ?? []) {
        if (seen.has(c)) continue
        seen.add(c)
        queue.push(c)
      }
    }
    for (const n of modules) {
      expect(seen.has(n.id), `${n.title} 应从英语可达`).toBe(true)
    }
  })

  it('层级：地基三科（语法/词汇/发音）同层，功能在其上，语篇与技能在顶端', () => {
    const y = (id: string) => byId.get(id)!.layout.y
    expect(y('grammar')).toBe(y('vocabulary'))
    expect(y('vocabulary')).toBe(y('pronunciation'))
    expect(y('functions')).toBeLessThan(y('grammar'))
    expect(y('discourse')).toBeLessThan(y('functions'))
    expect(y('skills')).toBe(y('discourse'))
  })

  it('真实跨模块前置保留：功能←语法，技能←功能', () => {
    expect(byId.get('functions')!.prerequisites).toEqual(['grammar'])
    expect(byId.get('skills')!.prerequisites).toEqual(['functions'])
  })

  it('节点位置互不重叠，同层节点水平分布', () => {
    const seen = new Set<string>()
    for (const n of nodes) {
      const key = `${n.layout.x},${n.layout.y}`
      expect(seen.has(key), `${n.title} 与其他节点重叠`).toBe(false)
      seen.add(key)
    }
    expect(byId.get('grammar')!.layout.x).toBeLessThan(byId.get('vocabulary')!.layout.x)
    expect(byId.get('pronunciation')!.layout.x).toBeGreaterThan(byId.get('vocabulary')!.layout.x)
  })
})

describe('级别筛选口径', () => {
  const grammar = allModules(store.pack).find((m) => m.id === 'grammar')!
  const grammarNodes = grammar.subsystems.flatMap((s) => s.nodes)
  const a1Only = grammarNodes.find((n) => n.level.includes('A1') && !n.level.includes('A2'))!
  const a2Only = grammarNodes.find((n) => n.level.includes('A2') && !n.level.includes('A1'))!

  function passProfile(ids: string[]) {
    const profile = emptyProfile()
    for (const id of ids) {
      profile.nodeProgress[id] = {
        attempts: 1, bestCorrect: 1, totalQuestions: 1, passed: true, lastStudiedAt: null,
      }
    }
    return profile
  }

  it('moduleMasteredCount 只统计所选级别内的点亮节点', () => {
    const profile = passProfile([a1Only.id, a2Only.id])
    expect(moduleMasteredCount(grammar, profile, null)).toBe(2)
    expect(moduleMasteredCount(grammar, profile, 'A1')).toBe(1)
    expect(moduleMasteredCount(grammar, profile, 'A2')).toBe(1)
    expect(moduleMasteredCount(grammar, passProfile([a1Only.id]), 'A2')).toBe(0)
  })
})
