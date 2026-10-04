import { defineStore } from 'pinia'

import type { Role } from '@/data/permissions'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '管理员' as Role,
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
    },
  },
})
