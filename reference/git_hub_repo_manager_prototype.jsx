import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export default function GitHubRepoManagerApp() {
  const [user, setUser] = useState(null)
  const [repos, setRepos] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [org, setOrg] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(30)
  const [totalPages, setTotalPages] = useState(null)
  const [isPerforming, setIsPerforming] = useState(false)
  const [results, setResults] = useState([])
  const headerCheckboxRef = useRef(null)
  const DEV_MOCK = typeof window !== 'undefined' && (window.__REACT_APP_DEV_MOCK === '1' || window.localStorage.getItem('REACT_APP_DEV_MOCK') === '1')

  useEffect(() => {
    if (DEV_MOCK) {
      const mockUser = { login: 'dev-user' }
      const mockRepos = Array.from({ length: 17 }).map((_, i) => ({
        id: i + 1,
        name: `project-${i + 1}`,
        full_name: `dev-user/project-${i + 1}`,
        fork: i % 2 === 0,
        private: i % 3 === 0,
        owner: { login: 'dev-user' },
        html_url: `https://github.com/dev-user/project-${i + 1}`
      }))
      setUser(mockUser)
      setRepos(mockRepos)
      setTotalPages(1)
      return
    }
    fetchUser()
  }, [])

  useEffect(() => {
    if (!DEV_MOCK) fetchRepos(page, perPage)
  }, [page, perPage])

  const safeParseJson = useCallback(async (response) => {
    const ct = response && response.headers && response.headers.get ? response.headers.get('content-type') || '' : ''
    if (ct.includes('application/json') || ct.includes('application/vnd.github')) {
      try {
        return await response.json()
      } catch (err) {
        const txt = await response.text()
        throw new Error('Invalid JSON: ' + (txt ? txt.slice(0, 500) : 'empty'))
      }
    }
    const text = await response.text()
    return { __rawText: text, __contentType: ct }
  }, [])

  async function fetchUser() {
    setLoading(true)
    try {
      const r = await fetch('/api/user', { credentials: 'include' })
      if (!r.ok) {
        setUser(null)
        setMessage('Não autenticado. Clica em "Login with GitHub" para autorizar.')
        setLoading(false)
        return
      }
      const parsed = await safeParseJson(r)
      if (parsed && parsed.__rawText) {
        setUser(null)
        setMessage('Resposta inesperada do servidor ao obter o utilizador. Faz login novamente.')
        setLoading(false)
        return
      }
      setUser(parsed)
      setMessage('')
      await fetchRepos(1, perPage)
    } catch (e) {
      console.error('fetchUser', e)
      setMessage('Erro ao obter utilizador: ' + (e.message || e))
    } finally {
      setLoading(false)
    }
  }

  async function fetchRepos(pageToLoad = 1, per = 30) {
    setLoading(true)
    try {
      const url = `/api/repos?page=${pageToLoad}&per_page=${per}`
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) {
        const ct = r.headers && r.headers.get ? r.headers.get('content-type') || '' : ''
        const text = await r.text()
        if (ct.includes('text/html') || text.trim().startsWith('<')) {
          setMessage('Resposta HTML recebida do servidor — possivelmente login necessário. Clica em "Login with GitHub".')
        } else if (r.status === 401) {
          setMessage('Não autorizado (401). Faz login novamente.')
        } else {
          setMessage('Erro ao obter repositórios: ' + r.status)
        }
        setRepos([])
        setLoading(false)
        return
      }
      const parsed = await safeParseJson(r)
      if (parsed && parsed.__rawText) {
        setMessage('Resposta inesperada do servidor ao obter repositórios. Verifica o backend ou faz login.')
        setRepos([])
        setLoading(false)
        return
      }
      setRepos(parsed || [])
      setMessage('')
      setPage(pageToLoad)
      setPerPage(per)
      setTotalPages(null)
      const link = r.headers && r.headers.get ? r.headers.get('link') : null
      if (link) {
        const parsedTotal = parseLinkHeaderTotal(link)
        if (parsedTotal) setTotalPages(parsedTotal)
      }
    } catch (e) {
      console.error('fetchRepos', e)
      setMessage('Erro ao obter repositórios: ' + (e.message || e))
      setRepos([])
    } finally {
      setLoading(false)
    }
  }

  function parseLinkHeaderTotal(linkHeader) {
    try {
      const parts = linkHeader.split(',').map(p => p.trim())
      let last = null
      for (const p of parts) {
        const m = p.match(/<([^>]+)>;\s*rel="([^"]+)"/)
        if (m) {
          const url = m[1]
          const rel = m[2]
          if (rel === 'last') last = url
        }
      }
      if (!last) return null
      const u = new URL(last)
      const pnum = u.searchParams.get('page')
      return pnum ? parseInt(pnum, 10) : null
    } catch { return null }
  }

  useEffect(() => {
    const header = headerCheckboxRef.current
    if (!header) return
    const totalRows = repos.length
    const selectedCount = Array.from(selectedIds).filter(id => repos.some(r => r.id === id)).length
    header.indeterminate = selectedCount > 0 && selectedCount < totalRows
    header.checked = totalRows > 0 && selectedCount === totalRows
  }, [repos, selectedIds])

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const copy = new Set(prev)
      if (copy.has(id)) copy.delete(id)
      else copy.add(id)
      return copy
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedIds(prev => {
      const copy = new Set(prev)
      repos.forEach(r => copy.add(r.id))
      return copy
    })
  }, [repos])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  async function performAction(action, items = null) {
    const targets = items || Array.from(selectedIds)
    if (!targets || targets.length === 0) return setMessage('Seleciona pelo menos 1 repositório')
    setIsPerforming(true)
    setMessage('A processar...')
    try {
      const body = { repos: (items ? items.map(full => full) : Array.from(selectedIds).map(id => {
        const r = repos.find(x => x.id === id)
        return r ? r.full_name : null
      }).filter(Boolean)), toOrg: org }
      const resp = await fetch(`/api/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!resp.ok) {
        const ct = resp.headers && resp.headers.get ? resp.headers.get('content-type') || '' : ''
        const txt = await resp.text()
        setMessage(ct.includes('application/json') ? (JSON.parse(txt).message || `Erro: ${resp.status}`) : `Erro do servidor: ${resp.status} — ${txt.slice(0, 400)}`)
        setIsPerforming(false)
        return
      }
      const parsed = await safeParseJson(resp)
      const msg = parsed && parsed.message ? parsed.message : 'Operação iniciada. Verifica histórico/console.'
      setMessage(msg)
      setResults(prev => [{ at: new Date().toISOString(), action, message: msg }, ...prev])
      await fetchRepos(page, perPage)
      clearSelection()
    } catch (e) {
      console.error('performAction', e)
      setMessage('Erro na operação: ' + (e.message || e))
    } finally {
      setIsPerforming(false)
    }
  }

  const quickMakePrivate = useCallback(async (repoFullName) => {
    await performAction('visibility', [repoFullName])
  }, [org, selectedIds, repos])

  const headerInfo = useMemo(() => ({ selectedCount: selectedIds.size, total: repos.length }), [selectedIds, repos])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 font-sans text-slate-900">
      <div className="max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold">GitHub Repo Manager</h1>
            <p className="text-sm text-slate-600 mt-1">Organiza, transfere e torna privados vários repositórios (forks e outros). Concebido para ser seguro e rápido.</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-700">{user ? <span>Logged in as <strong>{user.login}</strong></span> : <span className="text-slate-500">Not logged in</span>}</div>
            <div className="mt-2 flex gap-2">
              <a href="/api/auth/login" onClick={() => setMessage('A iniciar login...')} className="px-4 py-2 bg-white border border-slate-200 rounded shadow-sm text-sm hover:bg-slate-50">Login with GitHub</a>
              <button onClick={() => { setMessage('A verificar estado de login...'); fetchUser(); }} className="px-4 py-2 bg-slate-700 text-white rounded text-sm">Check</button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2 bg-white p-4 rounded-xl shadow">
            <div className="flex items-center gap-3 mb-3">
              <input value={org} onChange={e => setOrg(e.target.value)} placeholder="org destino (ex: my-org)" className="border rounded p-2 flex-1" />
              <button onClick={() => selectAllVisible()} className="px-3 py-2 rounded bg-slate-100">Select visible</button>
              <button onClick={() => clearSelection()} className="px-3 py-2 rounded bg-slate-100">Clear</button>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-600">
                    <th className="p-2 text-left w-8"><input ref={headerCheckboxRef} type="checkbox" onChange={(ev) => ev.target.checked ? selectAllVisible() : clearSelection()} /></th>
                    <th className="p-2 text-left">Repository</th>
                    <th className="p-2 text-left">Fork</th>
                    <th className="p-2 text-left">Visibility</th>
                    <th className="p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="p-6 text-center">Loading...</td></tr>
                  ) : repos.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center">No repositories found.</td></tr>
                  ) : repos.map(repo => (
                    <tr key={repo.id} className="border-t">
                      <td className="p-2"><input aria-label={`select-${repo.id}`} type="checkbox" checked={selectedIds.has(repo.id)} onChange={() => toggleSelect(repo.id)} /></td>
                      <td className="p-2 align-top">
                        <a href={repo.html_url} target="_blank" rel="noreferrer" className="font-medium text-slate-800">{repo.full_name}</a>
                        <div className="text-xs text-slate-500">Owner: {repo.owner && repo.owner.login}</div>
                      </td>
                      <td className="p-2 align-top">{repo.fork ? 'Yes' : 'No'}</td>
                      <td className="p-2 align-top">{repo.private ? 'Private' : 'Public'}</td>
                      <td className="p-2 align-top">
                        <div className="flex gap-2">
                          <button disabled={isPerforming} onClick={() => quickMakePrivate(repo.full_name)} className="px-2 py-1 rounded bg-amber-100 text-sm">Make private</button>
                          <button disabled={isPerforming} onClick={() => performAction('transfer', [repo.full_name])} className="px-2 py-1 rounded bg-sky-100 text-sm">Transfer</button>
                          <button disabled={isPerforming} onClick={() => performAction('mirror', [repo.full_name])} className="px-2 py-1 rounded bg-green-100 text-sm">Mirror</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>{headerInfo.selectedCount} selected</span>
                <span>|</span>
                <span>{repos.length} visible</span>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => { if (page > 1) setPage(p => p - 1) }} className="px-3 py-1 bg-white border rounded">Prev</button>
                <div className="px-3 py-1 bg-white border rounded">Page {page}{totalPages ? ` of ${totalPages}` : ''}</div>
                <button onClick={() => { setPage(p => p + 1) }} className="px-3 py-1 bg-white border rounded">Next</button>
                <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }} className="ml-2 border rounded p-1">
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

          <aside className="bg-white p-4 rounded-xl shadow space-y-4">
            <div>
              <h3 className="font-semibold">Quick actions</h3>
              <p className="text-sm text-slate-600">Use the buttons below to run bulk actions on selected repositories.</p>
            </div>

            <div className="flex flex-col gap-2">
              <button disabled={isPerforming} onClick={() => performAction('visibility')} className="w-full px-4 py-2 rounded bg-amber-600 text-white">Tornar privados</button>
              <button disabled={isPerforming} onClick={() => performAction('transfer')} className="w-full px-4 py-2 rounded bg-sky-600 text-white">Transferir selecionados</button>
              <button disabled={isPerforming} onClick={() => performAction('mirror')} className="w-full px-4 py-2 rounded bg-green-600 text-white">Mirror (independente)</button>
            </div>

            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium">Status</h4>
              <div className="text-sm text-slate-600 mt-2">{message || 'Pronto'}</div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium">Histórico</h4>
              <div className="max-h-36 overflow-auto text-xs text-slate-600 mt-2 space-y-2">
                {results.length === 0 ? <div className="text-slate-400">Nenhum histórico</div> : results.map((r, i) => (
                  <div key={i} className="border rounded p-2 bg-slate-50">{r.at} — {r.action} — {r.message}</div>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t">
              <h4 className="text-sm font-medium">Instruções</h4>
              <ol className="text-xs text-slate-600 mt-2 list-decimal ml-4 space-y-1">
                <li>Faz login com GitHub (o backend deve suportar OAuth e cookies de sessão).</li>
                <li>Seleciona os repositórios que queres gerir (ou usa 'Select visible').</li>
                <li>Define a org destino, se for transferir/mirror.</li>
                <li>Clica na ação desejada (Tornar privados, Transferir, Mirror).</li>
                <li>Verifica o histórico abaixo para confirmar operações.</li>
              </ol>
            </div>
          </aside>
        </section>

        <footer className="text-sm text-slate-500 mt-4">Backend requirements: Express server with session cookies, CORS allowing credentials, and endpoints: <code>/api/auth/login</code>, <code>/api/user</code>, <code>/api/repos</code>, <code>/api/visibility</code>, <code>/api/transfer</code>, <code>/api/mirror</code>. Ensure cookies are sent with <strong>credentials: 'include'</strong>.</footer>
      </div>
    </div>
  )
}
