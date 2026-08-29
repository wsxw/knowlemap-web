import { describe, expect, it } from 'vitest'
import { hashFor, parseHash } from './routing'
import { loadDefaultContent } from './content/contentStore'

const store = loadDefaultContent()

describe('hash 路由', () => {
  it('状态 → hash：总览/子系统/选中节点', () => {
    expect(hashFor('overview', null)).toBe('#/overview')
    expect(hashFor(null, null)).toBe('#/overview')
    expect(hashFor('tense_system', null)).toBe('#/tense_system')
    expect(hashFor('tense_system', 'present_simple')).toBe('#/tense_system/present_simple')
  })

  it('hash → 状态：合法值还原，节点归属校验', () => {
    expect(parseHash('#/overview', store)).toEqual({ mapId: 'overview', nodeId: null })
    expect(parseHash('', store)).toEqual({ mapId: 'overview', nodeId: null })
    expect(parseHash('#/tense_system', store)).toEqual({ mapId: 'tense_system', nodeId: null })
    expect(parseHash('#/tense_system/present_simple', store)).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
    })
  })

  it('非法 hash 回退总览；节点不属于该子系统时丢弃节点', () => {
    expect(parseHash('#/no_such_map', store)).toEqual({ mapId: 'overview', nodeId: null })
    // present_simple 属于 tense_system，放在别的子系统下视为无效
    expect(parseHash('#/sentence_structure/present_simple', store)).toEqual({
      mapId: 'sentence_structure',
      nodeId: null,
    })
  })

  it('编解码往返一致', () => {
    const round = (mapId: string | null, nodeId: string | null) =>
      parseHash(hashFor(mapId, nodeId), store)
    expect(round('overview', null)).toEqual({ mapId: 'overview', nodeId: null })
    expect(round('tense_system', null)).toEqual({ mapId: 'tense_system', nodeId: null })
    expect(round('tense_system', 'present_simple')).toEqual({
      mapId: 'tense_system',
      nodeId: 'present_simple',
    })
  })
})
