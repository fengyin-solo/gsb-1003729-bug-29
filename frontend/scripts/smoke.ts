// 冒烟测试：绕开页面直接验证预警阈值领域服务的关键行为。
// 运行：npm run test:domain
import { runAction } from '@/api/local-service'
import { listReviewItems } from '@/api/review-service'
import {
  adjustThresholds,
  excludeRecalcItem,
  getRecalcBatch,
  listRecalcBatches,
  listWarningConfigs,
  publishRecalcBatch,
  submitRecalcBatch,
} from '@/api/warning-service'
import { listRows, saveRows } from '@/data/local-store'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`ok   ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

// 1. 存量缺阈值补数：老数据阈值是占位文本，读取时按监测类型补默认值并打标记
saveRows('warning', [
  ...listRows('warning'),
  {
    id: 9,
    status: '草稿',
    pending: true,
    abnormal: false,
    配置编号: 'WARN-0009',
    站点编号: 'STAT-0001',
    监测类型: '水位',
    蓝色阈值: '预警阈值样例9',
    黄色阈值: '预警阈值样例9',
    橙色阈值: '预警阈值样例9',
    红色阈值: '预警阈值样例9',
    生效状态: '未生效',
  },
])
const migrated = listWarningConfigs().find((row) => Number(row.id) === 9)
check('存量缺阈值按类型默认补数', migrated?.['蓝色阈值'] === 3.0 && migrated?.['红色阈值'] === 4.5, migrated)
check('补数行打标记且补版本', migrated?.['阈值补数'] === '是' && migrated?.['版本'] === 1)

// 2. 越权拒绝：访客不能重算/发布/调整
const denied = submitRecalcBatch([1], '访客甲', '访客')
check('访客批量重算被越权拒绝', !denied.ok && denied.message.includes('越权'), denied.message)
check('访客调整阈值被越权拒绝', !adjustThresholds(1, { 蓝色: 1, 黄色: 2, 橙色: 3, 红色: 4 }, '访客甲', '访客').ok)
check('复核员不能统一发布', (() => {
  const r = publishRecalcBatch(1, '复核员乙', '复核员')
  return !r.ok && r.message.includes('越权')
})())

// 3. 一次提交只形成一个批次，整组处理完进入待发布
const before = listRecalcBatches().length
const submit = submitRecalcBatch([1, 2, 3, 1], '值班管理员', '管理员') // 故意重复 id，应去重
check('一次提交只形成一个批次', listRecalcBatches().length === before + 1)
const batch = submit.batch!
check('勾选去重后三条配置', batch.items.length === 3, batch.items.length)
check('整组处理完即待发布', batch.status === '待发布' && batch.items.every((i) => i.status === '待发布'))
const item1 = batch.items.find((i) => i.configId === 1)!
check('按提交时快照判断（水位 V1：蓝1橙1）',
  item1.版本 === 1 && item1.结果?.蓝色 === 1 && item1.结果?.橙色 === 1 && item1.结果.最高级别 === '橙色',
  item1.结果)

// 4. 发布后旧批次快照不受新版本影响（逐条结果不与历史版本混）
check('阈值层级非法被拒绝', !adjustThresholds(1, { 蓝色: 5, 黄色: 2, 橙色: 3, 红色: 4 }, '值班管理员', '管理员').ok)
const adjusted = adjustThresholds(1, { 蓝色: 3.4, 黄色: 3.8, 橙色: 4.2, 红色: 4.6 }, '值班管理员', '管理员')
check('调整阈值生成新版本 V2', adjusted.ok && listWarningConfigs().find((r) => Number(r.id) === 1)?.['版本'] === 2)
const batch2 = submitRecalcBatch([1], '值班管理员', '管理员').batch!
check('新批次按新版本判断（V2：3.2 不再命中蓝色）',
  batch2.items[0].版本 === 2 && batch2.items[0].结果?.蓝色 === 0 && batch2.items[0].结果?.橙色 === 0,
  batch2.items[0].结果)
check('旧批次仍保留 V1 快照与结果',
  getRecalcBatch(batch.id)!.items.find((i) => i.configId === 1)!.阈值快照.蓝色 === 3.0)

// 5. 统一发布：跨模块写回 + 复核事项 + 幂等
const pub1 = publishRecalcBatch(batch.id, '值班管理员', '管理员')
check('统一发布成功', pub1.ok, pub1.message)
const wl = listRows('waterlevel')
check('跨模块写回预警级别（WATE-0002 橙色记异常）',
  wl.find((r) => r['记录编号'] === 'WATE-0002')?.['预警级别'] === '橙色' &&
  wl.find((r) => r['记录编号'] === 'WATE-0002')?.abnormal === true)
check('发布后配置转已生效', listWarningConfigs().find((r) => Number(r.id) === 2)?.status === '已生效')
const reviewsAfterPublish = listReviewItems().length
check('发布命中高等级预警生成复核事项', reviewsAfterPublish > 0, reviewsAfterPublish)
const pub2 = publishRecalcBatch(batch.id, '值班管理员', '管理员')
check('重复发布只生效一次', pub2.ok && pub2.message.includes('重复发布') && listReviewItems().length === reviewsAfterPublish)
const wlAfter = listRows('waterlevel')
check('重复发布无副作用', JSON.stringify(wlAfter) === JSON.stringify(wl))

// 6. 跨批次同版本去重：batch2（V2）发布后，再提交同版本批次应跳过
const pubBatch2 = publishRecalcBatch(batch2.id, '值班管理员', '管理员')
check('V2 批次发布成功', pubBatch2.ok, pubBatch2.message)
const batch3 = submitRecalcBatch([1], '值班管理员', '管理员').batch!
const pub3 = publishRecalcBatch(batch3.id, '值班管理员', '管理员')
check('同配置同版本跨批次只生效一次',
  pub3.ok && getRecalcBatch(batch3.id)!.items[0].status === '已跳过', pub3.message)

// 7. 失败配置单独退出：未接入的监测类型重算失败，退出后其余照常发布
adjustThresholds(3, { 蓝色: 25, 黄色: 45, 橙色: 65, 红色: 90 }, '值班管理员', '管理员') // 配置 3 升到 V3，避免与前面已发布版本撞车
saveRows('warning', [
  ...listRows('warning'),
  {
    id: 10, status: '草稿', pending: true, abnormal: false,
    配置编号: 'WARN-0010', 站点编号: 'STAT-0001', 监测类型: '水温',
    蓝色阈值: 1, 黄色阈值: 2, 橙色阈值: 3, 红色阈值: 4, 生效状态: '未生效', 版本: 1,
  },
])
const batch4 = submitRecalcBatch([3, 10], '值班管理员', '管理员').batch!
const failedItem = batch4.items.find((i) => i.configId === 10)!
check('未接入监测类型判失败', failedItem.status === '失败' && failedItem.失败原因.includes('未接入'), failedItem)
check('非失败条目不能退出', !excludeRecalcItem(batch4.id, batch4.items[0].id, '值班管理员', '管理员').ok)
check('失败配置可单独退出', excludeRecalcItem(batch4.id, failedItem.id, '值班管理员', '管理员').ok
  && getRecalcBatch(batch4.id)!.items.find((i) => i.id === failedItem.id)!.status === '已退出')
const pub4 = publishRecalcBatch(batch4.id, '值班管理员', '管理员')
check('退出后批次照常统一发布', pub4.ok
  && getRecalcBatch(batch4.id)!.items.find((i) => i.configId === 3)!.status === '已发布', pub4.message)
check('已发布批次不能再退出', !excludeRecalcItem(batch4.id, failedItem.id, '值班管理员', '管理员').ok)

// 8. 另一个复核入口生成事项：水质「发起复核」进统一收件箱
const before8 = listReviewItems().length
const reviewAction = runAction('waterquality', 1, '发起复核')
const newItems = listReviewItems().slice(before8)
check('水质发起复核生成复核事项', reviewAction.ok && newItems.length === 1
  && newItems[0].来源模块 === '水质检测' && newItems[0].状态 === '待复核', newItems)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
