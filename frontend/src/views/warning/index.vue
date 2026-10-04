<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警阈值管理</h2>
        <p class="page-desc">
          维护预警阈值配置；勾选配置后一次提交只形成一个重算批次，整组处理完再统一发布，失败配置可单独退出。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!selectedIds.length" @click="submitRecalc">
          批量重算（已选 {{ selectedIds.length }} 条）
        </button>
        <button class="btn" type="button" @click="exportRows">导出预警阈值清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>版本</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <input
              type="checkbox"
              :checked="selectedIds.includes(Number(row.id))"
              :disabled="row.status === '已停用'"
              @change="toggleSelect(Number(row.id))"
            />
          </td>
          <td v-for="column in columns" :key="column">
            {{ row[column] ?? '—' }}
            <span v-if="column === '红色阈值' && row['阈值补数'] === '是'" class="tag">存量补数</span>
          </td>
          <td>V{{ row['版本'] ?? 1 }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openAdjust(row)">调整阈值</button>
            <button class="link" type="button" @click="runAction('停用配置', row)">停用配置</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无预警阈值数据</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">重算批次</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次号</th>
          <th>提交人</th>
          <th>提交时间</th>
          <th>配置数</th>
          <th>失败数</th>
          <th>状态</th>
          <th>发布人</th>
          <th>发布时间</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in batches" :key="batch.id">
          <td>{{ batch.批次号 }}</td>
          <td>{{ batch.提交人 }}</td>
          <td>{{ batch.提交时间 }}</td>
          <td>{{ batch.items.length }}</td>
          <td>{{ batch.items.filter((item) => item.status === '失败').length }}</td>
          <td>{{ batch.status }}</td>
          <td>{{ batch.发布人 || '—' }}</td>
          <td>{{ batch.发布时间 || '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="selectBatch(batch.id)">复核详情</button>
            <button
              v-if="batch.status === '待发布'"
              class="link"
              type="button"
              @click="publishBatch(batch.id)"
            >
              统一发布
            </button>
          </td>
        </tr>
        <tr v-if="!batches.length">
          <td colspan="9" class="empty-state">暂无重算批次，勾选配置后点击「批量重算」</td>
        </tr>
      </tbody>
    </table>

    <template v-if="activeBatch">
      <h3 class="section-title">
        复核详情：批次 {{ activeBatch.批次号 }}（{{ activeBatch.status }}）
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>配置编号</th>
            <th>站点编号</th>
            <th>监测类型</th>
            <th>版本</th>
            <th>阈值快照（蓝/黄/橙/红）</th>
            <th>重算结果</th>
            <th>状态</th>
            <th>失败原因 / 备注</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in activeBatch.items" :key="item.id">
            <td>{{ item.配置编号 }}</td>
            <td>{{ item.站点编号 }}</td>
            <td>{{ item.监测类型 }}</td>
            <td>V{{ item.版本 }}</td>
            <td>
              {{ item.阈值快照.蓝色 }} / {{ item.阈值快照.黄色 }} /
              {{ item.阈值快照.橙色 }} / {{ item.阈值快照.红色 }}
            </td>
            <td>
              <template v-if="item.结果">
                样本 {{ item.结果.样本数 }} 条，最高 {{ item.结果.最高级别 }}（蓝
                {{ item.结果.蓝色 }} / 黄 {{ item.结果.黄色 }} / 橙 {{ item.结果.橙色 }} / 红
                {{ item.结果.红色 }}）
              </template>
              <template v-else>—</template>
            </td>
            <td>{{ item.status }}</td>
            <td>{{ item.失败原因 || item.备注 || '—' }}</td>
            <td class="row-actions">
              <button
                v-if="item.status === '失败' && activeBatch.status === '待发布'"
                class="link"
                type="button"
                @click="excludeItem(item.id)"
              >
                退出批次
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <h3 class="section-title">复核事项</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>来源模块</th>
          <th>来源编号</th>
          <th>事项类型</th>
          <th>内容</th>
          <th>状态</th>
          <th>创建时间</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in reviewItems" :key="item.id">
          <td>{{ item.来源模块 }}</td>
          <td>{{ item.来源编号 }}</td>
          <td>{{ item.事项类型 }}</td>
          <td>{{ item.内容 }}</td>
          <td>{{ item.状态 }}</td>
          <td>{{ item.创建时间 }}</td>
          <td class="row-actions">
            <button
              v-if="item.状态 === '待复核'"
              class="link"
              type="button"
              @click="completeReview(item.id)"
            >
              办结
            </button>
          </td>
        </tr>
        <tr v-if="!reviewItems.length">
          <td colspan="7" class="empty-state">暂无复核事项，发布重算批次或从其他模块发起复核后生成</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条预警阈值记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <div v-if="adjustTarget" class="modal-mask" @click.self="adjustTarget = null">
      <form class="modal-card" @submit.prevent="submitAdjust">
        <h3>调整阈值：{{ adjustTarget['配置编号'] }}（当前 V{{ adjustTarget['版本'] ?? 1 }}）</h3>
        <label v-for="field in thresholdFields" :key="field.key" class="filter-item">
          <span>{{ field.label }}</span>
          <input v-model.number="adjustForm[field.key]" type="number" step="0.1" required />
        </label>
        <p class="page-desc">提交后生成新版本，之后的重算批次按新版本阈值判断，历史批次仍保留旧版本快照。</p>
        <div class="page-actions">
          <button class="btn primary" type="submit">生成新版本</button>
          <button class="btn ghost" type="button" @click="adjustTarget = null">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { completeReviewItem, listReviewItems } from '@/api/review-service'
import {
  adjustThresholds,
  excludeRecalcItem,
  getRecalcBatch,
  listRecalcBatches,
  listWarningConfigs,
  publishRecalcBatch,
  submitRecalcBatch,
} from '@/api/warning-service'
import type { EntryRow, RecalcBatch, ReviewItem, ThresholdSet } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('warning')
const store = useSessionStore()
const columns = ["配置编号", "站点编号", "监测类型", "蓝色阈值", "黄色阈值", "橙色阈值", "红色阈值", "生效状态"]
const statuses = ["草稿", "已生效", "已调整", "已停用"]
const thresholdFields = [
  { key: '蓝色', label: '蓝色阈值' },
  { key: '黄色', label: '黄色阈值' },
  { key: '橙色', label: '橙色阈值' },
  { key: '红色', label: '红色阈值' },
] as const

const rows = ref<EntryRow[]>([])
const total = ref(0)
const batches = ref<RecalcBatch[]>([])
const reviewItems = ref<ReviewItem[]>([])
const activeBatchId = ref<number | null>(null)
const selectedIds = ref<number[]>([])
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const adjustTarget = ref<EntryRow | null>(null)
const adjustForm = ref<ThresholdSet>({ 蓝色: 0, 黄色: 0, 橙色: 0, 红色: 0 })

const activeBatch = computed(() =>
  activeBatchId.value === null ? null : batches.value.find((batch) => batch.id === activeBatchId.value) ?? null,
)
const stats = computed(() => [
  { label: '配置总数', value: rows.value.length },
  { label: '已生效数', value: rows.value.filter((row) => String(row.status) === '已生效').length },
  { label: '重算批次数', value: batches.value.length },
  { label: '待复核事项', value: reviewItems.value.filter((item) => item.状态 === '待复核').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function notify(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
}

function toggleSelect(id: number) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : [...selectedIds.value, id]
}

function resetFilters() {
  filters.value = {}
  message.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  notify(applyAction(meta.key, Number(row.id), action))
  reload()
}

function openAdjust(row: EntryRow) {
  adjustTarget.value = row
  adjustForm.value = {
    蓝色: Number(row['蓝色阈值']) || 0,
    黄色: Number(row['黄色阈值']) || 0,
    橙色: Number(row['橙色阈值']) || 0,
    红色: Number(row['红色阈值']) || 0,
  }
}

function submitAdjust() {
  if (!adjustTarget.value) {
    return
  }
  const result = adjustThresholds(Number(adjustTarget.value.id), adjustForm.value, store.operator, store.role)
  notify(result)
  if (result.ok) {
    adjustTarget.value = null
    reload()
  }
}

function submitRecalc() {
  const result = submitRecalcBatch(selectedIds.value, store.operator, store.role)
  notify(result)
  if (result.batch) {
    selectedIds.value = []
    activeBatchId.value = result.batch.id
    reload()
  }
}

function selectBatch(id: number) {
  activeBatchId.value = id
}

function excludeItem(itemId: number) {
  if (activeBatchId.value === null) {
    return
  }
  notify(excludeRecalcItem(activeBatchId.value, itemId, store.operator, store.role))
  reload()
}

function publishBatch(id: number) {
  notify(publishRecalcBatch(id, store.operator, store.role))
  reload()
}

function completeReview(id: number) {
  notify(completeReviewItem(id, store.operator, store.role))
  reload()
}

function reload() {
  try {
    const all = listWarningConfigs()
    const matched = filterRows(all, filters.value)
    rows.value = matched
    total.value = matched.length
    batches.value = listRecalcBatches()
    reviewItems.value = listReviewItems()
    if (activeBatchId.value !== null && !getRecalcBatch(activeBatchId.value)) {
      activeBatchId.value = null
    }
  } catch (error) {
    notify({ ok: false, message: error instanceof Error ? error.message : '预警阈值列表读取失败' })
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title {
  margin: 16px 0 8px;
  font-size: 14px;
}
.tag {
  margin-left: 6px;
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  border-radius: 999px;
  padding: 1px 8px;
}
.ok-text {
  color: #15803d;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  width: 360px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-card h3 {
  margin: 0;
  font-size: 15px;
}
.modal-card input {
  width: 100%;
}
</style>
