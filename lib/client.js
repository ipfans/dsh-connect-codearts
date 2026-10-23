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
			add: "Add account",
			edit: "Edit",
			remove: "Remove",
			confirmRemove: "Remove this account and its saved credentials?",
			select: "Use account",
			selected: "Selected",
			noAccount: "Add an AK/SK account to discover its models.",
			choose: "Select an account to use its models.",
			name: "Account name",
			ak: "Access Key (AK)",
			sk: "Secret Key (SK)",
			keep: "Leave empty to keep the saved value",
			save: "Save account",
			cancel: "Cancel",
			loading: "Loading…",
			working: "Working…",
			retry: "Reload",
			refresh: "Refresh models and quota",
			claim: "Claim daily benefit",
			claimed: "Last check-in",
			noClaim: "No check-in recorded",
			quota: "Free model quota",
			remaining: "Remaining",
			total: "Total quota",
			used: "Used",
			unknown: "Unavailable",
			models: "Models",
			agent: "Subscription",
			benefit: "Free benefit",
			noModels: "No available models discovered.",
			context: "Context",
			output: "Max output",
			images: "Images",
			text: "Text",
			cached: "Last successful refresh",
			updated: "Saved",
			claimSuccess: "Benefit claimed; quota refreshed.",
			modelHint: "The upstream determines access and availability. Missing capacity metadata is reported below.",
			credentialsHint: "AK/SK are saved in the Harness credential store. Only the final four AK characters are displayed.",
			switchHint: "New requests follow the selected account. Requests already generating keep their original account.",
			manage: "Manage accounts in Settings → CodeArts.",
			modelCount: "Available models"
		};
		const zh = {
			title: "CodeArts",
			intro: "在 DeepSeek Harness 中使用华为云 CodeArts 模型。",
			accounts: "账号",
			add: "添加账号",
			edit: "编辑",
			remove: "删除",
			confirmRemove: "删除这个账号及已保存的凭据？",
			select: "使用此账号",
			selected: "当前账号",
			noAccount: "添加 AK/SK 账号后即可发现模型。",
			choose: "请选择一个账号以使用其模型。",
			name: "账号名称",
			ak: "Access Key（AK）",
			sk: "Secret Key（SK）",
			keep: "留空保留已保存的值",
			save: "保存账号",
			cancel: "取消",
			loading: "加载中…",
			working: "处理中…",
			retry: "重新加载",
			refresh: "刷新模型与额度",
			claim: "领取每日免费额度",
			claimed: "最近签到",
			noClaim: "暂无签到记录",
			quota: "免费模型额度",
			remaining: "剩余",
			total: "总额度",
			used: "已用",
			unknown: "暂无数据",
			models: "模型",
			agent: "订阅模型",
			benefit: "免费额度模型",
			noModels: "尚未发现可用模型。",
			context: "上下文",
			output: "最大输出",
			images: "图片",
			text: "文本",
			cached: "最近成功刷新",
			updated: "已保存",
			claimSuccess: "已签到领取额度，并刷新余额。",
			modelHint: "模型权限和可用性由上游决定，缺失容量信息的模型会在下方说明。",
			credentialsHint: "AK/SK 保存于 Harness 凭据存储，仅展示 AK 末四位。",
			switchHint: "新请求使用当前账号，正在生成的请求继续使用原账号。",
			manage: "请在设置 → CodeArts 中管理账号。",
			modelCount: "可用模型"
		};
		// src/json.ts
		function object(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		// src/client/api.ts
		function isStatus(value) {
			const row = object(value);
			const catalog = object(row?.["catalog"]);
			return !!row && typeof row["actionToken"] === "string" && (row["activeId"] === null || typeof row["activeId"] === "string") && Array.isArray(row["accounts"]) && row["accounts"].every((a) => {
				const account = object(a);
				return account && typeof account["id"] === "string" && typeof account["label"] === "string" && typeof account["akHint"] === "string";
			}) && !!object(row["benefit"]) && ["agent", "benefit"].every((channel) => {
				const state = object(catalog?.[channel]);
				return state && Array.isArray(state["models"]) && Array.isArray(state["issues"]);
			});
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
				}, 15e3);
				return () => {
					controller.current?.abort();
					++generation.current;
					clearInterval(timer);
				};
			}, [reload]);
			return {
				status,
				error,
				reload,
				signal: () => controller.current?.signal
			};
		}
		const emptyForm = {
			id: null,
			label: "",
			ak: "",
			sk: ""
		};
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
					setMessage(t(action.action === "claim" ? "claimSuccess" : "updated"));
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
					label: account.label,
					ak: "",
					sk: ""
				});
				setRemoving(null);
			};
			const format = (value) => value === void 0 ? "—" : value.toLocaleString();
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
									disabled: busy,
									onClick: () => {
										setForm({ ...emptyForm });
										setRemoving(null);
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
							!status.accounts.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("noAccount") }),
							status.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: account.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "cac-muted",
									children: [account.akHint, account.id === status.activeId ? ` · ${t("selected")}` : ""]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
										account.id !== status.activeId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
										action: "save",
										...form.id ? { id: form.id } : {},
										label: form.label,
										ak: form.ak,
										sk: form.sk
									}).then((ok) => {
										if (ok) setForm(null);
									});
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t(form.id ? "edit" : "add") }),
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${formId}-ak`,
										children: t("ak")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										id: `${formId}-ak`,
										type: "password",
										value: form.ak,
										autoComplete: "new-password",
										spellCheck: false,
										required: !form.id,
										disabled: busy,
										placeholder: form.id ? t("keep") : "",
										onChange: (e) => setForm({
											...form,
											ak: e.target.value
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										htmlFor: `${formId}-sk`,
										children: t("sk")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										id: `${formId}-sk`,
										type: "password",
										value: form.sk,
										autoComplete: "new-password",
										spellCheck: false,
										required: !form.id,
										disabled: busy,
										placeholder: form.id ? t("keep") : "",
										onChange: (e) => setForm({
											...form,
											sk: e.target.value
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
							})
						]
					}), !active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("choose") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "cac-section",
						"aria-labelledby": `${formId}-quota`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "cac-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
									id: `${formId}-quota`,
									children: [
										t("quota"),
										" · ",
										active.label
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "cac-actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										disabled: busy,
										onClick: () => {
											perform({
												action: "refresh",
												accountId: active.id
											});
										},
										children: t("refresh")
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
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: "cac-facts",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("remaining") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: format(status.benefit.balance) })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("total") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: format(status.benefit.total) })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("used") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: format(status.benefit.used) })] })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "cac-muted",
								children: [
									t("claimed"),
									": ",
									status.benefit.claimedAt ? new Date(status.benefit.claimedAt).toLocaleString() : t("noClaim")
								]
							}),
							status.benefit.error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								role: "alert",
								className: "cac-error",
								children: status.benefit.error
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "cac-section",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("models") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "cac-muted",
								children: t("modelHint")
							}),
							["agent", "benefit"].map((channel) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t(channel) }),
								status.catalog[channel].error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									role: "alert",
									className: "cac-error",
									children: status.catalog[channel].error
								}),
								status.catalog[channel].fetchedAt !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: "cac-muted",
									children: [
										t("cached"),
										": ",
										new Date(status.catalog[channel].fetchedAt).toLocaleString()
									]
								}),
								!status.catalog[channel].models.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "cac-muted",
									children: t("noModels")
								}),
								status.catalog[channel].models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "cac-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: model.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "cac-muted cac-model-id",
										children: model.id
									})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "cac-muted",
										children: [
											t("context"),
											" ",
											format(model.contextWindow),
											" · ",
											t("output"),
											" ",
											format(model.maxTokens),
											" · ",
											t(model.supportsImages ? "images" : "text")
										]
									})]
								}, model.id)),
								status.catalog[channel].issues.map((issue, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "cac-muted",
									children: issue
								}, i))
							] }, channel))
						]
					})] })] })
				]
			});
		}
		function ProviderCard({ t }) {
			const { status, error } = useStatus();
			const active = status?.accounts.find((a) => a.id === status.activeId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "cac-provider",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "CodeArts" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: active?.label ?? t("choose") }),
					status && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
						t("modelCount"),
						": ",
						status.catalog.agent.models.length + status.catalog.benefit.models.length
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "cac-muted",
						children: t("manage")
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						className: "cac-error",
						children: error
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
.cac-form label { font-size: 13px; } .cac-facts { display: flex; flex-wrap: wrap; gap: 32px; }
.cac-facts dt { color: var(--dsw-alias-label-secondary); font-size: 13px; } .cac-facts dd { margin: 6px 0 0; font-size: 20px; }
.cac-model-id { overflow-wrap: anywhere; } .cac-provider { padding: 12px; }
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
