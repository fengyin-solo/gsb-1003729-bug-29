<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>批次复核详情 · {{ batch?.batchNo ?? '未找到批次' }}</h2>
        <p class="page-desc">
          一次提交只形成一个处理批次：复核详情左侧固定展示提交时定格的旧版本，右侧展示统一口径下的暂存候选，二者不混排。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/warning">返回阈值列表</RouterLink>
      </div>
    </header>

    <template v-if="batch">
      <div class="batch-meta">
        <span>批次号：<strong>{{ batch.batchNo }}</strong></span>
        <span>创建：{{ batch.createdAt }} · {{ batch.createdBy }}</span>
        <span>统一上游口径：<strong>{{ batch.sourceVersion }}</strong></span>
        <span>状态：<span class="tag" :class="statusTag">{{ batch.status }}</span></span>
        <span v-if="batch.reviewedBy">复核：{{ batch.reviewedBy }} · {{ batch.reviewedAt }}</span>
        <span v-if="batch.publishedBy">发布：{{ batch.publishedBy }} · {{ batch.publishedAt }}</span>
      </div>

      <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

      <div class="batch-actions">
        <button
          class="btn"
          type="button"
          :disabled="!canReview || batch.status !== '待复核' || failedCount === 0"
          @click="message = '请在失败条目上逐条退出，避免误退成功项'"
        >
          失败项需逐条退出（{{ failedCount }}）
        </button>
        <button
          class="btn"
          type="button"
          :disabled="!canReview || batch.status !== '待复核' || failedCount > 0"
          @click="passReview"
        >
          复核通过（失败项清零后）
        </button>
        <button
          class="btn primary"
          type="button"
          :disabled="!canAdmin || batch.status !== '复核通过'"
          @click="publishAll"
        >
          统一发布（整组一次生效）
        </button>
        <span v-if="!canAdmin" class="hint-text">发布仅值班管理员可执行</span>
      </div>

      <table class="data-table batch-table">
        <thead>
          <tr>
            <th>配置 / 站点 / 类型</th>
            <th class="group-old">提交时旧版本（定格）</th>
            <th class="group-new">本次暂存候选（{{ batch.sourceVersion }} 口径）</th>
            <th>结论</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in batch.items" :key="item.configId" :class="`row-${item.result}`">
            <td>
              <div><strong>{{ item.code }}</strong></div>
              <div class="hint-text">{{ item.stationCode }} {{ item.stationName }} · {{ item.monitorType }}</div>
            </td>
            <td class="group-old">
              <div class="threshold-line">
                <span>蓝 {{ fmt(item.fromThresholds.blue) }}</span>
                <span>黄 {{ fmt(item.fromThresholds.yellow) }}</span>
                <span>橙 {{ fmt(item.fromThresholds.orange) }}</span>
                <span>红 {{ fmt(item.fromThresholds.red) }}</span>
              </div>
              <div class="hint-text">v{{ item.fromVersion }}</div>
            </td>
            <td class="group-new">
              <template v-if="item.candidate">
                <div class="threshold-line">
                  <span>蓝 {{ fmt(item.candidate.blue) }}</span>
                  <span>黄 {{ fmt(item.candidate.yellow) }}</span>
                  <span>橙 {{ fmt(item.candidate.orange) }}</span>
                  <span>红 {{ fmt(item.candidate.red) }}</span>
                </div>
                <span class="tag" :class="item.candidate.changed ? 'tag-info' : 'tag-muted'">
                  {{ item.candidate.changed ? '相对旧版本有变化' : '与旧版本一致（发布不产生新版本）' }}
                </span>
              </template>
              <template v-else>
                <span class="error-text">未形成候选：{{ item.failReason }}</span>
              </template>
              <div class="hint-text upstream-line">
                上游 {{ item.upstream.sourceModule }} ·
                值 {{ item.upstream.value === null ? '—' : item.upstream.value }} ·
                {{ item.upstream.status }} · {{ item.upstream.observedAt }} ·
                数据版本 {{ item.upstream.dataVersion }}
              </div>
            </td>
            <td>
              <span class="tag" :class="resultTag(item.result)">{{ resultLabel(item.result) }}</span>
              <div v-if="item.exitedBy" class="hint-text">{{ item.exitedBy }} 于 {{ item.exitedAt }} 退出</div>
            </td>
            <td>
              <button
                v-if="item.result === 'failed' && batch.status === '待复核'"
                class="link danger"
                type="button"
                :disabled="!canReview"
                @click="exitItem(item.configId)"
              >
                失败项单独退出
              </button>
              <span v-else class="hint-text">—</span>
            </td>
          </tr>
        </tbody>
      </table>

      <section class="version-panel">
        <h3>发布后版本预演（仅展示，发布时才真正落账）</h3>
        <ul class="preview-list">
          <li v-for="item in previewLines" :key="item.code">
            {{ item.code }}：{{ item.text }}
          </li>
        </ul>
      </section>
    </template>

    <p v-else class="error-text">没有找到该批次，可能批次号有误，请返回列表重新进入。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import { getBatch, exitBatchItem, reviewBatch, publishBatch } from '@/api/warning-service'
import type { ItemResult } from '@/data/warning/types'

const route = useRoute()
const session = useSessionStore()
const canAdmin = computed(() => session.role === 'admin')
const canReview = computed(() => session.role === 'admin' || session.role === 'reviewer')

const batchNo = String(route.params.batchNo)
// 详情页持有批次的工作副本，操作后整体刷新。
const batch = ref(getBatch(batchNo))

const message = ref('')
const messageOk = ref(false)

const failedCount = computed(
  () => batch.value?.items.filter((item) => item.result === 'failed').length ?? 0,
)

const statusTag = computed(() => {
  if (batch.value?.status === '已发布') return 'tag-ok'
  if (batch.value?.status === '复核通过') return 'tag-info'
  return 'tag-warn'
})

const previewLines = computed(() => {
  if (!batch.value) {
    return []
  }
  return batch.value.items.map((item) => {
    if (item.result === 'exited') {
      return { code: item.code, text: '已退出批次，配置保留旧版本不动' }
    }
    if (!item.candidate) {
      return { code: item.code, text: '无候选（不会进入发布）' }
    }
    if (!item.candidate.changed) {
      return {
        code: item.code,
        text: `候选与 v${item.fromVersion} 一致，发布时不产生新版本`,
      }
    }
    return {
      code: item.code,
      text: `v${item.fromVersion} → v${item.fromVersion + 1}，蓝/黄/橙/红 = ${item.candidate.blue}/${item.candidate.yellow}/${item.candidate.orange}/${item.candidate.red}`,
    }
  })
})

function fmt(value: number | null): string {
  return value === null ? '缺失' : String(value)
}

function resultLabel(result: ItemResult): string {
  if (result === 'success') return '重算成功'
  if (result === 'failed') return '重算失败'
  return '已退出'
}

function resultTag(result: ItemResult): string {
  if (result === 'success') return 'tag-ok'
  if (result === 'failed') return 'tag-warn'
  return 'tag-muted'
}

function refresh() {
  batch.value = getBatch(batchNo)
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function exitItem(configId: number) {
  const result = exitBatchItem(batchNo, configId)
  notify(result.ok, result.message)
  refresh()
}

function passReview() {
  const result = reviewBatch(batchNo)
  notify(result.ok, result.message)
  refresh()
}

function publishAll() {
  const result = publishBatch(batchNo)
  notify(result.ok, result.message)
  refresh()
}
</script>
