<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>复核事项中心</h2>
        <p class="page-desc">
          汇总跨模块复核入口产生的事项：水质检测「发起复核」在此生成待办；预警阈值重算批次在此进入复核详情。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/warning">返回阈值列表</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待处理水质复核事项</span>
        <strong class="stat-value">{{ pendingItems.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">待复核重算批次</span>
        <strong class="stat-value">{{ openBatches.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已办结事项</span>
        <strong class="stat-value">{{ closedItems.length }}</strong>
      </article>
    </div>

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

    <section class="version-panel">
      <h3>水质检测复核事项（由「水质检测 → 发起复核」生成）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>事项编号</th>
            <th>来源报告</th>
            <th>事项</th>
            <th>明细</th>
            <th>发起人 / 时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>RV-{{ String(item.id).padStart(4, '0') }}</td>
            <td>{{ item.sourceId }}</td>
            <td>{{ item.title }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.createdBy }} · {{ item.createdAt }}</td>
            <td>
              <span class="tag" :class="item.status === '待处理' ? 'tag-warn' : 'tag-muted'">
                {{ item.status }}
              </span>
              <div v-if="item.closedBy" class="hint-text">{{ item.closedBy }} · {{ item.closedAt }}</div>
            </td>
            <td>
              <button
                v-if="item.status === '待处理'"
                class="link"
                type="button"
                :disabled="!canReview"
                @click="closeItem(item.id)"
              >
                办结
              </button>
              <span v-else class="hint-text">已处理</span>
            </td>
          </tr>
          <tr v-if="!items.length">
            <td colspan="7" class="empty-state">暂无水质复核事项，可在水质检测页对报告「发起复核」</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="version-panel">
      <h3>预警阈值重算批次（整组复核，统一发布）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>提交时间 / 人</th>
            <th>口径版本</th>
            <th>成功 / 失败 / 退出</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.batchNo">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.createdAt }} · {{ batch.createdBy }}</td>
            <td>{{ batch.sourceVersion }}</td>
            <td>
              {{ batch.items.filter((i) => i.result === 'success').length }} /
              {{ batch.items.filter((i) => i.result === 'failed').length }} /
              {{ batch.items.filter((i) => i.result === 'exited').length }}
            </td>
            <td><span class="tag" :class="batchStatusTag(batch.status)">{{ batch.status }}</span></td>
            <td>
              <RouterLink class="link" :to="`/warning/batch/${batch.batchNo}`">进入复核详情</RouterLink>
            </td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="6" class="empty-state">暂无重算批次</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { closeReviewItem } from '@/api/warning-service'
import { listBatches, listReviewItems } from '@/data/warning/store'
import type { BatchStatus, ReviewItem } from '@/data/warning/types'

const session = useSessionStore()
const canReview = computed(() => session.role === 'admin' || session.role === 'reviewer')

const items = ref<ReviewItem[]>([])
const batches = ref(listBatches())
const message = ref('')
const messageOk = ref(false)

const pendingItems = computed(() => items.value.filter((item) => item.status === '待处理'))
const closedItems = computed(() => items.value.filter((item) => item.status === '已办结'))
const openBatches = computed(() => batches.value.filter((batch) => batch.status !== '已发布'))

function batchStatusTag(status: BatchStatus): string {
  if (status === '已发布') return 'tag-ok'
  if (status === '复核通过') return 'tag-info'
  return 'tag-warn'
}

function closeItem(id: number) {
  const result = closeReviewItem(id)
  messageOk.value = result.ok
  message.value = result.message
  reload()
}

function reload() {
  items.value = listReviewItems()
  batches.value = listBatches()
}

onMounted(reload)
</script>
