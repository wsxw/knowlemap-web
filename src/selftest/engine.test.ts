// 核心规则自测：逐项对齐 macOS 版 CoreDomainSelfTest 的 8 项断言，
// 并新增内容包完整性校验。运行：npm run selftest
import { describe, expect, it } from 'vitest'
import {
  ContentPack,
  Domain,
  KnowledgeMap,
  KnowledgeModule,
  KnowledgeNode,
  LearningProfile,
  NodeProgress,
  Question,
  Activity,
  emptyProfile,
} from '../domain/models'
import * as engine from '../domain/learningEngine'
import { loadDefaultContent } from '../content/contentStore'
import contentJson from '../data/content.json'

// MARK: 夹具（对齐 Swift 版 makeNode / makePack / pass）

function makeNode(id: string, prerequisites: string[] = [], level: string[] = ['A1']): KnowledgeNode {
  return {
    id,
    title: id,
    level,
    organizer: '',
    explanation: [],
    activity: { type: 'freeWrite', prompt: '', sampleAnswer: '' },
    quiz: {
      passThreshold: 0.8,
      questions: Array.from({ length: 4 }, (_, i) => ({
        type: 'choice',
        prompt: `q${i}`,
        options: ['a', 'b'],
        answerIndex: 0,
        answerText: undefined,
        explanation: '',
      }) satisfies Question),
    },
    prerequisites,
    related: [],
    layout: { x: 0, y: 0 },
  }
}

function makePack(): ContentPack {
  const tenseMap: KnowledgeMap = {
    id: 'tense_system',
    name: '时态系统',
    nodes: [
      makeNode('tense_overview'),
      makeNode('be_present', ['tense_overview']),
      makeNode('present_simple', ['be_present']),
    ],
  }
  const funcMap: KnowledgeMap = {
    id: 'function_nodes',
    name: '日常交际功能',
    nodes: [makeNode('greetings_personal_info'), makeNode('daily_routine_description')],
  }
  const grammar: KnowledgeModule = { id: 'grammar', name: '语法', subsystems: [tenseMap] }
  const functions: KnowledgeModule = { id: 'functions', name: '功能', subsystems: [funcMap] }
  const domain: Domain = { id: 'en', name: '英语', modules: [grammar, functions] }
  return { schemaVersion: 2, domains: [domain] }
}

function pass(profile: LearningProfile, nodeId: string, correct: number, total: number) {
  const p = profile.nodeProgress[nodeId] ?? ({ attempts: 0, bestCorrect: 0, totalQuestions: 0, passed: false, lastStudiedAt: null } satisfies NodeProgress)
  profile.nodeProgress[nodeId] = {
    ...p,
    attempts: p.attempts + 1,
    totalQuestions: total,
    bestCorrect: Math.max(p.bestCorrect, correct),
    lastStudiedAt: new Date().toISOString(),
    passed: p.passed || engine.isPassed(correct, total, 0.8),
  }
}

// MARK: 用例

describe('通关判定（≥ 阈值）', () => {
  it('阈值边界与除零保护', () => {
    expect(engine.isPassed(4, 5, 0.8)).toBe(true) // 0.8 恰好达标应通过
    expect(engine.isPassed(3, 5, 0.8)).toBe(false)
    expect(engine.isPassed(4, 4, 0.8)).toBe(true)
    expect(engine.isPassed(0, 0, 0.8)).toBe(false) // 除零保护
  })
})

describe('解锁规则（前置全部掌握）', () => {
  const node = makeNode('b', ['a1', 'a2'])
  it('部分前置满足不解锁，全部满足才解锁；根节点默认解锁', () => {
    expect(engine.isUnlocked(node, new Set(['a1']))).toBe(false)
    expect(engine.isUnlocked(node, new Set(['a1', 'a2']))).toBe(true)
    expect(engine.isUnlocked(makeNode('root'), new Set())).toBe(true)
  })
})

describe('节点状态推导', () => {
  it('available → inProgress → mastered → 前置解锁', () => {
    let profile = emptyProfile()
    const node = makeNode('n1')
    expect(engine.statusOf(node, profile)).toBe('available')

    profile.nodeProgress['n1'] = {
      attempts: 1, bestCorrect: 2, totalQuestions: 4, passed: false, lastStudiedAt: null,
    }
    expect(engine.statusOf(node, profile)).toBe('inProgress')

    pass(profile, 'n1', 4, 4)
    expect(engine.statusOf(node, profile)).toBe('mastered')

    const locked = makeNode('n2', ['n1'])
    expect(engine.statusOf(locked, profile)).toBe('available') // 前置满足后解锁
  })
})

describe('等级与经验', () => {
  it('每 100 XP 一级', () => {
    expect(engine.level(0)).toBe(1)
    expect(engine.level(50)).toBe(1)
    expect(engine.level(100)).toBe(2)
    expect(engine.level(250)).toBe(3)
    expect(Math.abs(engine.levelProgress(250) - 0.5)).toBeLessThan(0.001)
  })
})

describe('徽章结算', () => {
  it('无进度无徽章；首通点亮；时态三节点触发探索者', () => {
    const profile: LearningProfile = emptyProfile()
    const pack = makePack()
    expect(engine.evaluateBadges(profile, pack)).toHaveLength(0)

    pass(profile, 'greetings_personal_info', 4, 4)
    expect(engine.evaluateBadges(profile, pack).map((b) => b.id)).toEqual(['first-light'])

    pass(profile, 'tense_overview', 4, 4)
    pass(profile, 'be_present', 4, 4)
    pass(profile, 'present_simple', 4, 4)
    const badges = engine.evaluateBadges(profile, pack)
    expect(badges.some((b) => b.id === 'tense-explorer')).toBe(true)
  })
})

describe('总进度计算', () => {
  it('比例与除零保护', () => {
    expect(Math.abs(engine.overallProgress(3, 4) - 0.75)).toBeLessThan(0.001)
    expect(engine.overallProgress(0, 0)).toBe(0)
  })
})

describe('下一步推荐', () => {
  it('只推荐直接下游且已解锁的节点', () => {
    const pack = makePack()
    const profile = emptyProfile()
    pass(profile, 'tense_overview', 4, 4)
    const mastered = engine.masteredIds(profile)
    const recs = engine.nextRecommendations(pack.domains[0].modules[0].subsystems[0].nodes[0], pack, mastered)
    expect(recs.map((r) => r.id)).toEqual(['be_present'])
    expect(recs.some((r) => r.id === 'present_simple')).toBe(false)
  })
})

describe('填空答案归一化', () => {
  it('忽略大小写/空格/末尾句点', () => {
    expect(engine.isFillInAnswerCorrect('goes', 'goes')).toBe(true)
    expect(engine.isFillInAnswerCorrect(' Goes ', 'goes')).toBe(true)
    expect(engine.isFillInAnswerCorrect('goes.', 'goes')).toBe(true)
    expect(engine.isFillInAnswerCorrect("i'll", "I'll")).toBe(true)
    expect(engine.isFillInAnswerCorrect('go', 'goes')).toBe(false)
    expect(engine.isFillInAnswerCorrect('', 'goes')).toBe(false)
  })
})

// MARK: Web 版新增——真实内容包校验

describe('内容包加载与校验', () => {
  const store = loadDefaultContent()

  it('内容包可解析并通过全部校验规则', () => {
    expect(() => loadDefaultContent()).not.toThrow()
  })

  it('v1.2 全量课程规模：60 节点 / 240 题，schema v2', () => {
    expect(contentJson.schemaVersion).toBe(2)
    const nodes = store.pack.domains.flatMap((d) => d.modules.flatMap((m) => m.subsystems.flatMap((s) => s.nodes)))
    expect(nodes.length).toBe(60)
    const questionCount = nodes.reduce((sum, n) => sum + n.quiz.questions.length, 0)
    expect(questionCount).toBe(240)
  })

  it('索引查询：node/mapContaining/breadcrumb/downstream', () => {
    const node = store.node('present_simple')
    expect(node).toBeDefined()
    expect(store.mapContaining('present_simple')?.id).toBe('tense_system')
    expect(store.breadcrumbForNode(node!)).toEqual(['英语', '语法', '时态系统', node!.title])
    const downstream = store.downstream('be_present')
    expect(downstream.map((n) => n.id)).toContain('present_simple')
  })

  it('Activity 类型可用（导入完整性检查）', () => {
    const a: Activity = makeNode('x').activity
    expect(a.type).toBe('freeWrite')
  })
})
