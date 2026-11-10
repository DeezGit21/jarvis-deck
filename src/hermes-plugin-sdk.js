// Minimal @hermes/plugin-sdk stub so the plugin UI renders standalone.
// Mirrors only the surface desktop/plugin.js uses: ROUTES_AREA,
// SIDEBAR_NAV_AREA, useQuery, useQueryClient, host, haptic, cn.
import { useEffect, useRef, useState } from 'react'

export const ROUTES_AREA = 'ROUTES_AREA'
export const SIDEBAR_NAV_AREA = 'SIDEBAR_NAV_AREA'

export function haptic(_kind) { /* no-op outside the desktop app */ }

export function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}

export const host = {
  notify(_n) { /* no-op */ },
  state: {},
}

// ------------------------------------------------------------ tiny react-query

const _entries = new Map() // id -> { state, data, error, queryFn }
const _subs = new Set()

function _notify() { for (const fn of _subs) { try { fn() } catch { /* ignore */ } } }

function _keyId(key) { return JSON.stringify(key) }

async function _fetch(id) {
  const e = _entries.get(id)
  if (!e || e.state === 'loading') return
  e.state = 'loading'
  _notify()
  try {
    e.data = await e.queryFn()
    e.error = null
    e.state = 'ok'
  } catch (err) {
    e.error = err
    e.state = 'error'
  }
  _notify()
}

export function useQueryClient() {
  return {
    invalidateQueries({ queryKey }) {
      const prefix = JSON.stringify(queryKey)
      for (const [id, e] of _entries) {
        if (id.startsWith(prefix)) { e.state = 'idle'; _fetch(id) }
      }
    },
  }
}

export function useQuery({ queryKey, queryFn, refetchInterval = 0 }) {
  const id = _keyId(queryKey)
  if (!_entries.has(id)) _entries.set(id, { state: 'idle', data: undefined, error: null, queryFn })
  const e = _entries.get(id)
  e.queryFn = queryFn
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force(v => v + 1)
    _subs.add(fn)
    return () => { _subs.delete(fn) }
  }, [])
  const started = useRef(false)
  useEffect(() => {
    if (!started.current) { started.current = true; _fetch(id) }
    if (refetchInterval) {
      const t = setInterval(() => _fetch(id), refetchInterval)
      return () => clearInterval(t)
    }
    return undefined
  }, [id])
  return {
    data: e.data,
    error: e.error,
    isLoading: e.state === 'loading',
    refetch: () => _fetch(id),
  }
}
