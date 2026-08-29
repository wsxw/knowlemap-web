// 学习进度持久化：localStorage（对齐 macOS 版 PersistenceKit/ProgressPersistence.swift 的语义）
//
// 设计取舍：Web 版用 localStorage 替代 JSON 文件——同样是无复杂查询的小数据量场景；
// 文件损坏时备份并重开的策略也一并保留，避免损坏数据卡死用户。
import { LearningProfile, emptyProfile } from '../domain/models'

const STORAGE_KEY = 'knowlemap.progress.v1'

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null // 隐私模式等场景下访问 localStorage 可能抛错
  }
}

/**
 * 加载档案：无记录 → 全新档案；解析失败 → 备份旧值到 .corrupted-<ts> 键并重开。
 * 日期以 ISO8601 存取，与 Mac 版 progress.json 兼容同一套字段。
 */
export function loadProfile(): LearningProfile {
  const ls = storage()
  if (!ls) return emptyProfile()
  const raw = ls.getItem(STORAGE_KEY)
  if (!raw) return emptyProfile()
  try {
    const parsed = JSON.parse(raw) as LearningProfile
    if (typeof parsed?.xp !== 'number' || typeof parsed?.nodeProgress !== 'object') {
      throw new Error('字段缺失')
    }
    return parsed
  } catch {
    try {
      ls.setItem(`${STORAGE_KEY}.corrupted-${Date.now()}`, raw)
      ls.removeItem(STORAGE_KEY)
    } catch {
      // 备份失败不影响重开档案
    }
    return emptyProfile()
  }
}

/** 保存档案，失败时抛错由调用方提示 */
export function saveProfile(profile: LearningProfile): void {
  const ls = storage()
  if (!ls) throw new Error('localStorage 不可用')
  ls.setItem(STORAGE_KEY, JSON.stringify(profile))
}
