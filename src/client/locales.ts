export const en = {
  title: 'CodeArts', intro: 'Use Huawei Cloud CodeArts models in DeepSeek Harness.',
  accounts: 'Accounts', add: 'Add account', edit: 'Edit', remove: 'Remove', confirmRemove: 'Remove this account and its saved credentials?',
  select: 'Use account', selected: 'Selected', noAccount: 'Add an AK/SK account to discover its models.', choose: 'Select an account to use its models.',
  name: 'Account name', ak: 'Access Key (AK)', sk: 'Secret Key (SK)', keep: 'Leave empty to keep the saved value',
  save: 'Save account', cancel: 'Cancel', loading: 'Loading…', working: 'Working…', retry: 'Reload',
  refresh: 'Refresh models', models: 'Models', noModels: 'No available models discovered.',
  context: 'Context', output: 'Max output', images: 'Images', text: 'Text', cached: 'Last successful refresh',
  updated: 'Saved', modelHint: 'The upstream determines access and availability. Missing capacity metadata is reported below.',
  credentialsHint: 'AK/SK are saved in the Harness credential store. Only the final four AK characters are displayed.',
  switchHint: 'New requests follow the selected account. Requests already generating keep their original account.',
  manage: 'Manage accounts in Settings → CodeArts.', modelCount: 'Available models',
} as const

export type CopyKey = keyof typeof en
export type Translate = (key: CopyKey, params?: Record<string, unknown>) => string

export const zh: Record<CopyKey, string> = {
  title: 'CodeArts', intro: '在 DeepSeek Harness 中使用华为云 CodeArts 模型。',
  accounts: '账号', add: '添加账号', edit: '编辑', remove: '删除', confirmRemove: '删除这个账号及已保存的凭据？',
  select: '使用此账号', selected: '当前账号', noAccount: '添加 AK/SK 账号后即可发现模型。', choose: '请选择一个账号以使用其模型。',
  name: '账号名称', ak: 'Access Key（AK）', sk: 'Secret Key（SK）', keep: '留空保留已保存的值',
  save: '保存账号', cancel: '取消', loading: '加载中…', working: '处理中…', retry: '重新加载',
  refresh: '刷新模型', models: '模型', noModels: '尚未发现可用模型。',
  context: '上下文', output: '最大输出', images: '图片', text: '文本', cached: '最近成功刷新',
  updated: '已保存', modelHint: '模型权限和可用性由上游决定，缺失容量信息的模型会在下方说明。',
  credentialsHint: 'AK/SK 保存于 Harness 凭据存储，仅展示 AK 末四位。',
  switchHint: '新请求使用当前账号，正在生成的请求继续使用原账号。',
  manage: '请在设置 → CodeArts 中管理账号。', modelCount: '可用模型',
}
