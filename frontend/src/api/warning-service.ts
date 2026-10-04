import { currentOperator, nowText, requireRole, type OperationResult } from '@/api/auth'
import {
  listBatches,
  listConfigs,
  listReviewItems,
  listUpstream,
  nextSequence,
  saveBatches,
  saveConfigs,
  saveReviewItems,
} from '@/data/warning/store'
import { BACKFILL_BASE, THRESHOLD_LADDER, UPSTREAM_VERSION } from '@/data/warning/seed'
import type {
  BatchItem,
  CandidateThresholds,
  ConfigStatus,
  MonitorType,
  RecalcBatch,
  ReviewItem,
  ThresholdSet,
  UpstreamObs,
  WarningConfig,
} from '@/data/warning/types'

/**
 * 预警阈值重算 / 复核 / 发布服务。
 *
 * 历史根因（版本 × 跨模块数据流）：
 * 1. 旧链路在每条配置的动作回调里各自计算，读取的是该条配置缓存中的历史阈值与旧版上游数据，
 *    多选提交后「多条新记录仍按旧版本判断」——批次开始时没有统一定格上游口径；
 * 2. 旧链路逐条算出即逐条发布并写入历史版本，导致复核详情里「逐条结果与历史版本混在一起」。
 *
 * 本服务的修复约束：
 * - 一次提交只形成一个处理批次（createRecalcBatch）：批次定格统一 sourceVersion 与上游快照；
 * - 候选阈值只暂存在批次内，配置版本在发布前完全不动，复核详情旧版本/新候选分区展示；
 * - 失败配置可单独退出（exitBatchItem），不阻断整组；
 * - 整组处理完统一发布（publishBatch）：一次原子落账，候选未变化不产生新版本；
 * - 重复发布只生效一次；越权写操作统一拒绝。
 */

const SELECTABLE_STATUS: ConfigStatus[] = ['草稿', '已生效', '已调整']

function activeVersion(config: WarningConfig) {
  return config.versions[config.versions.length - 1]
}

export function currentThresholds(config: WarningConfig): ThresholdSet {
  const version = activeVersion(config)
  return { blue: version.blue, yellow: version.yellow, orange: version.orange, red: version.red }
}

export function hasMissingThresholds(config: WarningConfig): boolean {
  const current = currentThresholds(config)
  return Object.values(current).some((value) => value === null)
}

export function isOrdered(set: ThresholdSet): boolean {
  const values = [set.blue, set.yellow, set.orange, set.red]
  if (values.some((value) => value === null)) {
    return false
  }
  const numbers = values as number[]
  return numbers[0] < numbers[1] && numbers[1] < numbers[2] && numbers[2] < numbers[3]
}

function sameSet(a: ThresholdSet, b: ThresholdSet): boolean {
  return a.blue === b.blue && a.yellow === b.yellow && a.orange === b.orange && a.red === b.red
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 按监测类型的阶梯口径，从上游观测值推导各级候选阈值。 */
function deriveCandidate(type: MonitorType, value: number): CandidateThresholds {
  const ladder = THRESHOLD_LADDER[type]
  const levelIndex = Math.max(0, Math.floor((value - 0.0001) / ladder.step))
  const blueBase = ladder.step * levelIndex
  return {
    blue: round1(blueBase + ladder.step * ladder.offsets.blue),
    yellow: round1(blueBase + ladder.step * ladder.offsets.yellow),
    orange: round1(blueBase + ladder.step * ladder.offsets.orange),
    red: round1(blueBase + ladder.step * ladder.offsets.red),
    changed: false,
  }
}

function findUpstream(
  upstream: UpstreamObs[],
  config: WarningConfig,
): UpstreamObs | undefined {
  return upstream.find(
    (item) =>
      item.stationCode === config.stationCode && item.monitorType === config.monitorType,
  )
}

function buildBatchItem(config: WarningConfig, upstream: UpstreamObs[]): BatchItem {
  const version = activeVersion(config)
  const fromThresholds = currentThresholds(config)
  const obs = findUpstream(upstream, config)

  const base: BatchItem = {
    configId: config.id,
    code: config.code,
    stationCode: config.stationCode,
    stationName: config.stationName,
    monitorType: config.monitorType,
    fromVersion: version.version,
    fromThresholds,
    upstream: obs
      ? {
          sourceModule: obs.sourceModule,
          value: obs.value,
          observedAt: obs.observedAt,
          status: obs.status,
          dataVersion: obs.dataVersion,
        }
      : {
          sourceModule: '—',
          value: null,
          observedAt: '—',
          status: '缺失' as const,
          dataVersion: UPSTREAM_VERSION,
        },
    candidate: null,
    result: 'failed',
    failReason: '未找到匹配的跨模块上游观测数据',
  }

  if (!obs) {
    return base
  }
  if (obs.status !== '正常' || obs.value === null) {
    return { ...base, failReason: `上游${obs.sourceModule}观测${obs.status}，无法重算` }
  }

  const candidate = deriveCandidate(config.monitorType, obs.value)
  if (!isOrdered(candidate)) {
    return { ...base, failReason: '候选阈值不满足蓝<黄<橙<红的递增规则' }
  }
  return {
    ...base,
    candidate: { ...candidate, changed: !sameSet(candidate, fromThresholds) },
    result: 'success',
    failReason: undefined,
  }
}

export type BatchCreateSummary = {
  batchNo: string
  total: number
  success: number
  failed: number
}

/**
 * 一次提交只形成一个处理批次：
 * 统一定格上游口径版本，逐条只做暂存计算，不触碰任何配置版本。
 */
export function createRecalcBatch(configIds: number[]): OperationResult<BatchCreateSummary> {
  const guard = requireRole('admin', '批量重算')
  if (!guard.ok) {
    return guard
  }
  const ids = [...new Set(configIds)]
  if (ids.length === 0) {
    return { ok: false, message: '请至少勾选一条预警阈值配置' }
  }

  const configs = listConfigs()
  const targets = configs.filter(
    (config) =>
      ids.includes(config.id) && SELECTABLE_STATUS.includes(config.status),
  )
  if (targets.length !== ids.length) {
    return {
      ok: false,
      message: '勾选的配置中包含已停用或不存在的记录，请刷新后重试',
    }
  }

  // 已在「待复核 / 复核通过」批次中的配置禁止重复进入，避免新旧批次交叉发布。
  const openBatchConfigIds = new Set(
    listBatches()
      .filter((batch) => batch.status !== '已发布')
      .flatMap((batch) =>
        batch.items.filter((item) => item.result !== 'exited').map((item) => item.configId),
      ),
  )
  const occupied = targets.filter((config) => openBatchConfigIds.has(config.id))
  if (occupied.length > 0) {
    return {
      ok: false,
      message: `配置 ${occupied.map((item) => item.code).join('、')} 已在未发布批次中，不能重复提交`,
    }
  }

  const upstream = listUpstream()
  const items = targets.map((config) => buildBatchItem(config, upstream))
  const seq = nextSequence('batch')
  const batchNo = `RC-20261004-${String(seq).padStart(3, '0')}`
  const batch: RecalcBatch = {
    id: seq,
    batchNo,
    createdAt: nowText(),
    createdBy: currentOperator(),
    sourceVersion: UPSTREAM_VERSION,
    status: '待复核',
    items,
  }
  saveBatches([...listBatches(), batch])

  return {
    ok: true,
    message: `已形成处理批次 ${batchNo}，共 ${items.length} 条，待统一复核发布`,
    data: {
      batchNo,
      total: items.length,
      success: items.filter((item) => item.result === 'success').length,
      failed: items.filter((item) => item.result === 'failed').length,
    },
  }
}

export function getBatch(batchNo: string): RecalcBatch | undefined {
  return listBatches().find((batch) => batch.batchNo === batchNo)
}

/** 失败配置单独退出批次；退出后整组可继续发布。 */
export function exitBatchItem(
  batchNo: string,
  configId: number,
): OperationResult {
  const guard = requireRole('reviewer', '失败项退出')
  if (!guard.ok) {
    return guard
  }
  const batches = listBatches()
  const batch = batches.find((item) => item.batchNo === batchNo)
  if (!batch) {
    return { ok: false, message: '没有找到该处理批次' }
  }
  if (batch.status === '已发布') {
    return { ok: false, message: '批次已发布，不能再退出条目' }
  }
  const item = batch.items.find((entry) => entry.configId === configId)
  if (!item) {
    return { ok: false, message: '批次中没有该配置' }
  }
  if (item.result !== 'failed') {
    return { ok: false, message: '只有重算失败的配置可以单独退出批次' }
  }
  item.result = 'exited'
  item.exitedBy = currentOperator()
  item.exitedAt = nowText()
  saveBatches(batches.map((entry) => (entry.batchNo === batchNo ? batch : entry)))
  return { ok: true, message: `配置 ${item.code} 已退出批次，保留原阈值版本不动` }
}

export function reviewBatch(batchNo: string): OperationResult {
  const guard = requireRole('reviewer', '复核通过')
  if (!guard.ok) {
    return guard
  }
  const batches = listBatches()
  const batch = batches.find((item) => item.batchNo === batchNo)
  if (!batch) {
    return { ok: false, message: '没有找到该处理批次' }
  }
  if (batch.status === '已发布') {
    return { ok: false, message: '批次已发布，复核动作不重复生效' }
  }
  const unresolvedFailed = batch.items.filter((item) => item.result === 'failed')
  if (unresolvedFailed.length > 0) {
    return {
      ok: false,
      message: `仍有 ${unresolvedFailed.length} 条失败配置未退出，请先处理失败项`,
    }
  }
  batch.status = '复核通过'
  batch.reviewedBy = currentOperator()
  batch.reviewedAt = nowText()
  saveBatches(batches.map((entry) => (entry.batchNo === batchNo ? batch : entry)))
  return { ok: true, message: `批次 ${batchNo} 复核通过，等待管理员统一发布` }
}

/**
 * 整组处理完再统一发布：一次原子落账。
 * - 仅复核通过批次可发布；重复发布只生效一次；
 * - 候选与当前版本一致的条目不产生新版本（幂等），变化的条目统一追加新版本并置「已调整」；
 * - 退出条目不参与，原配置原版本保留。
 */
export function publishBatch(batchNo: string): OperationResult {
  const guard = requireRole('admin', '批次发布')
  if (!guard.ok) {
    return guard
  }
  const batches = listBatches()
  const batchIndex = batches.findIndex((item) => item.batchNo === batchNo)
  if (batchIndex < 0) {
    return { ok: false, message: '没有找到该处理批次' }
  }
  const batch = batches[batchIndex]
  if (batch.status === '已发布') {
    return { ok: false, message: `批次 ${batchNo} 已发布，重复发布只生效一次` }
  }
  if (batch.status !== '复核通过') {
    return { ok: false, message: '批次须复核通过后才能统一发布' }
  }

  const configs = listConfigs()
  const publishedAt = nowText()
  const applied: string[] = []
  const unchanged: string[] = []

  for (const item of batch.items) {
    if (item.result === 'exited' || !item.candidate) {
      continue
    }
    const configIndex = configs.findIndex((config) => config.id === item.configId)
    if (configIndex < 0) {
      continue
    }
    const config = configs[configIndex]
    const present = currentThresholds(config)
    // 发布前再比对一次当前版本，防止批次处理期间配置被他人改动。
    if (
      present.blue !== item.fromThresholds.blue ||
      present.yellow !== item.fromThresholds.yellow ||
      present.orange !== item.fromThresholds.orange ||
      present.red !== item.fromThresholds.red
    ) {
      return {
        ok: false,
        message: `配置 ${item.code} 在批次处理期间已被修改，发布已中止，请重新重算`,
      }
    }

    if (!item.candidate.changed) {
      unchanged.push(item.code)
      continue
    }

    const nextVersion = activeVersion(config).version + 1
    config.versions = [
      ...config.versions,
      {
        version: nextVersion,
        blue: item.candidate.blue,
        yellow: item.candidate.yellow,
        orange: item.candidate.orange,
        red: item.candidate.red,
        source: 'batch-recalc',
        sourceVersion: batch.sourceVersion,
        reason: `批次 ${batch.batchNo} 统一重算发布`,
        batchNo: batch.batchNo,
        createdAt: publishedAt,
        effectiveAt: publishedAt,
      },
    ]
    config.status = '已调整'
    applied.push(item.code)
    configs[configIndex] = config
  }

  // 全部条目处理完成后一次性提交，形成一个发布动作而不是逐条发布。
  const publishedBatch: RecalcBatch = {
    ...batch,
    status: '已发布',
    publishedBy: currentOperator(),
    publishedAt,
  }
  batches[batchIndex] = publishedBatch
  saveConfigs(configs)
  saveBatches(batches)

  return {
    ok: true,
    message:
      `批次 ${batchNo} 已统一发布：${applied.length} 条形成新版本` +
      (unchanged.length > 0 ? `，${unchanged.length} 条候选无变化未产生新版本` : ''),
  }
}

export type BackfillSummary = { codes: string[]; count: number }

/**
 * 存量缺阈值补数：按监测类型统一基线，仅补空值、不覆盖既有阈值。
 * 补数以「新版本」留痕，source=system-backfill，可在版本记录中审计。
 */
export function backfillMissingThresholds(): OperationResult<BackfillSummary> {
  const guard = requireRole('admin', '缺阈值补数')
  if (!guard.ok) {
    return guard
  }
  const configs = listConfigs()
  const stamped = nowText()
  const codes: string[] = []

  const nextConfigs = configs.map((config) => {
    if (!hasMissingThresholds(config)) {
      return config
    }
    const current = currentThresholds(config)
    const base = BACKFILL_BASE[config.monitorType]
    const filled: ThresholdSet = {
      blue: current.blue ?? base.blue,
      yellow: current.yellow ?? base.yellow,
      orange: current.orange ?? base.orange,
      red: current.red ?? base.red,
    }
    if (!isOrdered(filled)) {
      return config
    }
    codes.push(config.code)
    const last = activeVersion(config)
    return {
      ...config,
      versions: [
        ...config.versions,
        {
          version: last.version + 1,
          ...filled,
          source: 'system-backfill' as const,
          sourceVersion: last.sourceVersion,
          reason: '存量缺阈值系统补数（仅补空值，不覆盖原值）',
          createdAt: stamped,
          effectiveAt: config.status === '草稿' ? undefined : stamped,
        },
      ],
    }
  })

  if (codes.length === 0) {
    return { ok: true, message: '没有需要补数的存量配置', data: { codes: [], count: 0 } }
  }
  saveConfigs(nextConfigs)
  return {
    ok: true,
    message: `已按统一基线为 ${codes.length} 条存量配置补齐阈值：${codes.join('、')}`,
    data: { codes, count: codes.length },
  }
}

export function updateThresholds(
  configId: number,
  next: ThresholdSet,
): OperationResult {
  const guard = requireRole('admin', '调整阈值')
  if (!guard.ok) {
    return guard
  }
  if (!isOrdered(next)) {
    return { ok: false, message: '阈值必须满足 蓝 < 黄 < 橙 < 红 且不能为空' }
  }
  const configs = listConfigs()
  const index = configs.findIndex((config) => config.id === configId)
  if (index < 0) {
    return { ok: false, message: '没有找到该预警阈值配置' }
  }
  const config = configs[index]
  if (config.status === '已停用') {
    return { ok: false, message: '已停用配置不能调整，请先重新发布' }
  }
  const present = currentThresholds(config)
  if (sameSet(present, next)) {
    return { ok: false, message: '阈值与当前版本一致，无需调整' }
  }
  const stamped = nowText()
  const last = activeVersion(config)
  const updated: WarningConfig = {
    ...config,
    status: '已调整',
    versions: [
      ...config.versions,
      {
        version: last.version + 1,
        ...next,
        source: 'manual',
        sourceVersion: last.sourceVersion,
        reason: '人工调整阈值',
        createdAt: stamped,
        effectiveAt: stamped,
      },
    ],
  }
  configs[index] = updated
  saveConfigs(configs)
  return { ok: true, message: `配置 ${config.code} 已调整为新版本 v${last.version + 1}` }
}

export function publishConfig(configId: number): OperationResult {
  const guard = requireRole('admin', '发布生效')
  if (!guard.ok) {
    return guard
  }
  const configs = listConfigs()
  const index = configs.findIndex((config) => config.id === configId)
  if (index < 0) {
    return { ok: false, message: '没有找到该预警阈值配置' }
  }
  const config = configs[index]
  // 重复发布只生效一次：已生效/已调整且当前版本已生效的配置直接拒绝。
  if (config.status === '已生效') {
    return { ok: false, message: `配置 ${config.code} 当前版本已生效，重复发布只生效一次` }
  }
  if (config.status === '已停用') {
    return { ok: false, message: '已停用配置不支持直接发布，请重新登记' }
  }
  if (hasMissingThresholds(config)) {
    return { ok: false, message: '配置存在缺失阈值，请先执行存量补数' }
  }
  const stamped = nowText()
  const last = activeVersion(config)
  const versions =
    last.effectiveAt === undefined
      ? [
          ...config.versions.slice(0, -1),
          { ...last, effectiveAt: stamped },
        ]
      : config.versions
  const updated: WarningConfig = { ...config, status: '已生效', versions }
  configs[index] = updated
  saveConfigs(configs)
  return { ok: true, message: `配置 ${config.code} 已发布生效（v${last.version}）` }
}

export function disableConfig(configId: number): OperationResult {
  const guard = requireRole('admin', '停用配置')
  if (!guard.ok) {
    return guard
  }
  const configs = listConfigs()
  const index = configs.findIndex((config) => config.id === configId)
  if (index < 0) {
    return { ok: false, message: '没有找到该预警阈值配置' }
  }
  const config = configs[index]
  if (config.status === '已停用') {
    return { ok: false, message: '配置已是停用状态，无需重复操作' }
  }
  configs[index] = { ...config, status: '已停用' }
  saveConfigs(configs)
  return { ok: true, message: `配置 ${config.code} 已停用，后续重算批次不再纳入` }
}

/**
 * 另一个复核入口：水质检测「发起复核」生成事项。
 * 同一来源单据重复发起只保留一条待办（幂等），办结后可重新发起。
 */
export function createWaterQualityReview(
  sourceId: string,
  title: string,
  detail: string,
): OperationResult {
  const guard = requireRole('reviewer', '发起复核')
  if (!guard.ok) {
    return guard
  }
  const items = listReviewItems()
  const duplicate = items.some(
    (item) => item.sourceModule === '水质检测复核' && item.sourceId === sourceId && item.status === '待处理',
  )
  if (duplicate) {
    return { ok: false, message: `报告 ${sourceId} 的复核事项已存在，请勿重复发起` }
  }
  const item: ReviewItem = {
    id: nextSequence('review-item'),
    sourceModule: '水质检测复核',
    sourceId,
    title,
    detail,
    status: '待处理',
    createdAt: nowText(),
    createdBy: currentOperator(),
  }
  saveReviewItems([...items, item])
  return { ok: true, message: `已生成水质复核事项（报告 ${sourceId}），可在复核事项中心处理` }
}

export function closeReviewItem(itemId: number): OperationResult {
  const guard = requireRole('reviewer', '办结事项')
  if (!guard.ok) {
    return guard
  }
  const items = listReviewItems()
  const index = items.findIndex((item) => item.id === itemId)
  if (index < 0) {
    return { ok: false, message: '没有找到该复核事项' }
  }
  if (items[index].status === '已办结') {
    return { ok: false, message: '事项已办结，操作不重复生效' }
  }
  items[index] = {
    ...items[index],
    status: '已办结',
    closedBy: currentOperator(),
    closedAt: nowText(),
  }
  saveReviewItems(items)
  return { ok: true, message: '复核事项已办结' }
}
