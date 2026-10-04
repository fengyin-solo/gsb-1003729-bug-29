import { listRows, readDomain, saveRows, writeDomain } from '@/data/local-store'
import { hasPermission, permissionLabel } from '@/data/permissions'
import type {
  ActionResult,
  BatchSubmitResult,
  EntryRow,
  RecalcBatch,
  RecalcItem,
  RecalcResult,
  ThresholdSet,
  WarningLevel,
} from '@/data/types'
import { createReviewItem } from '@/api/review-service'

// 预警阈值领域服务：版本、批量重算、统一发布、复核详情都从这里过，页面不做业务判断。
//
// 根因说明：旧做法把重算结果直接平铺覆盖在配置/记录上，多选后新记录仍按内存里
// 旧版本的阈值判断，逐条结果和历史版本混在一处。现在的数据流是：
//   提交 → 一个批次（含每条配置的版本+阈值快照）→ 整组处理 → 统一发布（幂等）
//   → 跨模块写回预警级别 → 生成复核事项。
// 结果只挂在「批次 × 版本快照」上，复核详情按批次查看，不再与历史版本混排。

const BATCH_KEY = 'warningRecalcBatches'

const WARNING_KEY = 'warning'

/** 监测类型 → 数据来源模块与取值字段：重算顺着这条跨模块数据流取数。 */
const MONITOR_SOURCES: Record<string, { module: string; valueField: string }> = {
  水位: { module: 'waterlevel', valueField: '当前水位' },
  流量: { module: 'discharge', valueField: '断面流量' },
  雨量: { module: 'rainfall', valueField: '时段雨量' },
}

/** 存量缺阈值的补数默认值：按监测类型给一套可用的四级阈值，并打补数标记。 */
const DEFAULT_THRESHOLDS: Record<string, ThresholdSet> = {
  水位: { 蓝色: 3.0, 黄色: 3.5, 橙色: 4.0, 红色: 4.5 },
  流量: { 蓝色: 100, 黄色: 200, 橙色: 300, 红色: 400 },
  雨量: { 蓝色: 30, 黄色: 50, 橙色: 70, 红色: 100 },
  默认: { 蓝色: 10, 黄色: 20, 橙色: 30, 红色: 40 },
}

const THRESHOLD_FIELDS = ['蓝色阈值', '黄色阈值', '橙色阈值', '红色阈值'] as const

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function deny(role: string, permission: string): ActionResult {
  return { ok: false, message: `越权操作已拒绝：角色「${role}」没有「${permissionLabel(permission)}」权限` }
}

function toNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function thresholdsOf(row: EntryRow): ThresholdSet | null {
  const values = THRESHOLD_FIELDS.map((field) => toNumber(row[field]))
  if (values.some((value) => value === null)) {
    return null
  }
  const [蓝色, 黄色, 橙色, 红色] = values as number[]
  return { 蓝色, 黄色, 橙色, 红色 }
}

function thresholdsOrdered(set: ThresholdSet): boolean {
  return set.蓝色 < set.黄色 && set.黄色 < set.橙色 && set.橙色 < set.红色
}

/**
 * 存量数据迁移：老数据缺版本、阈值是占位文本。读配置前统一补齐——
 * 版本补 1；阈值按监测类型套默认值并打「阈值补数」标记，改动了就落库一次。
 */
function ensureWarningConfigs(): EntryRow[] {
  const rows = listRows(WARNING_KEY)
  let changed = false
  const next = rows.map((row) => {
    const migrated: EntryRow = { ...row }
    if (toNumber(migrated['版本']) === null) {
      migrated['版本'] = 1
      changed = true
    }
    if (thresholdsOf(migrated) === null) {
      const defaults = DEFAULT_THRESHOLDS[String(migrated['监测类型'])] ?? DEFAULT_THRESHOLDS['默认']
      migrated['蓝色阈值'] = defaults.蓝色
      migrated['黄色阈值'] = defaults.黄色
      migrated['橙色阈值'] = defaults.橙色
      migrated['红色阈值'] = defaults.红色
      migrated['阈值补数'] = '是'
      changed = true
    }
    return migrated
  })
  if (changed) {
    saveRows(WARNING_KEY, next)
  }
  return next
}

export function listWarningConfigs(): EntryRow[] {
  return ensureWarningConfigs()
}

/** 调整阈值：生成新版本（版本号 +1），旧版本只留在历史批次的快照里。 */
export function adjustThresholds(
  configId: number,
  thresholds: ThresholdSet,
  operator: string,
  role: string,
): ActionResult {
  if (!hasPermission(role, 'warning:adjust')) {
    return deny(role, 'warning:adjust')
  }
  if (!thresholdsOrdered(thresholds)) {
    return { ok: false, message: '阈值层级必须满足 蓝色 < 黄色 < 橙色 < 红色' }
  }
  const rows = ensureWarningConfigs()
  const index = rows.findIndex((row) => Number(row.id) === configId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${configId} 的预警阈值配置` }
  }
  if (String(rows[index].status) === '已停用') {
    return { ok: false, message: '配置已停用，不能调整阈值' }
  }
  const version = (toNumber(rows[index]['版本']) ?? 1) + 1
  const next = [...rows]
  next[index] = {
    ...rows[index],
    蓝色阈值: thresholds.蓝色,
    黄色阈值: thresholds.黄色,
    橙色阈值: thresholds.橙色,
    红色阈值: thresholds.红色,
    版本: version,
    阈值补数: '否',
    status: '已调整',
    pending: true,
    abnormal: false,
  }
  saveRows(WARNING_KEY, next)
  return { ok: true, message: `配置已调整并生成新版本 V${version}，重算将按新版本判断` }
}

export function judgeLevel(value: number, thresholds: ThresholdSet): WarningLevel {
  if (value >= thresholds.红色) return '红色'
  if (value >= thresholds.橙色) return '橙色'
  if (value >= thresholds.黄色) return '黄色'
  if (value >= thresholds.蓝色) return '蓝色'
  return '无预警'
}

/** 用快照阈值重算一个配置：返回结果或失败原因，不触碰任何存储。 */
function recalcOne(item: RecalcItem, config: EntryRow | undefined): RecalcItem {
  if (!config) {
    return { ...item, status: '失败', 失败原因: '配置不存在或已删除', 结果: null }
  }
  if (String(config.status) === '已停用') {
    return { ...item, status: '失败', 失败原因: '配置已停用，不参与重算', 结果: null }
  }
  const source = MONITOR_SOURCES[String(config['监测类型'])]
  if (!source) {
    return { ...item, status: '失败', 失败原因: `监测类型「${config['监测类型']}」未接入重算数据流`, 结果: null }
  }
  if (!thresholdsOrdered(item.阈值快照)) {
    return { ...item, status: '失败', 失败原因: '阈值快照层级无效，请先调整阈值生成新版本', 结果: null }
  }
  const records = listRows(source.module).filter(
    (row) => String(row['站点编号']) === String(config['站点编号']),
  )
  const 结果: RecalcResult = { 样本数: 0, 无预警: 0, 蓝色: 0, 黄色: 0, 橙色: 0, 红色: 0, 最高级别: '无预警' }
  const order: WarningLevel[] = ['无预警', '蓝色', '黄色', '橙色', '红色']
  for (const record of records) {
    const value = toNumber(record[source.valueField])
    if (value === null) {
      continue
    }
    const level = judgeLevel(value, item.阈值快照)
    结果[level] += 1
    结果.样本数 += 1
    if (order.indexOf(level) > order.indexOf(结果.最高级别)) {
      结果.最高级别 = level
    }
  }
  return { ...item, status: '待发布', 失败原因: '', 结果 }
}

export function listRecalcBatches(): RecalcBatch[] {
  return readDomain<RecalcBatch[]>(BATCH_KEY, [])
}

export function getRecalcBatch(batchId: number): RecalcBatch | null {
  return listRecalcBatches().find((batch) => batch.id === batchId) ?? null
}

/**
 * 批量重算：一次提交只形成一个批次。提交时对每条配置截取「版本 + 阈值」快照，
 * 随后整组处理完才进入待发布；判断只认快照，之后配置再调整也不影响本批次。
 */
export function submitRecalcBatch(configIds: number[], operator: string, role: string): BatchSubmitResult {
  if (!hasPermission(role, 'warning:recalc')) {
    return { ...deny(role, 'warning:recalc'), batch: null }
  }
  const uniqueIds = [...new Set(configIds)]
  if (uniqueIds.length === 0) {
    return { ok: false, message: '请先勾选要重算的预警阈值配置', batch: null }
  }
  const configs = ensureWarningConfigs()
  const items: RecalcItem[] = uniqueIds.map((configId, index) => {
    const config = configs.find((row) => Number(row.id) === configId)
    return {
      id: index + 1,
      configId,
      配置编号: String(config?.['配置编号'] ?? `#${configId}`),
      站点编号: String(config?.['站点编号'] ?? ''),
      监测类型: String(config?.['监测类型'] ?? ''),
      版本: toNumber(config?.['版本']) ?? 1,
      阈值快照: (config && thresholdsOf(config)) ?? { ...DEFAULT_THRESHOLDS['默认'] },
      status: '待发布',
      失败原因: '',
      结果: null,
      备注: '',
    }
  })
  // 整组处理：逐条算出结果或失败原因，全部处理完批次才进入待发布。
  const processed = items.map((item) =>
    recalcOne(item, configs.find((row) => Number(row.id) === item.configId)),
  )
  const batches = listRecalcBatches()
  const batch: RecalcBatch = {
    id: batches.reduce((max, row) => Math.max(max, row.id), 0) + 1,
    批次号: `RC-${now().slice(0, 10).replace(/-/g, '')}-${String(batches.length + 1).padStart(3, '0')}`,
    提交人: operator,
    提交时间: now(),
    status: '待发布',
    发布人: '',
    发布时间: '',
    items: processed,
  }
  writeDomain(BATCH_KEY, [...batches, batch])
  const failed = processed.filter((item) => item.status === '失败').length
  return {
    ok: true,
    message: `批次 ${batch.批次号} 已生成并完成整组处理：${processed.length - failed} 条待发布，${failed} 条失败可单独退出`,
    batch,
  }
}

/** 失败配置单独退出：只影响这一条，批次里其余配置照常发布。 */
export function excludeRecalcItem(batchId: number, itemId: number, operator: string, role: string): ActionResult {
  if (!hasPermission(role, 'warning:exclude')) {
    return deny(role, 'warning:exclude')
  }
  const batches = listRecalcBatches()
  const batchIndex = batches.findIndex((batch) => batch.id === batchId)
  if (batchIndex < 0) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的重算批次` }
  }
  const batch = batches[batchIndex]
  if (batch.status === '已发布') {
    return { ok: false, message: '批次已发布，不能再退出配置' }
  }
  const itemIndex = batch.items.findIndex((item) => item.id === itemId)
  if (itemIndex < 0) {
    return { ok: false, message: `批次里没有编号为 ${itemId} 的配置` }
  }
  const item = batch.items[itemIndex]
  if (item.status !== '失败') {
    return { ok: false, message: '只有失败的配置才能单独退出' }
  }
  const items = [...batch.items]
  items[itemIndex] = { ...item, status: '已退出', 备注: `由 ${operator} 退出` }
  const next = [...batches]
  next[batchIndex] = { ...batch, items }
  writeDomain(BATCH_KEY, next)
  return { ok: true, message: `配置 ${item.配置编号} 已退出批次 ${batch.批次号}` }
}

/**
 * 统一发布：整组处理完后一次性生效。
 * - 幂等：同一批次重复发布直接返回，不再产生任何副作用；
 *   不同批次里同一配置的同一版本也只生效一次，后来的标「已跳过」。
 * - 跨模块写回：按快照阈值给来源模块的监测记录打预警级别，橙色/红色记异常，
 *   并为命中的配置生成复核事项。
 */
export function publishRecalcBatch(batchId: number, operator: string, role: string): ActionResult {
  if (!hasPermission(role, 'warning:publish')) {
    return deny(role, 'warning:publish')
  }
  const batches = listRecalcBatches()
  const batchIndex = batches.findIndex((batch) => batch.id === batchId)
  if (batchIndex < 0) {
    return { ok: false, message: `没有找到编号为 ${batchId} 的重算批次` }
  }
  const batch = batches[batchIndex]
  if (batch.status === '已发布') {
    return { ok: true, message: `批次 ${batch.批次号} 已发布过，重复发布不再生效` }
  }
  const configs = ensureWarningConfigs()
  // 已发布过的「配置 + 版本」集合：跨批次也只生效一次。
  const publishedKeys = new Set(
    batches
      .filter((row) => row.status === '已发布')
      .flatMap((row) => row.items.filter((item) => item.status === '已发布'))
      .map((item) => `${item.configId}@${item.版本}`),
  )

  // 先在内存里算完全部副作用，再一次落库，保证整组要么都生效要么都不动。
  const moduleUpdates = new Map<string, EntryRow[]>()
  const reviewNotes: { 配置编号: string; 最高级别: WarningLevel; 命中数: number }[] = []
  const items = batch.items.map((item) => {
    if (item.status !== '待发布' || !item.结果) {
      return item
    }
    const key = `${item.configId}@${item.版本}`
    if (publishedKeys.has(key)) {
      return { ...item, status: '已跳过' as const, 备注: `配置 V${item.版本} 已由更早的批次发布，本次不重复生效` }
    }
    publishedKeys.add(key)
    const source = MONITOR_SOURCES[item.监测类型]
    const config = configs.find((row) => Number(row.id) === item.configId)
    if (source && config) {
      const rows = moduleUpdates.get(source.module) ?? listRows(source.module)
      moduleUpdates.set(
        source.module,
        rows.map((record) => {
          if (String(record['站点编号']) !== String(config['站点编号'])) {
            return record
          }
          const value = toNumber(record[source.valueField])
          if (value === null) {
            return record
          }
          const level = judgeLevel(value, item.阈值快照)
          return { ...record, 预警级别: level, abnormal: level === '橙色' || level === '红色' }
        }),
      )
    }
    const 命中数 = item.结果.橙色 + item.结果.红色
    if (命中数 > 0) {
      reviewNotes.push({ 配置编号: item.配置编号, 最高级别: item.结果.最高级别, 命中数 })
    }
    return { ...item, status: '已发布' as const }
  })

  const nextConfigs = configs.map((config) => {
    const published = items.some(
      (item) => item.status === '已发布' && item.configId === Number(config.id),
    )
    if (!published || String(config.status) === '已停用') {
      return config
    }
    return { ...config, status: '已生效', 生效状态: '已生效', pending: false }
  })

  for (const [module, rows] of moduleUpdates) {
    saveRows(module, rows)
  }
  saveRows(WARNING_KEY, nextConfigs)
  const next = [...batches]
  next[batchIndex] = { ...batch, items, status: '已发布', 发布人: operator, 发布时间: now() }
  writeDomain(BATCH_KEY, next)
  for (const note of reviewNotes) {
    createReviewItem({
      来源模块: '预警阈值',
      来源编号: note.配置编号,
      事项类型: '重算发布',
      内容: `批次 ${batch.批次号} 发布：配置 ${note.配置编号} 命中${note.最高级别}预警等 ${note.命中数} 次高等级预警，请复核`,
    })
  }
  const skipped = items.filter((item) => item.status === '已跳过').length
  const published = items.filter((item) => item.status === '已发布').length
  return {
    ok: true,
    message: `批次 ${batch.批次号} 已统一发布：${published} 条生效${skipped ? `，${skipped} 条重复版本已跳过` : ''}`,
  }
}
