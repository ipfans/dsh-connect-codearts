import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountAction, CodeArtsStatus, PublicAccount } from '../types.ts'
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
    const timer = setInterval(() => { void reload() }, 15_000)
    return () => { controller.current?.abort(); ++generation.current; clearInterval(timer) }
  }, [reload])
  return { status, error, reload, signal: () => controller.current?.signal }
}

const emptyForm = { id: null as string | null, label: '', ak: '', sk: '' }

export function SettingsPage({ t }: { t: Translate }) {
  const { status, error, reload, signal } = useStatus()
  const [form, setForm] = useState<typeof emptyForm | null>(null)
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
  const edit = (account: PublicAccount) => { setForm({ id: account.id, label: account.label, ak: '', sk: '' }); setRemoving(null) }
  return <div className="cac-page" aria-busy={busy}>
    <h2>{t('title')}</h2><p className="cac-muted">{t('intro')}</p>
    {error && <p role="alert" className="cac-error">{error} <Button size="sm" onClick={() => { void reload() }}>{t('retry')}</Button></p>}
    {actionError && <p role="alert" className="cac-error">{actionError}</p>}
    <p role="status" aria-live="polite">{busy ? t('working') : message}</p>
    {!status ? <p>{t('loading')}</p> : <>
      <section className="cac-section" aria-labelledby={`${formId}-accounts`}>
        <div className="cac-heading"><h3 id={`${formId}-accounts`}>{t('accounts')}</h3><Button disabled={busy} onClick={() => { setForm({ ...emptyForm }); setRemoving(null) }}>{t('add')}</Button></div>
        <p className="cac-muted">{t('credentialsHint')}</p><p className="cac-muted">{t('switchHint')}</p>
        {!status.accounts.length && <p>{t('noAccount')}</p>}
        {status.accounts.map(account => <div className="cac-row" key={account.id}>
          <div><strong>{account.label}</strong><div className="cac-muted">{account.akHint}{account.id === status.activeId ? ` · ${t('selected')}` : ''}</div></div>
          <div className="cac-actions">
            {removing === account.id ? <><span>{t('confirmRemove')}</span><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'remove', id: account.id }).then(ok => { if (ok) { setRemoving(null); if (form?.id === account.id) setForm(null) } }) }}>{t('remove')}</Button><Button size="sm" disabled={busy} onClick={() => setRemoving(null)}>{t('cancel')}</Button></> : <>
              {account.id !== status.activeId && <Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'select', id: account.id }) }}>{t('select')}</Button>}
              <Button size="sm" disabled={busy} onClick={() => edit(account)}>{t('edit')}</Button>
              <Button size="sm" disabled={busy} onClick={() => setRemoving(account.id)}>{t('remove')}</Button>
            </>}
          </div>
        </div>)}
        {form && <form className="cac-form" autoComplete="off" onSubmit={event => {
          event.preventDefault()
          void perform({ action: 'save', ...(form.id ? { id: form.id } : {}), label: form.label, ak: form.ak, sk: form.sk }).then(ok => { if (ok) setForm(null) })
        }}>
          <h4>{t(form.id ? 'edit' : 'add')}</h4>
          <label htmlFor={`${formId}-name`}>{t('name')}</label><Input id={`${formId}-name`} value={form.label} maxLength={100} required disabled={busy} onChange={e => setForm({ ...form, label: e.target.value })}/>
          <label htmlFor={`${formId}-ak`}>{t('ak')}</label><Input id={`${formId}-ak`} type="password" value={form.ak} autoComplete="new-password" spellCheck={false} required={!form.id} disabled={busy} placeholder={form.id ? t('keep') : ''} onChange={e => setForm({ ...form, ak: e.target.value })}/>
          <label htmlFor={`${formId}-sk`}>{t('sk')}</label><Input id={`${formId}-sk`} type="password" value={form.sk} autoComplete="new-password" spellCheck={false} required={!form.id} disabled={busy} placeholder={form.id ? t('keep') : ''} onChange={e => setForm({ ...form, sk: e.target.value })}/>
          <div className="cac-actions"><Button type="submit" variant="primary" disabled={busy}>{t('save')}</Button><Button type="button" disabled={busy} onClick={() => setForm(null)}>{t('cancel')}</Button></div>
        </form>}
      </section>
      {!active ? <p>{t('choose')}</p> : <>
        <section className="cac-section" aria-labelledby={`${formId}-models`}>
          <div className="cac-heading"><h3 id={`${formId}-models`}>{t('models')} · {active.label}</h3><Button size="sm" disabled={busy} onClick={() => { void perform({ action: 'refresh', accountId: active.id }) }}>{t('refresh')}</Button></div>
          <p className="cac-muted">{t('modelHint')}</p>
          {status.catalog.error && <p role="alert" className="cac-error">{status.catalog.error}</p>}
          {status.catalog.fetchedAt !== undefined && <p className="cac-muted">{t('cached')}: {new Date(status.catalog.fetchedAt).toLocaleString()}</p>}
          {!status.catalog.models.length && <p className="cac-muted">{t('noModels')}</p>}
          {status.catalog.models.map(model => <div className="cac-row" key={model.id}><div><strong>{model.name}</strong><div className="cac-muted cac-model-id">{model.id}</div></div><span className="cac-muted">{t('context')} {model.contextWindow.toLocaleString()} · {t('output')} {model.maxTokens.toLocaleString()} · {t(model.supportsImages ? 'images' : 'text')}</span></div>)}
          {status.catalog.issues.map((issue, i) => <p className="cac-muted" key={i}>{issue}</p>)}
        </section>
      </>}
    </>}
  </div>
}

export function ProviderCard({ t }: { t: Translate }) {
  const { status, error } = useStatus()
  const active = status?.accounts.find(a => a.id === status.activeId)
  return <div className="cac-provider"><strong>CodeArts</strong><p>{active?.label ?? t('choose')}</p>{status && <p>{t('modelCount')}: {status.catalog.models.length}</p>}<p className="cac-muted">{t('manage')}</p>{error && <p role="alert" className="cac-error">{error}</p>}</div>
}
