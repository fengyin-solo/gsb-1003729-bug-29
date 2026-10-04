import type { MonitorType, RecalcBatch, ReviewItem, ThresholdSet, UpstreamObs, WarningConfig } from './types'

/**
 * 预警阈值存量数据与跨模块上游观测种子。
 * 上游观测汇总自「水位监测 / 流量监测 / 雨量观测」三个业务模块，
 * 每条携带 dataVersion，重算批次以它作为统一定格口径。
 */

export const THRESHOLD_LADDER: Record<
  MonitorType,
  { step: number; offsets: { blue: number; yellow: number; orange: number; red: number } }
> = {
  水位: { step: 0.5, offsets: { blue: 0, yellow: 1, orange: 2, red: 3 } },
  流量: { step: 200, offsets: { blue: 0, yellow: 1, orange: 2, red: 3 } },
  雨量: { step: 10, offsets: { blue: 0, yellow: 1, orange: 2, red: 3 } },
}

/** 监测类型缺阈值补数默认基线（存量缺阈值由系统按统一基线补数，不覆盖已有值）。 */
export const BACKFILL_BASE: Record<MonitorType, ThresholdSet> = {
  水位: { blue: 2.0, yellow: 2.5, orange: 3.0, red: 3.5 },
  流量: { blue: 800, yellow: 1000, orange: 1200, red: 1400 },
  雨量: { blue: 40, yellow: 50, orange: 60, red: 70 },
}

export const UPSTREAM_VERSION = 'v2'

export const SEED_UPSTREAM: UpstreamObs[] = [
  {
    stationCode: 'STAT-0001',
    stationName: '一号水文站',
    monitorType: '水位',
    sourceModule: '水位监测',
    value: 3.1,
    observedAt: '2026-10-04 08:00',
    status: '正常',
    dataVersion: 'v2',
  },
  {
    stationCode: 'STAT-0002',
    stationName: '二号水文站',
    monitorType: '水位',
    sourceModule: '水位监测',
    value: 3.6,
    observedAt: '2026-10-04 08:00',
    status: '正常',
    dataVersion: 'v2',
  },
  {
    stationCode: 'STAT-0003',
    stationName: '三号水文站',
    monitorType: '水位',
    sourceModule: '水位监测',
    value: null,
    observedAt: '2026-10-04 08:00',
    status: '异常',
    dataVersion: 'v2',
  },
  {
    stationCode: 'STAT-0005',
    stationName: '五号水文站',
    monitorType: '水位',
    sourceModule: '水位监测',
    value: 2.1,
    observedAt: '2026-10-04 08:00',
    status: '正常',
    dataVersion: 'v2',
  },
  {
    stationCode: 'STAT-0004',
    stationName: '四号水文站',
    monitorType: '流量',
    sourceModule: '流量监测',
    value: 1320,
    observedAt: '2026-10-04 08:00',
    status: '正常',
    dataVersion: 'v2',
  },
  {
    stationCode: 'STAT-0006',
    stationName: '六号雨量站',
    monitorType: '雨量',
    sourceModule: '雨量观测',
    value: 55,
    observedAt: '2026-10-04 08:00',
    status: '正常',
    dataVersion: 'v2',
  },
]

export const SEED_WARNING_CONFIGS: WarningConfig[] = [
  {
    id: 1,
    code: 'WARN-0001',
    stationCode: 'STAT-0001',
    stationName: '一号水文站',
    monitorType: '水位',
    status: '已生效',
    versions: [
      {
        version: 1,
        blue: 2.0,
        yellow: 2.5,
        orange: 3.0,
        red: 3.5,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记',
        createdAt: '2026-09-01 09:00',
        effectiveAt: '2026-09-01 09:00',
      },
    ],
  },
  {
    id: 2,
    code: 'WARN-0002',
    stationCode: 'STAT-0002',
    stationName: '二号水文站',
    monitorType: '水位',
    status: '已生效',
    versions: [
      {
        version: 1,
        blue: 2.0,
        yellow: 2.5,
        orange: 3.0,
        red: 3.5,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记',
        createdAt: '2026-09-01 09:00',
        effectiveAt: '2026-09-01 09:00',
      },
      {
        version: 2,
        blue: 2.5,
        yellow: 3.0,
        orange: 3.5,
        red: 4.0,
        source: 'manual',
        sourceVersion: 'v1',
        reason: '人工调整',
        createdAt: '2026-09-12 14:00',
        effectiveAt: '2026-09-12 14:00',
      },
    ],
  },
  {
    // 上游观测异常：重算时该条单独失败，可在批次中单独退出，不阻断整组发布。
    id: 3,
    code: 'WARN-0003',
    stationCode: 'STAT-0003',
    stationName: '三号水文站',
    monitorType: '水位',
    status: '已生效',
    versions: [
      {
        version: 1,
        blue: 2.0,
        yellow: 2.5,
        orange: 3.0,
        red: 3.5,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记',
        createdAt: '2026-09-01 09:00',
        effectiveAt: '2026-09-01 09:00',
      },
    ],
  },
  {
    id: 4,
    code: 'WARN-0004',
    stationCode: 'STAT-0004',
    stationName: '四号水文站',
    monitorType: '流量',
    status: '已调整',
    versions: [
      {
        version: 1,
        blue: 600,
        yellow: 800,
        orange: 1000,
        red: 1200,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记',
        createdAt: '2026-09-01 09:00',
        effectiveAt: '2026-09-01 09:00',
      },
      {
        version: 2,
        blue: 800,
        yellow: 1000,
        orange: 1200,
        red: 1400,
        source: 'manual',
        sourceVersion: 'v1',
        reason: '人工调整',
        createdAt: '2026-09-15 10:00',
        effectiveAt: '2026-09-15 10:00',
      },
    ],
  },
  {
    // 存量缺阈值（橙、红缺失）：发布重算前会由系统统一基线补数。
    id: 5,
    code: 'WARN-0005',
    stationCode: 'STAT-0005',
    stationName: '五号水文站',
    monitorType: '水位',
    status: '草稿',
    versions: [
      {
        version: 1,
        blue: 2.0,
        yellow: 2.5,
        orange: null,
        red: null,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记（存量缺阈值）',
        createdAt: '2026-09-02 09:00',
      },
    ],
  },
  {
    id: 6,
    code: 'WARN-0006',
    stationCode: 'STAT-0006',
    stationName: '六号雨量站',
    monitorType: '雨量',
    status: '已停用',
    versions: [
      {
        version: 1,
        blue: 40,
        yellow: 50,
        orange: 60,
        red: 70,
        source: 'seed',
        sourceVersion: 'v1',
        reason: '初始登记',
        createdAt: '2026-09-01 09:00',
      },
    ],
  },
]

export const SEED_BATCHES: RecalcBatch[] = []

export const SEED_REVIEW_ITEMS: ReviewItem[] = []
