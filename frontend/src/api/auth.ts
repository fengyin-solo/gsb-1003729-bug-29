import { useSessionStore, type OperatorRole } from '@/stores/session'

export type OperationResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
}

/** 固定的失败结果类型，可赋给任意 OperationResult&lt;T&gt;（不含 data）。 */
export type FailureResult = { ok: false; message: string }

export function currentRole(): OperatorRole {
  return useSessionStore().role
}

export function currentOperator(): string {
  return useSessionStore().operator
}

export function roleAtLeast(role: OperatorRole, min: OperatorRole): boolean {
  const order: OperatorRole[] = ['admin', 'reviewer', 'viewer']
  return order.indexOf(role) <= order.indexOf(min)
}

/** 越权修改统一拒绝：所有写操作入口先过这道闸。 */
export function requireRole(min: OperatorRole, action: string): FailureResult | { ok: true; message: string } {
  const role = currentRole()
  if (roleAtLeast(role, min)) {
    return { ok: true, message: '' }
  }
  const roleText: Record<OperatorRole, string> = {
    admin: '值班管理员',
    reviewer: '复核员',
    viewer: '访客',
  }
  return {
    ok: false,
    message: `越权操作已拒绝：当前身份「${roleText[role]}」无权执行「${action}」，需要${roleText[min]}及以上权限`,
  }
}

export function nowText(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
