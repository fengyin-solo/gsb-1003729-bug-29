// 节点侧逻辑校验：mock 浏览器 localStorage 后直接驱动领域服务，验证关键约束。
// 运行：node --loader tsx ./scripts/verify-warning.ts（本脚本用 esbuild 内联转译）
const esbuild = require('esbuild')
const { createPinia, setActivePinia } = require('pinia')
const path = require('node:path')
const Module = require('node:module')

const storage = {}
global.window = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v) },
    removeItem: (k) => { delete storage[k] },
  },
}

const root = path.join(__dirname, '..', 'src')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === '@/stores/session') request = path.join(root, 'stores/session.ts')
  else if (request === '@/api/auth') request = path.join(root, 'api/auth.ts')
  else if (request.startsWith('@/data/warning/')) request = path.join(root, request.slice(2))
  return originalResolve.call(this, request, ...args)
}

const tsCache = new Map()
const tsModules = new Map()
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  let filename
  if (request.startsWith('@/')) {
    filename = path.join(root, request.slice(2))
    if (!filename.endsWith('.ts')) filename += '.ts'
  } else if (request.endsWith('.ts') && path.isAbsolute(request)) {
    filename = request
  } else if (parent && parent.filename.endsWith('.ts') && (request.startsWith('./') || request.startsWith('../'))) {
    filename = path.resolve(path.dirname(parent.filename), request)
    if (!require('node:fs').existsSync(filename) && require('node:fs').existsSync(filename + '.ts')) {
      filename += '.ts'
    }
  }
  if (filename && filename.endsWith('.ts')) {
    // 同一绝对路径必须返回同一个模块实例，否则 store 的内存缓存会分裂。
    if (tsModules.has(filename)) {
      return tsModules.get(filename).exports
    }
    if (!tsCache.has(filename)) {
      const src = require('node:fs').readFileSync(filename, 'utf8')
      const out = esbuild.buildSync({
        stdin: { contents: src, loader: 'ts', sourcefile: filename },
        bundle: false,
        write: false,
        format: 'cjs',
      })
      // esbuild sync build returns outputFiles
      const compiled = out.outputFiles ? out.outputFiles[0].text : out.code
      tsCache.set(filename, compiled)
    }
    const m = new Module(filename, parent)
    m.filename = filename
    m.paths = Module._nodeModulePaths(path.dirname(filename))
    tsModules.set(filename, m)
    m._compile(tsCache.get(filename), filename)
    return m.exports
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { useSessionStore } = require(path.join(root, 'stores/session.ts'))
const svc = require(path.join(root, 'api/warning-service.ts'))
const store = require(path.join(root, 'data/warning/store.ts'))

setActivePinia(createPinia())
const session = useSessionStore()

let failures = 0
function assert(cond, text) {
  if (cond) {
    console.log(`  ✓ ${text}`)
  } else {
    failures += 1
    console.error(`  ✗ ${text}`)
  }
}

// 1. 越权：访客不能重算/补数/发布
session.setRole('viewer')
const denied = svc.createRecalcBatch([1, 2])
assert(!denied.ok && denied.message.includes('越权'), '访客批量重算被拒绝（越权修改拒绝）')
assert(!svc.backfillMissingThresholds().ok, '访客补数被拒绝')

// 2. 补数（管理员）：WARN-0005 缺橙/红阈值 -> 补新版本，只补空值
session.setRole('admin')
let configs = store.listConfigs()
const w5before = configs.find((c) => c.code === 'WARN-0005').versions.length
const bf = svc.backfillMissingThresholds()
assert(bf.ok && bf.data.codes.includes('WARN-0005'), '缺阈值存量 WARN-0005 被补数')
configs = store.listConfigs()
const w5 = configs.find((c) => c.code === 'WARN-0005')
assert(w5.versions.length === w5before + 1, '补数追加版本而非覆盖')
assert(w5.versions.at(-1).source === 'system-backfill', '补数版本标记 system-backfill')
assert(w5.versions.at(-1).blue === 2.0 && w5.versions.at(-1).orange === 3.0, '补数保留已有蓝值、补全空橙值')
assert(svc.backfillMissingThresholds().message.includes('没有需要补数'), '再次补数为空操作')

// 3. 一次提交一个批次（勾选 1,2,3,5；3 上游异常失败；6 停用不可选）
const created = svc.createRecalcBatch([1, 2, 3, 5])
assert(created.ok, `批次创建成功：${created.message}`)
const batchNo = created.data.batchNo
let batch = store.listBatches().find((b) => b.batchNo === batchNo)
assert(batch.items.length === 4, '一个批次包含全部 4 条勾选（一次提交一个批次）')
assert(batch.sourceVersion === 'v2', '批次定格统一口径版本 v2')
const i1 = batch.items.find((i) => i.code === 'WARN-0001')
const i2 = batch.items.find((i) => i.code === 'WARN-0002')
const i3 = batch.items.find((i) => i.code === 'WARN-0003')
assert(i1.candidate && i1.candidate.blue === 3.0 && i1.candidate.changed, 'WARN-0001 用新口径算出 3.0（不是旧版本 2.0）')
assert(i2.candidate.blue === 3.5 && i2.candidate.changed, 'WARN-0002 新口径候选 3.5（多版本配置不再按旧版本判断）')
assert(i3.result === 'failed' && i3.candidate === null, 'WARN-0003 上游异常 => 单条失败，不产生候选')
// 配置版本在发布前完全没动
const stillV1 = store.listConfigs().find((c) => c.code === 'WARN-0001').versions.at(-1)
assert(stillV1.version === 1 && stillV1.source !== 'batch-recalc', '发布前配置版本未被批次污染')

// 4. 重复提交被拦截
assert(!svc.createRecalcBatch([1]).ok, '配置已在开放批次中，重复提交拒绝')

// 5. 复核前必须处理失败项；复核员可操作
session.setRole('reviewer')
assert(!svc.reviewBatch(batchNo).ok, '失败项未退出时复核通过被拒绝')
const exited = svc.exitBatchItem(batchNo, 3)
assert(exited.ok, '失败配置可单独退出批次')
assert(svc.exitBatchItem(batchNo, 1).message.includes('只有重算失败'), '成功项不能退出')
const reviewed = svc.reviewBatch(batchNo)
assert(reviewed.ok, '失败清零后复核通过')

// 6. 复核员不能发布（越权），管理员统一发布
const pubDenied = svc.publishBatch(batchNo)
assert(!pubDenied.ok && pubDenied.message.includes('越权'), '复核员统一发布被拒绝')
session.setRole('admin')
const pub = svc.publishBatch(batchNo)
assert(pub.ok, `整组统一发布成功：${pub.message}`)
configs = store.listConfigs()
const c1 = configs.find((c) => c.code === 'WARN-0001')
assert(c1.versions.at(-1).version === 2 && c1.versions.at(-1).source === 'batch-recalc', 'WARN-0001 追加批次新版本 v2')
const c2 = configs.find((c) => c.code === 'WARN-0002')
assert(c2.versions.at(-1).version === 3, 'WARN-0002 在 v2 基础上追加 v3')
const c3 = configs.find((c) => c.code === 'WARN-0003')
assert(c3.versions.length === 1, '退出的 WARN-0003 未产生新版本')
batch = store.listBatches().find((b) => b.batchNo === batchNo)
assert(batch.status === '已发布' && batch.publishedBy === '张管理', '批次记录唯一发布人与时间')

// 7. 重复发布只生效一次
const pubAgain = svc.publishBatch(batchNo)
assert(!pubAgain.ok && pubAgain.message.includes('重复发布只生效一次'), '重复发布被拒绝')
assert(store.listConfigs().find((c) => c.code === 'WARN-0001').versions.length === 2, '重复发布没有再加版本')

// 8. 候选无变化不产生新版本：选 WARN-0005（当前 2.0/2.5/3.0/3.5，观测 2.1 → 候选 2.0.. 一致）
const created2 = svc.createRecalcBatch([5])
const b2 = created2.data.batchNo
svc.exitBatchItem // noop reference
const batch2 = store.listBatches().find((b) => b.batchNo === b2)
const i5 = batch2.items[0]
assert(i5.candidate && i5.candidate.blue === 2.0 && !i5.candidate.changed, 'WARN-0005 候选与当前版本一致')
assert(svc.reviewBatch(b2).ok, '批次2复核通过（复核员）')
assert(svc.publishBatch(b2).ok, '批次2发布成功')
assert(store.listConfigs().find((c) => c.code === 'WARN-0005').versions.at(-1).source === 'system-backfill', '候选无变化不产生新版本')
assert(!svc.publishBatch(b2).ok, '批次2重复发布同样拒绝')

// 9. 另一个复核入口：水质发起复核生成事项，重复发起幂等
session.setRole('reviewer')
const r1 = svc.createWaterQualityReview('WATE-0002', '水质报告 WATE-0002 复核', '明细')
assert(r1.ok, '水质复核入口生成事项')
const r2 = svc.createWaterQualityReview('WATE-0002', '重复', '明细')
assert(!r2.ok && r2.message.includes('已存在'), '同一报告重复发起不生成第二条待办')
const items = store.listReviewItems()
assert(items.filter((i) => i.sourceId === 'WATE-0002' && i.status === '待处理').length === 1, '待办事项仅一条')
const close = svc.closeReviewItem(items[0].id)
assert(close.ok, '复核事项可办结')
assert(!svc.closeReviewItem(items[0].id).ok, '重复办结拒绝')
const r3 = svc.createWaterQualityReview('WATE-0002', '办结后再发起', '明细')
assert(r3.ok, '办结后同一报告可重新发起')

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 条失败`)
process.exit(failures === 0 ? 0 : 1)
