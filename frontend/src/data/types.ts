/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ---- 预警阈值批量重算的领域类型 ----

/** 四级阈值快照：提交批次时从配置当前版本截取，重算只认这份快照。 */
export type ThresholdSet = {
  蓝色: number
  黄色: number
  橙色: number
  红色: number
}

export type WarningLevel = '无预警' | '蓝色' | '黄色' | '橙色' | '红色'

/** 单条配置在一个批次里的重算结果：按级别统计命中数，结果只挂在本批次本版本下。 */
export type RecalcResult = {
  样本数: number
  无预警: number
  蓝色: number
  黄色: number
  橙色: number
  红色: number
  最高级别: WarningLevel
}

export type RecalcItemStatus = '待发布' | '失败' | '已退出' | '已发布' | '已跳过'

export type RecalcItem = {
  id: number
  configId: number
  配置编号: string
  站点编号: string
  监测类型: string
  /** 提交时配置所在的版本：复核详情按它区分新旧结果，不与历史版本混排。 */
  版本: number
  阈值快照: ThresholdSet
  status: RecalcItemStatus
  失败原因: string
  结果: RecalcResult | null
  备注: string
}

export type RecalcBatchStatus = '待发布' | '已发布'

export type RecalcBatch = {
  id: number
  批次号: string
  提交人: string
  提交时间: string
  status: RecalcBatchStatus
  发布人: string
  发布时间: string
  items: RecalcItem[]
}

/** 复核事项：各复核入口（批量重算发布、水质发起复核等）统一往这个收件箱里写。 */
export type ReviewItem = {
  id: number
  来源模块: string
  来源编号: string
  事项类型: string
  内容: string
  状态: '待复核' | '已复核'
  创建时间: string
  办结人: string
  办结时间: string
}

export type BatchSubmitResult = ActionResult & { batch: RecalcBatch | null }
