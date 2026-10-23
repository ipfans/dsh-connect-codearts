export const en = {
  title: 'CodeArts', intro: 'Use Huawei Cloud CodeArts models in DeepSeek Harness.',
  accounts: 'Accounts', add: 'Sign in with Huawei Cloud', edit: 'Rename', remove: 'Remove', confirmRemove: 'Remove this account and its saved credentials?',
  select: 'Use account', selected: 'Selected', noAccount: 'Sign in with Huawei Cloud to discover your models.', choose: 'Select a signed-in account to use its models.',
  name: 'Account name',
  save: 'Save name', cancel: 'Cancel', loading: 'Loading…', working: 'Working…', retry: 'Reload',
  refresh: 'Refresh account and models', models: 'Models', noModels: 'No available models discovered.',
  context: 'Context', output: 'Max output', images: 'Images', text: 'Text', cached: 'Last successful refresh',
  updated: 'Saved', modelHint: 'The upstream determines access and availability. Missing capacity metadata is reported below.',
  credentialsHint: 'Sign in in your browser. Renewable OAuth credentials stay in the Harness credential store.',
  switchHint: 'New requests follow the selected account. Requests already generating keep their original account.',
  manage: 'Manage accounts in Settings → CodeArts.', modelCount: 'Available models',
  relogin: 'Sign in again', ready: 'Signed in', legacy: 'This account needs OAuth login after upgrading to 0.2.0.', loginRequired: 'Authorization expired. Sign in again.',
  loginPending: 'Open the Huawei Cloud login page to continue. This login expires after 15 minutes.', openLogin: 'Open Huawei Cloud login', cancelLogin: 'Cancel login', loginComplete: 'Login completed.',
  subscription: 'Plan and credits', remaining: 'Remaining', total: 'Total', used: 'Used', expiring: 'Expiring credits', periodEnd: 'Current period ends', unknown: 'Not available',
  basic: 'Plan credits', ondemand: 'Credit packs', bonus: 'Promotional credits', normal: 'Active', closed: 'Expired', freeze: 'Frozen',
  pricing: 'Official plans and pricing', creditHint: 'Credits are an upstream allowance, not a currency cost. Missing values are not treated as zero.', oldPackage: 'This account uses a legacy Token plan; credit balance is unavailable.',
  autoClaim: 'Automatically claim daily and new-user credits for all signed-in accounts', autoClaimHint: 'Checks at startup and every 30 minutes while Harness is running. Eligibility and amounts are determined by Huawei Cloud.',
  claim: 'Claim available credits', claimStatus: 'Latest claim result', checkedAt: 'Last checked', noCampaign: 'No daily or new-user reward is available.', received: 'Credits claimed this time', creditRate: 'Credit multiplier',
} as const

export type CopyKey = keyof typeof en
export type Translate = (key: CopyKey, params?: Record<string, unknown>) => string

export const zh: Record<CopyKey, string> = {
  title: 'CodeArts', intro: '在 DeepSeek Harness 中使用华为云 CodeArts 模型。',
  accounts: '账号', add: '华为云账号登录', edit: '重命名', remove: '删除', confirmRemove: '删除这个账号及已保存的凭据？',
  select: '使用此账号', selected: '当前账号', noAccount: '登录华为云账号后即可发现模型。', choose: '请选择已登录的账号以使用其模型。',
  name: '账号名称',
  save: '保存名称', cancel: '取消', loading: '加载中…', working: '处理中…', retry: '重新加载',
  refresh: '刷新账号与模型', models: '模型', noModels: '尚未发现可用模型。',
  context: '上下文', output: '最大输出', images: '图片', text: '文本', cached: '最近成功刷新',
  updated: '已保存', modelHint: '模型权限和可用性由上游决定，缺失容量信息的模型会在下方说明。',
  credentialsHint: '通过浏览器登录，可自动续期的 OAuth 凭据保存于 Harness 凭据存储。',
  switchHint: '新请求使用当前账号，正在生成的请求继续使用原账号。',
  manage: '请在设置 → CodeArts 中管理账号。', modelCount: '可用模型',
  relogin: '重新登录', ready: '已登录', legacy: '升级到 0.2.0 后，此账号需要完成 OAuth 登录。', loginRequired: '授权已失效，请重新登录。',
  loginPending: '请打开华为云登录页面完成授权。本次登录将在 15 分钟后过期。', openLogin: '打开华为云登录', cancelLogin: '取消登录', loginComplete: '登录完成。',
  subscription: '套餐与积分', remaining: '剩余', total: '总额', used: '已用', expiring: '即将到期积分', periodEnd: '当前周期截止', unknown: '暂无数据',
  basic: '套餐积分', ondemand: '积分包', bonus: '活动福利积分', normal: '有效', closed: '已到期', freeze: '已冻结',
  pricing: '官方套餐与定价', creditHint: '积分是上游使用额度，不等同于货币成本；缺失数据不会按零处理。', oldPackage: '此账号使用旧 Token 套餐，暂无积分余额。',
  autoClaim: '自动领取所有已登录账号的每日签到和新手积分', autoClaimHint: 'Harness 运行期间，在启动时及每 30 分钟检查一次。领取资格和金额以华为云返回为准。',
  claim: '领取可用积分', claimStatus: '最近领取结果', checkedAt: '最近检查', noCampaign: '暂无可领取的签到或新手奖励。', received: '本次领取积分', creditRate: '积分消耗倍率',
}
