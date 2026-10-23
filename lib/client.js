window.__ModuleLoader__.load({
	id: "@ipfans/dsh-connect-codearts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/types.ts
		const ENTRY_ID = "llm-codearts";
		const STATUS_PATH = "/api/codearts/status";
		const ACTION_PATH = "/api/codearts/action";
		// src/client/locales.ts
		const en = {
			title: "CodeArts",
			intro: "Use Huawei Cloud CodeArts models in DeepSeek Harness.",
			accounts: "Accounts",
			add: "Sign in with Huawei Cloud",
			edit: "Rename",
			remove: "Remove",
			confirmRemove: "Remove this account and its saved credentials?",
			select: "Use account",
			selected: "Selected",
			noAccount: "Sign in with Huawei Cloud to discover your models.",
			choose: "Select a signed-in account to use its models.",
			name: "Account name",
			save: "Save name",
			cancel: "Cancel",
			loading: "Loading…",
			working: "Working…",
			retry: "Reload",
			refresh: "Refresh account and models",
			models: "Models",
			noModels: "No available models discovered.",
			context: "Context",
			output: "Max output",
			images: "Images",
			text: "Text",
			cached: "Last successful refresh",
			updated: "Saved",
			modelHint: "The upstream determines access and availability. Missing capacity metadata is reported below.",
			credentialsHint: "Sign in in your browser. Renewable OAuth credentials stay in the Harness credential store.",
			switchHint: "New requests follow the selected account. Requests already generating keep their original account.",
			manage: "Manage accounts in Settings → CodeArts.",
			modelCount: "Available models",
			relogin: "Sign in again",
			ready: "Signed in",
			legacy: "This account needs OAuth login after upgrading to 0.2.0.",
			loginRequired: "Authorization expired. Sign in again.",
			loginPending: "Open the Huawei Cloud login page to continue. This login expires after 15 minutes.",
			openLogin: "Open Huawei Cloud login",
			cancelLogin: "Cancel login",
			loginComplete: "Login completed.",
			subscription: "Plan and credits",
			remaining: "Remaining",
			total: "Total",
			used: "Used",
			expiring: "Expiring credits",
			periodEnd: "Current period ends",
			unknown: "Not available",
			basic: "Plan credits",
			ondemand: "Credit packs",
			bonus: "Promotional credits",
			normal: "Active",
			closed: "Expired",
			freeze: "Frozen",
			pricing: "Official plans and pricing",
			creditHint: "Credits are an upstream allowance, not a currency cost. Missing values are not treated as zero.",
			oldPackage: "This account uses a legacy Token plan; credit balance is unavailable.",
			autoClaim: "Automatically claim daily and new-user credits for all signed-in accounts",
			autoClaimHint: "Checks at startup and every 30 minutes while Harness is running. Eligibility and amounts are determined by Huawei Cloud.",
			claim: "Claim available credits",
			claimStatus: "Latest claim result",
			checkedAt: "Last checked",
			noCampaign: "No daily or new-user reward is available.",
			received: "Credits claimed this time",
			creditRate: "Credit multiplier"
		};
		const zh = {
			title: "CodeArts",
			intro: "在 DeepSeek Harness 中使用华为云 CodeArts 模型。",
			accounts: "账号",
			add: "华为云账号登录",
			edit: "重命名",
			remove: "删除",
			confirmRemove: "删除这个账号及已保存的凭据？",
			select: "使用此账号",
			selected: "当前账号",
			noAccount: "登录华为云账号后即可发现模型。",
			choose: "请选择已登录的账号以使用其模型。",
			name: "账号名称",
			save: "保存名称",
			cancel: "取消",
			loading: "加载中…",
			working: "处理中…",
			retry: "重新加载",
			refresh: "刷新账号与模型",
			models: "模型",
			noModels: "尚未发现可用模型。",
			context: "上下文",
			output: "最大输出",
			images: "图片",
			text: "文本",
			cached: "最近成功刷新",
			updated: "已保存",
			modelHint: "模型权限和可用性由上游决定，缺失容量信息的模型会在下方说明。",
			credentialsHint: "通过浏览器登录，可自动续期的 OAuth 凭据保存于 Harness 凭据存储。",
			switchHint: "新请求使用当前账号，正在生成的请求继续使用原账号。",
			manage: "请在设置 → CodeArts 中管理账号。",
			modelCount: "可用模型",
			relogin: "重新登录",
			ready: "已登录",
			legacy: "升级到 0.2.0 后，此账号需要完成 OAuth 登录。",
			loginRequired: "授权已失效，请重新登录。",
			loginPending: "请打开华为云登录页面完成授权。本次登录将在 15 分钟后过期。",
			openLogin: "打开华为云登录",
			cancelLogin: "取消登录",
			loginComplete: "登录完成。",
			subscription: "套餐与积分",
			remaining: "剩余",
			total: "总额",
			used: "已用",
			expiring: "即将到期积分",
			periodEnd: "当前周期截止",
			unknown: "暂无数据",
			basic: "套餐积分",
			ondemand: "积分包",
			bonus: "活动福利积分",
			normal: "有效",
			closed: "已到期",
			freeze: "已冻结",
			pricing: "官方套餐与定价",
			creditHint: "积分是上游使用额度，不等同于货币成本；缺失数据不会按零处理。",
			oldPackage: "此账号使用旧 Token 套餐，暂无积分余额。",
			autoClaim: "自动领取所有已登录账号的每日签到和新手积分",
			autoClaimHint: "Harness 运行期间，在启动时及每 30 分钟检查一次。领取资格和金额以华为云返回为准。",
			claim: "领取可用积分",
			claimStatus: "最近领取结果",
			checkedAt: "最近检查",
			noCampaign: "暂无可领取的签到或新手奖励。",
			received: "本次领取积分",
			creditRate: "积分消耗倍率"
		};
		// src/json.ts
		function object(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		// src/client/api.ts
		function isStatus(value) {
			const row = object(value);
			const catalog = object(row?.["catalog"]);
			const login = object(row?.["login"]);
			const authUrl = login?.["authUrl"];
			if (authUrl !== void 0) try {
				const url = new URL(String(authUrl));
				if (url.origin !== "https://codearts.huaweicloud.com" || url.pathname !== "/portal/authorize" || url.username || url.password) return false;
			} catch {
				return false;
			}
			return !!row && typeof row["actionToken"] === "string" && typeof row["autoClaim"] === "boolean" && !!login && [
				"idle",
				"pending",
				"complete",
				"error"
			].includes(String(login["state"])) && (row["activeId"] === null || typeof row["activeId"] === "string") && Array.isArray(row["accounts"]) && row["accounts"].every((a) => {
				const account = object(a);
				return account && typeof account["id"] === "string" && typeof account["label"] === "string" && [
					"ready",
					"legacy",
					"login-required"
				].includes(String(account["authState"])) && !!object(account["benefits"]);
			}) && !!catalog && Array.isArray(catalog["models"]) && Array.isArray(catalog["issues"]);
		}
		async function result(response) {
			const body = await response.json();
			if (!response.ok) throw new Error(typeof object(body)?.["error"] === "string" ? String(object(body)?.["error"]) : `HTTP ${response.status}`);
			return body;
		}
		async function readStatus(signal) {
			const body = await result(await fetch(STATUS_PATH, {
				credentials: "same-origin",
				cache: "no-store",
				...signal ? { signal } : {}
			}));
			if (!isStatus(body)) throw new Error("CodeArts status response is invalid");
			return body;
		}
		async function sendAction(action, token, signal) {
			await result(await fetch(ACTION_PATH, {
				method: "POST",
				credentials: "same-origin",
				headers: {
					"content-type": "application/json",
					"x-codearts-action-token": token
				},
				body: JSON.stringify(action),
				...signal ? { signal } : {}
			}));
		}
		// src/client/settings.tsx
		function useStatus() {
			const [status, setStatus] = (0, react.useState)();
			const [error, setError] = (0, react.useState)("");
			const controller = (0, react.useRef)();
			const generation = (0, react.useRef)(0);
			const reload = (0, react.useCallback)(async () => {
				const current = ++generation.current;
				try {
					const value = await readStatus(controller.current?.signal);
					if (current === generation.current && !controller.current?.signal.aborted) {
						setStatus(value);
						setError("");
					}
				} catch (reason) {
					if (current === generation.current && !controller.current?.signal.aborted) setError(reason instanceof Error ? reason.message : "CodeArts status could not be loaded");
				}
			}, []);
			(0, react.useEffect)(() => {
				controller.current = new AbortController();
				reload();
				const timer = setInterval(() => {
					reload();
				}, status?.login.state === "pending" ? 1500 : 15e3);
				return () => {
					controller.current?.abort();
					++generation.current;
					clearInterval(timer);
				};
			}, [reload, status?.login.state]);
			return {
				status,
				error,
				reload,
				signal: () => controller.current?.signal
			};
		}
		function amount(value, t) {
			return value === void 0 ? t("unknown") : value.toLocaleString(void 0, { maximumFractionDigits: 2 });
		}
		function CreditAmounts({ value, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
				className: "cac-credits",
				children: [
					"remaining",
					"total",
					"used",
					"expiring"
				].map((key) => key === "expiring" && value[key] === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t(key) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: amount(value[key], t) })] }, key))
			});
		}
		function AccountBenefits({ account, t }) {
			const { subscription, error, fetchedAt, claims, checkedAt, claimError } = account.benefits;
			const planStatus = subscription?.status;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "alert",
					className: "cac-error",
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: subscription?.name ?? subscription?.nameEn ?? t("unknown") }), planStatus ? ` · ${[
					"normal",
					"closed",
					"freeze"
				].includes(planStatus) ? t(planStatus) : planStatus}` : ""] }),
				subscription?.isCreditPackage === false ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("oldPackage") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditAmounts, {
					value: subscription ?? {},
					t
				}),
				subscription?.periodEnd && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "cac-muted",
					children: [
						t("periodEnd"),
						": ",
						subscription.periodEnd
					]
				}),
				subscription?.packages.map((part) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(part.kind) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditAmounts, {
					value: part,
					t
				})] }, part.kind)),
				fetchedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "cac-muted",
					children: [
						t("cached"),
						": ",
						new Date(fetchedAt).toLocaleString()
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "cac-muted",
					children: [
						t("creditHint"),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
							href: "https://codearts.huaweicloud.com/pricing.html",
							target: "_blank",
							rel: "noopener noreferrer",
							children: t("pricing")
						})
					]
				}),
				(claims || claimError) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("claimStatus") }),
				claimError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					role: "alert",
					className: "cac-error",
					children: claimError
				}),
				claims?.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("noCampaign") }),
				claims?.map((result) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					role: result.ok ? void 0 : "alert",
					className: result.ok ? "cac-muted" : "cac-error",
					children: [
						result.title,
						": ",
						result.message,
						result.credits === void 0 ? "" : ` · ${t("received")}: ${amount(result.credits, t)}`
					]
				}, result.campaignId)),
				checkedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "cac-muted",
					children: [
						t("checkedAt"),
						": ",
						new Date(checkedAt).toLocaleString()
					]
				})
			] });
		}
		function SettingsPage({ t }) {
			const { status, error, reload, signal } = useStatus();
			const [form, setForm] = (0, react.useState)(null);
			const [removing, setRemoving] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)("");
			const [actionError, setActionError] = (0, react.useState)("");
			const operating = (0, react.useRef)(false);
			const formId = (0, react.useId)();
			const active = status?.accounts.find((a) => a.id === status.activeId);
			const perform = async (action) => {
				if (!status || operating.current) return false;
				operating.current = true;
				setBusy(true);
				setActionError("");
				setMessage("");
				try {
					await sendAction(action, status.actionToken, signal());
					if (signal()?.aborted) return false;
					setMessage(t("updated"));
					await reload();
					return true;
				} catch (reason) {
					if (!signal()?.aborted) setActionError(reason instanceof Error ? reason.message : "CodeArts operation failed");
					return false;
				} finally {
					operating.current = false;
					if (!signal()?.aborted) setBusy(false);
				}
			};
			const edit = (account) => {
				setForm({
					id: account.id,
					label: account.label
				});
				setRemoving(null);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "cac-page",
				"aria-busy": busy,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cac-muted",
						children: t("intro")
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						className: "cac-error",
						children: [
							error,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								onClick: () => {
									reload();
								},
								children: t("retry")
							})
						]
					}),
					actionError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "cac-error",
						children: actionError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						"aria-live": "polite",
						children: busy ? t("working") : message
					}),
					!status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("loading") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "cac-section",
						"aria-labelledby": `${formId}-accounts`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									id: `${formId}-accounts`,
									children: t("accounts")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									disabled: busy || status.login.state === "pending",
									onClick: () => {
										perform({ action: "login" });
									},
									children: t("add")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("credentialsHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("switchHint")
							}),
							status.login.state === "pending" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-login",
								role: "status",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("loginPending") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "cac-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: status.login.authUrl,
										target: "_blank",
										rel: "noopener noreferrer",
										children: t("openLogin")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										disabled: busy,
										onClick: () => {
											perform({ action: "cancel-login" });
										},
										children: t("cancelLogin")
									})]
								})]
							}),
							status.login.state === "complete" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "status",
								children: t("loginComplete")
							}),
							status.login.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "cac-error",
								children: status.login.error
							}),
							!status.accounts.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("noAccount") }),
							status.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: account.label }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "cac-muted",
										children: [account.userName, account.id === status.activeId ? ` · ${t("selected")}` : ""]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "cac-muted",
										children: t(account.authState === "ready" ? "ready" : account.authState === "legacy" ? "legacy" : "loginRequired")
									}),
									account.benefits.subscription && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "cac-muted",
										children: [
											account.benefits.subscription.name ?? account.benefits.subscription.nameEn,
											" · ",
											t("remaining"),
											" ",
											amount(account.benefits.subscription.remaining, t)
										]
									})
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "cac-actions",
									children: removing === account.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("confirmRemove") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy,
											onClick: () => {
												perform({
													action: "remove",
													id: account.id
												}).then((ok) => {
													if (ok) {
														setRemoving(null);
														if (form?.id === account.id) setForm(null);
													}
												});
											},
											children: t("remove")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy,
											onClick: () => setRemoving(null),
											children: t("cancel")
										})
									] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										account.id !== status.activeId && account.authState === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy,
											onClick: () => {
												perform({
													action: "select",
													id: account.id
												});
											},
											children: t("select")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy || status.login.state === "pending",
											onClick: () => {
												perform({
													action: "login",
													accountId: account.id
												});
											},
											children: t("relogin")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy,
											onClick: () => edit(account),
											children: t("edit")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
											disabled: busy,
											onClick: () => setRemoving(account.id),
											children: t("remove")
										})
									] })
								})]
							}, account.id)),
							form && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								className: "cac-form",
								autoComplete: "off",
								onSubmit: (event) => {
									event.preventDefault();
									perform({
										action: "rename",
										id: form.id,
										label: form.label
									}).then((ok) => {
										if (ok) setForm(null);
									});
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t("edit") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${formId}-name`,
										children: t("name")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										id: `${formId}-name`,
										value: form.label,
										maxLength: 100,
										required: true,
										disabled: busy,
										onChange: (e) => setForm({
											...form,
											label: e.target.value
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "cac-actions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											type: "submit",
											variant: "primary",
											disabled: busy,
											children: t("save")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											type: "button",
											disabled: busy,
											onClick: () => setForm(null),
											children: t("cancel")
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "cac-toggle",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: status.autoClaim,
									disabled: busy,
									onChange: (event) => {
										perform({
											action: "auto-claim",
											enabled: event.target.checked
										});
									}
								}), t("autoClaim")]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("autoClaimHint")
							})
						]
					}), !active || active.authState !== "ready" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("choose") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "cac-section",
						"aria-labelledby": `${formId}-benefits`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "cac-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
								id: `${formId}-benefits`,
								children: [
									t("subscription"),
									" · ",
									active.label
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								disabled: busy,
								onClick: () => {
									perform({
										action: "claim",
										accountId: active.id
									});
								},
								children: t("claim")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBenefits, {
							account: active,
							t
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "cac-section",
						"aria-labelledby": `${formId}-models`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
									id: `${formId}-models`,
									children: [
										t("models"),
										" · ",
										active.label
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									disabled: busy,
									onClick: () => {
										perform({
											action: "refresh",
											accountId: active.id
										});
									},
									children: t("refresh")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("modelHint")
							}),
							status.catalog.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "cac-error",
								children: status.catalog.error
							}),
							status.catalog.fetchedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "cac-muted",
								children: [
									t("cached"),
									": ",
									new Date(status.catalog.fetchedAt).toLocaleString()
								]
							}),
							!status.catalog.models.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("noModels")
							}),
							status.catalog.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "cac-muted cac-model-id",
									children: model.id
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "cac-muted",
									children: [
										t("context"),
										" ",
										model.contextWindow.toLocaleString(),
										" · ",
										t("output"),
										" ",
										model.maxTokens.toLocaleString(),
										" · ",
										t(model.supportsImages ? "images" : "text"),
										model.creditRates?.length ? ` · ${t("creditRate")} ${model.creditRates.map((rate) => `${rate}×`).join(" / ")}` : ""
									]
								})]
							}, model.id)),
							status.catalog.issues.map((issue, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: issue
							}, i))
						]
					})] })] })
				]
			});
		}
		function ProviderCard({ t }) {
			const { status, error } = useStatus();
			const active = status?.accounts.find((a) => a.id === status.activeId);
			const subscription = active?.benefits.subscription;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "cac-provider",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "CodeArts" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: active?.label ?? t("choose") }),
					active && active.authState !== "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(active.authState === "legacy" ? "legacy" : "loginRequired") }),
					active?.authState === "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
						subscription?.name ?? subscription?.nameEn ?? t("subscription"),
						" · ",
						t("remaining"),
						" ",
						amount(subscription?.remaining, t)
					] }),
					status && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
						t("modelCount"),
						": ",
						status.catalog.models.length
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cac-muted",
						children: t("manage")
					}),
					(error || active?.benefits.error) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "cac-error",
						children: error || active?.benefits.error
					})
				]
			});
		}
		// src/client/index.tsx
		const name = "dsh-connect-codearts-client";
		const inject = ["slots", "locale"];
		const CSS = `
.cac-page { max-width: 800px; margin: 0 auto; padding: 24px; color: var(--dsw-alias-label-primary); }
.cac-page h2 { margin: 0 0 8px; } .cac-page h3, .cac-page h4 { margin: 0; }
.cac-section { padding: 24px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.cac-section h4 { margin: 20px 0 12px; }
.cac-heading, .cac-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.cac-heading { flex-wrap: wrap; } .cac-row { padding: 14px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.cac-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cac-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.6; }
.cac-error { color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.cac-form { display: grid; gap: 10px; max-width: 480px; padding: 16px 0; }
.cac-form label { font-size: 13px; }
.cac-model-id { overflow-wrap: anywhere; } .cac-provider { padding: 12px; }
.cac-credits { display: flex; flex-wrap: wrap; gap: 24px; } .cac-credits dt { color: var(--dsw-alias-label-secondary); font-size: 13px; } .cac-credits dd { margin: 4px 0; font-variant-numeric: tabular-nums; }
.cac-toggle { display: flex; align-items: center; gap: 8px; margin-top: 20px; } .cac-login { padding: 16px 0; }
.cac-page a { color: var(--dsw-alias-label-primary); text-decoration: underline; }
@media (max-width: 600px) { .cac-page { padding: 16px; } .cac-row { align-items: flex-start; flex-direction: column; } }
`;
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("settings.codearts", {
				en,
				zh
			}));
			const t = ctx.locale.bind("settings.codearts");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.pluginCss = "dsh-connect-codearts";
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-codearts",
				order: 41,
				label: () => t("title"),
				locale: "settings.codearts"
			}, SettingsPage));
			ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
				name: "settings.models.provider-card",
				key: ENTRY_ID,
				locale: "settings.codearts"
			}, ProviderCard));
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
