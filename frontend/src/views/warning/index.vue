<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警阈值管理</h2>
        <p class="page-desc">
          维护预警阈值配置。批量重算以统一上游口径一次形成一个处理批次，候选阈值整组处理完复核通过后统一发布。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="!canAdmin" @click="runBackfill">
          存量缺阈值补数
        </button>
        <RouterLink class="btn ghost" to="/warning/review-center">复核事项中心</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="batch-bar">
      <label class="batch-check">
        <input type="checkbox" :checked="allSelected" @change="toggleAll" />
        全选可重算配置（{{ selectableRows.length }}）
      </label>
      <span class="batch-count">已选 {{ selectedIds.length }} 条</span>
      <button
        class="btn primary"
        type="button"
        :disabled="!canAdmin || selectedIds.length === 0"
        @click="submitBatch"
      >
        批量重算（一次提交一个批次）
      </button>
      <span v-if="!canAdmin" class="hint-text">仅值班管理员可发起重算与写操作</span>
    </div>

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>配置编号</span>
        <input v-model="filters.code" placeholder="按配置编号检索" />
      </label>
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="filters.station" placeholder="按站点编号检索" />
      </label>
      <label class="filter-item">
        <span>监测类型</span>
        <select v-model="filters.type">
          <option value="">全部</option>
          <option value="水位">水位</option>
          <option value="流量">流量</option>
          <option value="雨量">雨量</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前版本</th>
          <th>缺阈值</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.config.id">
          <td>
            <input
              v-if="selectableIds.has(row.config.id)"
              type="checkbox"
              :value="row.config.id"
              v-model="selectedIds"
            />
            <span v-else title="已停用配置不纳入重算">—</span>
          </td>
          <td>{{ row.config.code }}</td>
          <td>{{ row.config.stationCode }} {{ row.config.stationName }}</td>
          <td>{{ row.config.monitorType }}</td>
          <td :class="{ 'missing-cell': row.current.blue === null }">{{ formatValue(row.current.blue) }}</td>
          <td :class="{ 'missing-cell': row.current.yellow === null }">{{ formatValue(row.current.yellow) }}</td>
          <td :class="{ 'missing-cell': row.current.orange === null }">{{ formatValue(row.current.orange) }}</td>
          <td :class="{ 'missing-cell': row.current.red === null }">{{ formatValue(row.current.red) }}</td>
          <td>{{ row.config.status }}</td>
          <td>v{{ row.current.version }}（{{ row.current.sourceVersion }}）</td>
          <td>
            <span v-if="row.missing" class="tag tag-warn">缺阈值</span>
            <span v-else class="tag tag-ok">完整</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" :disabled="!canAdmin" @click="openAdjust(row.config)">
              调整阈值
            </button>
            <button
              v-if="row.config.status !== '已生效' && row.config.status !== '已停用'"
              class="link"
              type="button"
              :disabled="!canAdmin"
              @click="publishOne(row.config.id)"
            >
              发布生效
            </button>
            <button
              v-if="row.config.status !== '已停用'"
              class="link danger"
              type="button"
              :disabled="!canAdmin"
              @click="disableOne(row.config.id)"
            >
              停用配置
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无匹配的预警阈值配置</td>
        </tr>
      </tbody>
    </table>

    <section class="version-panel">
      <h3>最近重算批次</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>创建时间</th>
            <th>创建人</th>
            <th>上游口径</th>
            <th>成功/失败/退出</th>
            <th>批次状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in recentBatches" :key="batch.batchNo">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.createdAt }}</td>
            <td>{{ batch.createdBy }}</td>
            <td>{{ batch.sourceVersion }}</td>
            <td>
              {{ countByResult(batch, 'success') }} /
              {{ countByResult(batch, 'failed') }} /
              {{ countByResult(batch, 'exited') }}
            </td>
            <td>
              <span class="tag" :class="batchStatusTag(batch.status)">{{ batch.status }}</span>
            </td>
            <td>
              <RouterLink class="link" :to="`/warning/batch/${batch.batchNo}`">查看复核详情</RouterLink>
            </td>
          </tr>
          <tr v-if="!recentBatches.length">
            <td colspan="7" class="empty-state">还没有重算批次</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="adjustTarget" class="modal-mask" @click.self="closeAdjust">
      <div class="modal">
        <h3>调整阈值 · {{ adjustTarget.code }}</h3>
        <p class="hint-text">{{ adjustTarget.stationName }} · {{ adjustTarget.monitorType }}，需满足 蓝 &lt; 黄 &lt; 橙 &lt; 红</p>
        <div class="modal-grid">
          <label v-for="level in levels" :key="level.key">
            <span>{{ level.label }}</span>
            <input v-model.number="adjustForm[level.key]" type="number" step="0.1" />
          </label>
        </div>
        <p v-if="adjustError" class="error-text">{{ adjustError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeAdjust">取消</button>
          <button class="btn primary" type="button" @click="confirmAdjust">保存为新版本</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条预警阈值配置 · 数据保存在本机浏览器</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { useSessionStore } from '@/stores/session'
import { listBatches, listConfigs } from '@/data/warning/store'
import {
  backfillMissingThresholds,
  createRecalcBatch,
  currentThresholds,
  disableConfig,
  hasMissingThresholds,
  publishConfig,
  updateThresholds,
} from '@/api/warning-service'
import type {
  BatchStatus,
  ItemResult,
  MonitorType,
  RecalcBatch,
  ThresholdSet,
  WarningConfig,
} from '@/data/warning/types'

const session = useSessionStore()
const canAdmin = computed(() => session.role === 'admin')

const columns = ['配置编号', '站点', '监测类型', '蓝色阈值', '黄色阈值', '橙色阈值', '红色阈值', '生效状态']
const levels = [
  { key: 'blue', label: '蓝色阈值' },
  { key: 'yellow', label: '黄色阈值' },
  { key: 'orange', label: '橙色阈值' },
  { key: 'red', label: '红色阈值' },
] as const

type RowView = {
  config: WarningConfig
  current: WarningConfig['versions'][number]
  missing: boolean
}

const allConfigs = ref<WarningConfig[]>([])
const batches = ref<RecalcBatch[]>([])
const selectedIds = ref<number[]>([])
const message = ref('')
const messageOk = ref(false)
const filters = reactive({ code: '', station: '', type: '' })

const rows = computed<RowView[]>(() => {
  const code = filters.code.trim()
  const station = filters.station.trim()
  return allConfigs.value
    .filter((config) => (code ? config.code.includes(code) : true))
    .filter((config) =>
      station ? config.stationCode.includes(station) || config.stationName.includes(station) : true,
    )
    .filter((config) => (filters.type ? config.monitorType === (filters.type as MonitorType) : true))
    .map((config) => {
      const current = config.versions[config.versions.length - 1]
      return { config, current, missing: hasMissingThresholds(config) }
    })
})

const selectableRows = computed(() => rows.value.filter((row) => row.config.status !== '已停用'))
const selectableIds = computed(() => new Set(selectableRows.value.map((row) => row.config.id)))
const allSelected = computed(
  () =>
    selectableRows.value.length > 0 &&
    selectableRows.value.every((row) => selectedIds.value.includes(row.config.id)),
)

const stats = computed(() => [
  { label: '配置总数', value: allConfigs.value.length },
  {
    label: '已生效/调整',
    value: allConfigs.value.filter((item) => item.status === '已生效' || item.status === '已调整').length,
  },
  { label: '缺阈值存量', value: allConfigs.value.filter((item) => hasMissingThresholds(item)).length },
  {
    label: '待复核批次',
    value: batches.value.filter((item) => item.status !== '已发布').length,
  },
])

const recentBatches = computed(() => [...batches.value].sort((a, b) => b.id - a.id).slice(0, 10))

function formatValue(value: number | null): string {
  return value === null ? '缺失' : String(value)
}

function toggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  selectedIds.value = checked ? selectableRows.value.map((row) => row.config.id) : []
}

function countByResult(batch: RecalcBatch, result: ItemResult): number {
  return batch.items.filter((item) => item.result === result).length
}

function batchStatusTag(status: BatchStatus): string {
  if (status === '已发布') return 'tag-ok'
  if (status === '复核通过') return 'tag-info'
  return 'tag-warn'
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function submitBatch() {
  const result = createRecalcBatch(selectedIds.value)
  if (!result.ok) {
    notify(false, result.message)
    return
  }
  selectedIds.value = []
  notify(true, result.message)
  reload()
}

function runBackfill() {
  const result = backfillMissingThresholds()
  notify(result.ok, result.message)
  reload()
}

function publishOne(id: number) {
  const result = publishConfig(id)
  notify(result.ok, result.message)
  reload()
}

function disableOne(id: number) {
  const result = disableConfig(id)
  notify(result.ok, result.message)
  reload()
}

const adjustTarget = ref<WarningConfig | null>(null)
const adjustForm = reactive<ThresholdSet>({ blue: null, yellow: null, orange: null, red: null })
const adjustError = ref('')

function openAdjust(config: WarningConfig) {
  const current = currentThresholds(config)
  adjustTarget.value = config
  adjustForm.blue = current.blue
  adjustForm.yellow = current.yellow
  adjustForm.orange = current.orange
  adjustForm.red = current.red
  adjustError.value = ''
}

function closeAdjust() {
  adjustTarget.value = null
}

function confirmAdjust() {
  if (!adjustTarget.value) {
    return
  }
  const result = updateThresholds(adjustTarget.value.id, { ...adjustForm })
  if (!result.ok) {
    adjustError.value = result.message
    return
  }
  closeAdjust()
  notify(true, result.message)
  reload()
}

function resetFilters() {
  filters.code = ''
  filters.station = ''
  filters.type = ''
}

function reload() {
  allConfigs.value = listConfigs()
  batches.value = listBatches()
  // 清理已不可选的勾选（如停用）
  selectedIds.value = selectedIds.value.filter((id) => selectableIds.value.has(id))
}

onMounted(reload)
</script>
