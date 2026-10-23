# @ipfans/dsh-connect-codearts

将华为云 CodeArts 订阅模型接入 DeepSeek Harness。原生 TypeScript 插件，直接签名调用 CodeArts 接口，使用 DSH 的会话、工具执行和权限体系。

**0.2.1**：从上游获取模型思考强度，按模型提供选择并传递所选档位。保留 0.2.0 的 OAuth 登录、自动续期、积分套餐查询及签到自动领取；套餐和积分独立展示，不接入货币成本统计。

## 兼容版本

- DeepSeek Harness：**0.2.1-rc.2**。
- `@earendil-works/pi-ai`：固定 **1.1.0**。
- Node.js：`^22.19.0 || >=24.0.0`。
- 支持具备本地宿主服务的 DSH Web / Desktop 设置页；控制接口仅接受本机回环来源。

## 安装

在 DSH 的 **设置 → 插件 → 添加插件** 中填写：

```text
@ipfans/dsh-connect-codearts
```

也可以使用已安装的 DSH CLI：

```sh
dsh plugin --profile desktop add @ipfans/dsh-connect-codearts
```

Web profile 将 `desktop` 改为 `web`。安装后重启 DSH。也可使用 `github:ipfans/dsh-connect-codearts` 安装；仓库包含预构建的 `lib/`，无需本地编译。

## 使用

1. 打开 **设置 → CodeArts → 华为云账号登录**，点击 **打开华为云登录**，在本机浏览器完成授权。授权链接有效期 15 分钟；可随时取消登录。
2. 登录成功后自动发现模型，展示套餐、积分余额与最近领取结果。首个已登录账号默认选中；其他账号可手动切换、重命名或删除。
3. 点击 **刷新账号与模型** 可立即更新；在对话模型选择器中选择 CodeArts 模型。

从 0.1.x 升级：原 AK/SK 账号会显示“需要 OAuth 登录”，保留原名称和凭据记录，但不再用于请求。点击该账号的 **重新登录**，成功后替换为可续期凭据；失败或取消不会清空原记录。已有 OAuth 账号重新登录必须使用同一华为云身份。

账号切换影响后续请求，进行中的请求继续使用原账号。删除当前账号会清空选择。若新账号没有会话原先使用的模型，需要重新选择一个可用模型。

## 功能与行为

- 从 AgentCenter 发现当前账号可用的订阅模型；内置模型接口补充容量信息和上游明确提供的积分倍率。
- 模型标识保持 `agent/<模型ID>`，请求上游时还原真实 ID，兼容已有订阅模型会话。
- 支持正文流、推理内容、工具调用参数分片、工具结果回传及 token 用量。图片仅在上游明确声明支持时启用。
- 思考强度来自 `POST /v1/model/thinking-variants`：有定义时只提供其 `strengths`，使用有效的 `default_strength` 作为默认值；明确返回空列表时不显示选择器，也不发送强度参数。仅缺少定义或查询失败时回退到 `none / low / high / max`，默认 `none`。
- 所选强度作为 `reasoning_effort` 原值发送，不降档或改写为其他强度；拒绝该模型未声明的档位。`none` 是上游参数值，实测仍可能返回推理内容，不代表保证关闭思考。
- 模型上下文和输出上限来自当前账号的上游元数据；缺少关键字段的模型会跳过，并在设置页说明原因。
- 模型目录和套餐信息按账号及本次授权缓存五分钟；手动刷新绕过缓存。临时凭据轮转不清空目录，重新登录后重新发现。
- 刷新失败保留本账号先前成功的模型目录。异常断流和 HTTP 200 业务错误均报告失败。
- 同一华为云账号的请求复用上游会话标识，不随临时 AK 续期、DSH 会话或请求变化；华为会话上限错误按限流处理。
- 在设置页展示套餐状态、当前周期、总额／已用／剩余和分项积分；Provider 卡片展示当前账号的套餐及余额摘要。未知数据不当作零，查询失败保留最近成功数据并提示错误。
- 模型积分倍率仅作额度规则展示。未获得可靠的货币价格，不进行汇率换算或成本统计；底层 SDK 要求的数值价格保留零占位，不代表模型免费。购买和定价以[华为云官网](https://codearts.huaweicloud.com/pricing.html)为准。
- 无自动账号轮换或独立 OpenAI 服务。

## 签到与积分

默认开启 **自动领取所有已登录账号的每日签到和新手积分**。Harness 运行时在启动、登录成功及每 30 分钟检查活动；关闭开关后仍可手动点击 **领取可用积分**。关闭 Harness 时不会后台签到。

领取资格、金额、活动起止时间和刷新规则均以上游返回为准。流程为查询活动 → 领取 → 确认；已领取未确认的活动仅补确认，不重复领取。网络错误或未知结果在下次检查时重新查询状态。签到失败不影响模型调用。

“本次领取积分”和“账户剩余积分”分别展示。余额来自新版 `/snap-manager/v1/statistics/plugin`，与已停用的免费模型 Token 福利通道无关；不恢复旧福利通道。旧 Token 套餐可显示套餐信息，但缺少积分指标时不会伪造积分余额。

## 凭据与请求

OAuth 使用 PKCE 与 P-256 DPoP，临时回调服务仅监听 `127.0.0.1`，完成、取消或过期后关闭。浏览器须与 Harness 运行在同一台机器。

临时 AK/SK、security token、refresh token、有效期、原始 client ID、PKCE verifier 和 DPoP 私钥保存于 DSH 自带的 `ctx.credentials`，记录键仍为 `dsh-connect-codearts/accounts`，数据格式升级为 v2。沿用宿主存储的文件保护、跨进程写锁和原子写入；不另建密钥文件，不把密钥放进普通配置或状态接口。

在凭据到期前 10 分钟及请求前检查续期；同一账号合并续期操作，在存储锁内轮转并保存新凭据后使用，保留原始 DPoP/client ID 绑定。网络故障保留原记录，明确失效时要求重新登录。

请求使用 [Huawei Cloud SDK-HMAC-SHA256](https://support.huaweicloud.com/devg-apisign/api-sign-algorithm-001.html) 签名及 `X-Security-Token`，聊天发送 DSH 的应用归属信息。服务请求仅访问固定的 `snap-access.cn-north-4.myhuaweicloud.com` 和 OAuth 所需的 `sts.cn-north-4.myhuaweicloud.com`，拒绝重定向。浏览器授权使用 `codearts.huaweicloud.com` 门户。

请勿把真实凭据写入源码或提交到 Git。上游接口信息来自社区项目及官方客户端协议核对，账号权限、模型列表、限流与接口可用性仍由上游决定。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:engine
```

宿主和客户端分别构建为 ESM 与 DSH 浏览器模块；后者的模块 ID 从包名派生。宿主 DSH 模块和 React 由 DSH 提供。

测试覆盖 OAuth 回调与 DPoP、身份补全、凭据迁移和并发轮转、积分指标解析、签到补确认、签名向量、模型目录、思考强度元数据与请求透传、空档位禁选、账号隔离、会话复用、工具调用往返、流式错误、取消、控制接口和设置页交互。引擎检查在离线 Cordis/DSH 环境加载构建产物，确认 provider、设置目录、控制路由和浏览器模块身份。

2026-10-23 使用真实账号验证：浏览器 OAuth 登录、refresh token 轮转与保存、套餐及积分分项查询、签到状态查询与重复领取保护、7 个 AgentCenter 模型及其积分倍率均通过。测试凭据仅在验证进程内存中保存。

0.2.1 同日验证：思考强度接口为 `GLM-5.2` 和 `glm-5.2-sft-harmony` 返回 `high / max`、默认 `high`，其他 5 个模型返回空列表。通过 DSH 适配器实际调用 `GLM-5.2` 的 `high`、`max`，请求值与所选档位一致；`glm-5.3` 无强度参数时正常返回，显式设置强度则在发起聊天请求前拒绝。

0.1.1 基线于 2026-10-23 使用真实账号验证：AgentCenter 模型发现正常；`GLM-5.2`、`glm-5.2-sft-harmony`、`openpangu-2.0-pro`、`openpangu-2.0-flash`、`glm-5.3`、`deepseek-v4.1-flash` 的流式对话与推理内容通过，`GLM-5.2` 工具调用及结果回传通过。`kimi-k3` 当时返回上游 TPM 限流，已按 429 处理。0.2.0 保留上述流式与工具行为的回归测试；DSH Desktop 完整界面交互尚未验收。

## npm 发布

推送与 `package.json` 版本一致的 `v*` 标签会触发 [publish.yml](.github/workflows/publish.yml)：安装锁定依赖、构建、类型检查、测试、引擎加载检查，然后通过 GitHub Actions OIDC 发布公开 npm 包和 provenance，无需 `NPM_TOKEN`。

npm Trusted Publisher 配置为 GitHub 用户 `ipfans`、仓库 `dsh-connect-codearts`、工作流文件 `publish.yml`，不设置 Environment，并允许 `npm publish`。首次配置前必须在 npm 建立包记录；见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 参考与许可

- [dsh-workbuddy-connect-functy](https://github.com/functy23/dsh-workbuddy-connect-functy/tree/a13f54e34d357024801ea36963d1ba5c87923ca1)：provider 组装、插件打包和设置接入。
- [codearts2api](https://github.com/Johnsheng1/codearts2api/tree/d813ca0456f23cd73bb3bbee16627bc2a40036f9)：CodeArts 接口、签名与通道信息。
- [HITZY2002/codearts2api](https://github.com/HITZY2002/codearts2api/tree/8d1e43d6f31279ac20cf94b92eff20bdba784b76)：0.2.0 的 OAuth、DPoP、自动续期及积分领取／确认协议。
- [Coding2API](https://github.com/RobbsLuo/Coding2API/blob/main/src/provider/codearts/client.py)：新版积分统计端点及指标核对；套餐与模型倍率字段同时核对本机 CodeArts Agent 26.10.0。
- [CodeArts2API 上游协议记录](https://github.com/2951461586/CodeArts2API/blob/main/docs/UPSTREAM.md)：福利通道关闭与上游会话上限的协议校对。

MIT。来源与署名见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。
