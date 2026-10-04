/**
 * 预警阈值领域模型：配置版本、跨模块上游观测、重算批次、复核事项。
 * 关键点：阈值以「版本」为单位追加，重算只产生暂存候选，统一发布时才落新版本。
 */

export type MonitorType = '水位' | '流量' | '雨量'

export type ConfigStatus = '草稿' | '已生效' | '已调整' | '已停用'

export type ThresholdSource = 'seed' | 'manual' | 'system-backfill' | 'batch-recalc'

export type ThresholdSet = {
  blue: number | null
  yellow: number | null
  orange: number | null
  red: number | null
}

export type ThresholdVersion = ThresholdSet & {
  version: number
  source: ThresholdSource
  /** 该版本计算所依据的上游数据口径版本，旧存量为 v1。 */
  sourceVersion: string
  reason: string
  batchNo?: string
  createdAt: string
  effectiveAt?: string
}

export type WarningConfig = {
  id: number
  /** 配置编号 */
  code: string
  stationCode: string
  stationName: string
  monitorType: MonitorType
  status: ConfigStatus
  /** 历史版本按时间追加，最后一条即当前生效版本。 */
  versions: ThresholdVersion[]
}

export type ObsStatus = '正常' | '异常' | '缺失'

/** 跨模块上游观测：水位监测 / 流量监测 / 雨量观测汇总到同一口径下。 */
export type UpstreamObs = {
  stationCode: string
  stationName: string
  monitorType: MonitorType
  /** 来源业务模块（跨模块数据流追踪用） */
  sourceModule: string
  value: number | null
  observedAt: string
  status: ObsStatus
  dataVersion: string
}

export type ItemResult = 'success' | 'failed' | 'exited'

export type CandidateThresholds = ThresholdSet & {
  /** 候选阈值与当前版本是否一致；一致则发布时不产生新版本。 */
  changed: boolean
}

export type BatchItem = {
  configId: number
  code: string
  stationCode: string
  stationName: string
  monitorType: MonitorType
  /** 批次定格时该配置的版本号与旧阈值，复核详情中与候选严格分区展示。 */
  fromVersion: number
  fromThresholds: ThresholdSet
  upstream: {
    sourceModule: string
    value: number | null
    observedAt: string
    status: ObsStatus
    dataVersion: string
  }
  candidate: CandidateThresholds | null
  result: ItemResult
  failReason?: string
  exitedBy?: string
  exitedAt?: string
}

export type BatchStatus = '待复核' | '复核通过' | '已发布'

export type RecalcBatch = {
  id: number
  batchNo: string
  createdAt: string
  createdBy: string
  /** 整组统一的上游数据口径版本，批次内所有条目共用。 */
  sourceVersion: string
  status: BatchStatus
  reviewedBy?: string
  reviewedAt?: string
  publishedBy?: string
  publishedAt?: string
  items: BatchItem[]
}

export type ReviewItemStatus = '待处理' | '已办结'

/** 复核事项：由「另一个复核入口」（水质检测-发起复核）生成。 */
export type ReviewItem = {
  id: number
  sourceModule: '水质检测复核'
  /** 来源单据编号，用于幂等去重 */
  sourceId: string
  title: string
  detail: string
  status: ReviewItemStatus
  createdAt: string
  createdBy: string
  closedBy?: string
  closedAt?: string
}
