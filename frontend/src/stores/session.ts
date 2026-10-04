import { defineStore } from 'pinia'

// 值班角色：仅管理员可写阈值配置/发布批次；复核员可走复核与办结事项；访客只读。
export type OperatorRole = 'admin' | 'reviewer' | 'viewer'

export const ROLE_LABELS: Record<OperatorRole, string> = {
  admin: '值班管理员',
  reviewer: '复核员',
  viewer: '访客（只读）',
}

export const ROLE_NAMES: Record<OperatorRole, string> = {
  admin: '张管理',
  reviewer: '李复核',
  viewer: '访客',
}

export const ROLE_ORDER: OperatorRole[] = ['admin', 'reviewer', 'viewer']

type SessionState = {
  role: OperatorRole
  shiftLabel: string
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    role: 'admin',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    operator(state): string {
      return ROLE_NAMES[state.role]
    },
    canOperate(): boolean {
      return this.role !== 'viewer'
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
    },
  },
})
