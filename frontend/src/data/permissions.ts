// 角色与权限：服务层每次写操作前都过一遍 hasPermission，越权直接拒绝。
export const ROLES = ['管理员', '复核员', '访客'] as const

export type Role = (typeof ROLES)[number]

export const PERMISSION_LABELS: Record<string, string> = {
  'warning:adjust': '调整阈值',
  'warning:recalc': '批量重算',
  'warning:exclude': '失败配置退出',
  'warning:publish': '统一发布',
  'review:handle': '复核事项办结',
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  管理员: ['warning:adjust', 'warning:recalc', 'warning:exclude', 'warning:publish', 'review:handle'],
  复核员: ['warning:recalc', 'warning:exclude', 'review:handle'],
  访客: [],
}

export function hasPermission(role: string, permission: string): boolean {
  return (ROLE_PERMISSIONS[role as Role] ?? []).includes(permission)
}

export function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? permission
}
