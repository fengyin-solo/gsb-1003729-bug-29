import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ---- 领域切片：批次、复核事项这类结构化对象不放 entries，单独存一份。 ----
const DOMAIN_STORAGE_KEY = 'hydrology-monitor-station:domain'

let domainCache: Record<string, unknown> | null = null

function readDomainStorage(): Record<string, unknown> {
  if (domainCache !== null) {
    return domainCache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    domainCache = {}
    return domainCache
  }
  const raw = window.localStorage.getItem(DOMAIN_STORAGE_KEY)
  if (!raw) {
    domainCache = {}
    return domainCache
  }
  try {
    domainCache = JSON.parse(raw) as Record<string, unknown>
  } catch {
    domainCache = {}
  }
  return domainCache
}

export function readDomain<T>(key: string, fallback: T): T {
  const stored = readDomainStorage()[key]
  if (stored === undefined) {
    return clone(fallback)
  }
  return clone(stored) as T
}

export function writeDomain<T>(key: string, value: T): void {
  const next = { ...readDomainStorage(), [key]: value }
  domainCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(next))
  }
}
