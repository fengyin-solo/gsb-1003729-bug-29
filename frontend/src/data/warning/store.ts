import {
  SEED_BATCHES,
  SEED_REVIEW_ITEMS,
  SEED_UPSTREAM,
  SEED_WARNING_CONFIGS,
} from './seed'
import type { RecalcBatch, ReviewItem, UpstreamObs, WarningConfig } from './types'

/**
 * 预警域本地持久化：与通用条目存储分开，避免被通用重置逻辑覆盖。
 * 配置 / 批次 / 事项三张表各自带命名空间，升级时只补不覆盖用户改动。
 */
const STATE_KEY = 'hydrology-monitor-station:warning-domain:v1'
const SEQ_KEY = 'hydrology-monitor-station:warning-domain:seq'

type WarningState = {
  configs: WarningConfig[]
  batches: RecalcBatch[]
  reviewItems: ReviewItem[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function initialState(): WarningState {
  return {
    configs: clone(SEED_WARNING_CONFIGS),
    batches: clone(SEED_BATCHES),
    reviewItems: clone(SEED_REVIEW_ITEMS),
  }
}

function readState(): WarningState {
  const fallback = initialState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WarningState>
    // 新表缺失时补齐，保证旧浏览器里的存量数据平滑升级。
    return {
      configs: Array.isArray(parsed.configs) ? parsed.configs : fallback.configs,
      batches: Array.isArray(parsed.batches) ? parsed.batches : fallback.batches,
      reviewItems: Array.isArray(parsed.reviewItems) ? parsed.reviewItems : fallback.reviewItems,
    }
  } catch {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: WarningState | null = null

function state(): WarningState {
  if (cache === null) {
    cache = readState()
  }
  return cache
}

export function persist(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state()))
}

export function listConfigs(): WarningConfig[] {
  return state().configs
}

export function saveConfigs(configs: WarningConfig[]): void {
  state().configs = configs
  persist()
}

export function listBatches(): RecalcBatch[] {
  return state().batches
}

export function saveBatches(batches: RecalcBatch[]): void {
  state().batches = batches
  persist()
}

export function listReviewItems(): ReviewItem[] {
  return state().reviewItems
}

export function saveReviewItems(items: ReviewItem[]): void {
  state().reviewItems = items
  persist()
}

/** 上游观测为跨模块只读参考数据，统一口径版本由数据源携带。 */
export function listUpstream(): UpstreamObs[] {
  return clone(SEED_UPSTREAM)
}

function readSeq(): Record<string, number> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(SEQ_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

export function nextSequence(name: string): number {
  const seq = readSeq()
  const value = (seq[name] ?? 0) + 1
  seq[name] = value
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SEQ_KEY, JSON.stringify(seq))
  }
  return value
}
