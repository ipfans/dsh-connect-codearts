import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountAction, CodeArtsStatus, CreditAmount, PublicAccount } from '../types.ts'
import { readStatus, sendAction } from './api.ts'
import type { Translate } from './locales.ts'

function useStatus() {
  const [status, setStatus] = useState<CodeArtsStatus>()
  const [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const current = ++generation.current
    try {
      const value = await readStatus(controller.current?.signal)
      if (current === generation.current && !controller.current?.signal.aborted) { setStatus(value); setError('') }
    } catch (reason) {
      if (current === generation.current && !controller.current?.signal.aborted) setError(reason instanceof Error ? reason.message : 'CodeArts status could not be loaded')
    }
  }, [])
  useEffect(() => {
    controller.current = new AbortController()
    void reload()
    const timer = setInterval(() => { void reload() }, status?.login.state === 'pending' ? 1500 : 15_000)
    return () => { controller.current?.abort(); ++generation.current; clearInterval(timer) }
  }, [reload, status?.login.state])
  return { status, error, reload, signal: () => controller.current?.signal }
}

function amount(value: number | undefined, t: Translate): string { return value === undefined ? t('unknown') : value.toLocaleString(undefined, { maximumFractionDigits: 2 }) }

function CreditAmounts({ value, t }: { value: CreditAmount; t: Translate }) {
  return <dl className="cac-credits">{(['remaining', 'total', 'used', 'expiring'] as const).map(key => key === 'expiring' && value[key] === undefined ? null : <div key={key}><dt>{t(key)}</dt><dd>{amount(value[key], t)}</dd></div>)}</dl>
}

function AccountBenefits({ account, t }: { account: PublicAccount; t: Translate }) {
  const { subscription, error, fetchedAt, claims, checkedAt, claimError } = account.benefits
  const planStatus = subscription?.status
  return <>
    {error && <p role="alert" className="cac-error">{error}</p>}
    <p><strong>{subscription?.name ?? subscription?.nameEn ?? t('unknown')}</strong>{planStatus ? ` · ${['normal', 'closed', 'freeze'].includes(planStatus) ? t(planStatus as 'normal' | 'closed' | 'freeze') : planStatus}` : ''}</p>
    {subscription?.isCreditPackage === false ? <p>{t('oldPackage')}</p> : <CreditAmounts value={subscription ?? {}} t={t}/>}
    {subscription?.periodEnd && <p className="cac-muted">{t('periodEnd')}: {subscription.periodEnd}</p>}
    {subscription?.packages.map(part => <div key={part.kind}><strong>{t(part.kind)}</strong><CreditAmounts value={part} t={t}/></div>)}
    {fetchedAt !== undefined && <p className="cac-muted">{t('cached')}: {new Date(fetchedAt).toLocaleString()}</p>}
    <p className="cac-muted">{t('creditHint')} <a href="https://codearts.huaweicloud.com/pricing.html" target="_blank" rel="noopener noreferrer">{t('pricing')}</a></p>
    {(claims || claimError) && <h4>{t('claimStatus')}</h4>}
    {claimError && <p role="alert" className="cac-error">{claimError}</p>}
    {claims?.length === 0 && <p>{t('noCampaign')}</p>}
    {claims?.map(result => <p key={result.campaignId} role={result.ok ? undefined : 'alert'} className={result.ok ? 'cac-muted' : 'cac-error'}>{result.title}: {result.message}{result.credits === undefined ? '' : ` · ${t('received')}: ${amount(result.credits, t)}`}</p>)}
    {checkedAt !== undefined && <p className="cac-muted">{t('checkedAt')}: {new Date(checkedAt).toLocaleString()}</p>}
  </>
}

export function SettingsPage({ t }: { t: Translate }) {
  const { status, error, reload, signal } = useStatus()
  const [form, setForm] = useState<{ id: string; label: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const operating = useRef(false)
  const formId = useId()
  const active = status?.accounts.find(a => a.id === status.activeId)
  const perform = async (action: AccountAction): Promise<boolean> => {
    if (!status || operating.current) return false
    operating.current = true; setBusy(true); setActionError(''); setMessage('')
    try {
      await sendAction(action, status.actionToken, signal())
      if (signal()?.aborted) return false
      setMessage(t('updated'))
      await reload()
      return true
    } catch (reason) {
      if (!signal()?.aborted) setActionError(reason instanceof Error ? reason.message : 'CodeArts operation failed')
      return false
    } finally { operating.current = false; if (!signal()?.aborted) setBusy(false) }
  }
  const edit = (account: PublicAccount) => { setForm({ id: account.id, label: account.label }); setRemoving(null) }
  return <div className="cac-page" aria-busy={busy}>
    <h2>{t('title')}</h2><p className="cac-muted">{t('intro')}</p>
    {error && <p role="alert" className="cac-error">{error} <Button size="sm" onClick={() => { void reload() }}>{t('retry')}</Button></p>}
    {actionError && <p role="alert" className="cac-error">{actionError}</p>}
    <p role="status" aria-live="polite">{busy ? t('working') : message}</p>
    {!status ? <p>{t('loading')}</p> : <>
      <section className="cac-section" aria-labelledby={`${formId}-accounts`}>
        <div className="cac-heading"><h3 id={`${formId}-accounts`}>{t('accounts')}</h3><Button disabled={busy || status.login.state === 'pending'} onClick={() => { void perform({ action: 'login' }) }}>{t('add')}</Button></div>
        <p className="cac-muted">{t('credentialsHint')}</p><p className="cac-muted">{t('switchHint')}</p>
        {status.login.state === 'pending' && <div className="cac-login" role="status"><p>{t('loginPending')}</p><div className="cac-actions"><a href={status.login.authUrl} target="_blank" rel="noopener noreferrer">{t('openLogin')}</a><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'cancel-login' }) }}>{t('cancelLogin')}</Button></div></div>}
        {status.login.state === 'complete' && <p role="status">{t('loginComplete')}</p>}
        {status.login.error && <p role="alert" className="cac-error">{status.login.error}</p>}
        {!status.accounts.length && <p>{t('noAccount')}</p>}
        {status.accounts.map(account => <div className="cac-row" key={account.id}>
          <div><strong>{account.label}</strong><div className="cac-muted">{account.userName}{account.id === status.activeId ? ` · ${t('selected')}` : ''}</div><div className="cac-muted">{t(account.authState === 'ready' ? 'ready' : account.authState === 'legacy' ? 'legacy' : 'loginRequired')}</div>{account.benefits.subscription && <div className="cac-muted">{account.benefits.subscription.name ?? account.benefits.subscription.nameEn} · {t('remaining')} {amount(account.benefits.subscription.remaining, t)}</div>}</div>
          <div className="cac-actions">
            {removing === account.id ? <><span>{t('confirmRemove')}</span><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'remove', id: account.id }).then(ok => { if (ok) { setRemoving(null); if (form?.id === account.id) setForm(null) } }) }}>{t('remove')}</Button><Button size="sm" disabled={busy} onClick={() => setRemoving(null)}>{t('cancel')}</Button></> : <>
              {account.id !== status.activeId && account.authState === 'ready' && <Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'select', id: account.id }) }}>{t('select')}</Button>}
              <Button size="sm" disabled={busy || status.login.state === 'pending'} onClick={() => { void perform({ action: 'login', accountId: account.id }) }}>{t('relogin')}</Button>
              <Button size="sm" disabled={busy} onClick={() => edit(account)}>{t('edit')}</Button>
              <Button size="sm" disabled={busy} onClick={() => setRemoving(account.id)}>{t('remove')}</Button>
            </>}
          </div>
        </div>)}
        {form && <form className="cac-form" autoComplete="off" onSubmit={event => {
          event.preventDefault()
          void perform({ action: 'rename', id: form.id, label: form.label }).then(ok => { if (ok) setForm(null) })
        }}>
          <h4>{t('edit')}</h4>
          <label htmlFor={`${formId}-name`}>{t('name')}</label><Input id={`${formId}-name`} value={form.label} maxLength={100} required disabled={busy} onChange={e => setForm({ ...form, label: e.target.value })}/>
          <div className="cac-actions"><Button type="submit" variant="primary" disabled={busy}>{t('save')}</Button><Button type="button" disabled={busy} onClick={() => setForm(null)}>{t('cancel')}</Button></div>
        </form>}
        <label className="cac-toggle"><input type="checkbox" checked={status.autoClaim} disabled={busy} onChange={event => { void perform({ action: 'auto-claim', enabled: event.target.checked }) }}/>{t('autoClaim')}</label>
        <p className="cac-muted">{t('autoClaimHint')}</p>
      </section>
      {!active || active.authState !== 'ready' ? <p>{t('choose')}</p> : <>
        <section className="cac-section" aria-labelledby={`${formId}-benefits`}>
          <div className="cac-heading"><h3 id={`${formId}-benefits`}>{t('subscription')} · {active.label}</h3><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'claim', accountId: active.id }) }}>{t('claim')}</Button></div>
          <AccountBenefits account={active} t={t}/>
        </section>
        <section className="cac-section" aria-labelledby={`${formId}-models`}>
          <div className="cac-heading"><h3 id={`${formId}-models`}>{t('models')} · {active.label}</h3><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'refresh', accountId: active.id }) }}>{t('refresh')}</Button></div>
          <p className="cac-muted">{t('modelHint')}</p>
          {status.catalog.error && <p role="alert" className="cac-error">{status.catalog.error}</p>}
          {status.catalog.fetchedAt !== undefined && <p className="cac-muted">{t('cached')}: {new Date(status.catalog.fetchedAt).toLocaleString()}</p>}
          {!status.catalog.models.length && <p className="cac-muted">{t('noModels')}</p>}
          {status.catalog.models.map(model => <div className="cac-row" key={model.id}><div><strong>{model.name}</strong><div className="cac-muted cac-model-id">{model.id}</div></div><span className="cac-muted">{t('context')} {model.contextWindow.toLocaleString()} · {t('output')} {model.maxTokens.toLocaleString()} · {t(model.supportsImages ? 'images' : 'text')}{model.creditRates?.length ? ` · ${t('creditRate')} ${model.creditRates.map(rate => `${rate}×`).join(' / ')}` : ''}</span></div>)}
          {status.catalog.issues.map((issue, i) => <p className="cac-muted" key={i}>{issue}</p>)}
        </section>
      </>}
    </>}
  </div>
}

export function ProviderCard({ t }: { t: Translate }) {
  const { status, error } = useStatus()
  const active = status?.accounts.find(a => a.id === status.activeId)
  const subscription = active?.benefits.subscription
  return <div className="cac-provider"><strong>CodeArts</strong><p>{active?.label ?? t('choose')}</p>{active && active.authState !== 'ready' && <p>{t(active.authState === 'legacy' ? 'legacy' : 'loginRequired')}</p>}{active?.authState === 'ready' && <p>{subscription?.name ?? subscription?.nameEn ?? t('subscription')} · {t('remaining')} {amount(subscription?.remaining, t)}</p>}{status && <p>{t('modelCount')}: {status.catalog.models.length}</p>}<p className="cac-muted">{t('manage')}</p>{(error || active?.benefits.error) && <p role="alert" className="cac-error">{error || active?.benefits.error}</p>}</div>
}
