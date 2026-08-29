import { describe, expect, it } from 'vitest'
import { hashFor, parseHash } from './routing'
import { loadDefaultContent } from './content/contentStore'

const store = loadDefaultContent()

describe('hash 路由', () => {
  it('状态 → hash：总览/子系统/级别/选中节点', () => {
    expect(hashFor('overview', null)).toBe('#/overview')
    expect(hashFor(null, null)).toBe('#/overview')
    expect(hashFor('overview', null, 'A1')).toBe('#/overview/A1')
    expect(hashFor('tense_system', null)).toBe('#/tense_system')
    expect(hashFor('tense_system', null, 'A1')).toBe('#/tense_system/A1')
    expect(hashFor('tense_system', 'present_simple')).toBe('#/tense_system/present_simple')
    expect(hashFor('tense_system', 'present_simple', 'A1')).toBe('#/tense_system/A1/present_simple')
  })

  it('hash → 状态：合法值还原，节点归属校验', () => {
    expect(parseHash('#/overview', store)).toEqual({ mapId: 'overview', nodeId: null, level: null })
    expect(parseHash('', store)).toEqual({ mapId: 'overview', nodeId: null, level: null })
    expect(parseHash('#/overview/A1', store)).toEqual({ mapId: 'overview', nodeId: null, level: 'A1' })
    expect(parseHash('#/tense_system', store)).toEqual({ mapId: 'tense_system', nodeId: null, level: null })
    expect(parseHash('#/tense_system/A1', store)).toEqual({ mapId: 'tense_system', nodeId: null, level: 'A1' })
    expect(parseHash('#/tense_system/present_simple', store)).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
      level: null,
    })
    expect(parseHash('#/tense_system/A1/present_simple', store)).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
      level: 'A1',
    })
  })

  it('非法 hash 回退总览；节点不属于该子系统时丢弃节点；非法级别丢弃级别', () => {
    expect(parseHash('#/no_such_map', store)).toEqual({ mapId: 'overview', nodeId: null, level: null })
    // present_simple 属于 tense_system，放在别的子系统下视为无效
    expect(parseHash('#/sentence_structure/present_simple', store)).toEqual({
      mapId: 'sentence_structure',
      nodeId: null,
      level: null,
    })
    // 非法级别段不在内容包里 → 当作节点 id 处理（查无此节点则丢弃）
    expect(parseHash('#/tense_system/Z9', store)).toEqual({ mapId: 'tense_system', nodeId: null, level: null })
    expect(parseHash('#/tense_system/Z9/present_simple', store)).toEqual({
      mapId: 'tense_system',
      nodeId: null,
      level: null,
    })
  })

  it('编解码往返一致（含级别）', () => {
    const round = (mapId: string | null, nodeId: string | null, level: string | null = null) =>
      parseHash(hashFor(mapId, nodeId, level), store)
    expect(round('overview', null)).toEqual({ mapId: 'overview', nodeId: null, level: null })
    expect(round('overview', null, 'A1')).toEqual({ mapId: 'overview', nodeId: null, level: 'A1' })
    expect(round('tense_system', null)).toEqual({ mapId: 'tense_system', nodeId: null, level: null })
    expect(round('tense_system', null, 'A2')).toEqual({ mapId: 'tense_system', nodeId: null, level: 'A2' })
    expect(round('tense_system', 'present_simple')).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
      level: null,
    })
    expect(round('tense_system', 'present_simple', 'A1')).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
      level: 'A1',
    })
  })
})
