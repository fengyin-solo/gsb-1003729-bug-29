import { readDomain, writeDomain } from '@/data/local-store'
import { hasPermission, permissionLabel } from '@/data/permissions'
import type { ActionResult, ReviewItem } from '@/data/types'

// 复核事项收件箱：任何模块的复核入口都往这里写，预警阈值页统一展示与办结。
const REVIEW_KEY = 'reviewItems'

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export function listReviewItems(): ReviewItem[] {
  return readDomain<ReviewItem[]>(REVIEW_KEY, [])
}

export function createReviewItem(input: {
  来源模块: string
  来源编号: string
  事项类型: string
  内容: string
}): ReviewItem {
  const items = listReviewItems()
  const item: ReviewItem = {
    id: items.reduce((max, row) => Math.max(max, row.id), 0) + 1,
    来源模块: input.来源模块,
    来源编号: input.来源编号,
    事项类型: input.事项类型,
    内容: input.内容,
    状态: '待复核',
    创建时间: now(),
    办结人: '',
    办结时间: '',
  }
  writeDomain(REVIEW_KEY, [...items, item])
  return item
}

export function completeReviewItem(id: number, operator: string, role: string): ActionResult {
  if (!hasPermission(role, 'review:handle')) {
    return { ok: false, message: `越权操作已拒绝：角色「${role}」没有「${permissionLabel('review:handle')}」权限` }
  }
  const items = listReviewItems()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的复核事项` }
  }
  if (items[index].状态 === '已复核') {
    return { ok: false, message: '该复核事项已办结，不用重复操作' }
  }
  const next = [...items]
  next[index] = { ...items[index], 状态: '已复核', 办结人: operator, 办结时间: now() }
  writeDomain(REVIEW_KEY, next)
  return { ok: true, message: `复核事项 #${id} 已办结` }
}
