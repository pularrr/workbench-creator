/**
 * Lossless-JSON boundary guard for the DSH tool bridge.
 *
 * The Harness rejects any tool result that cannot round-trip through JSON
 * ("value is not lossless JSON"). This module guarantees the boundary:
 *   - non-finite numbers (NaN / ±Infinity) and -0 are replaced with 0
 *   - `undefined` values / keys are removed
 *   - functions / symbols / bigints are removed
 *   - non-plain objects (class instances, Map/Set, …) and circular references
 *     are removed (returned as `undefined`, then dropped by the parent)
 *   - arrays are rebuilt densely so sparse / decorated arrays stay lossless
 */
export function toLosslessJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (Number.isFinite(value) && !Object.is(value, -0)) return value
    return 0
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined
  }
  if (typeof value !== 'object') return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return undefined
      const out = []
      for (let index = 0; index < value.length; index += 1) {
        const item = toLosslessJson(value[index], seen)
        if (item !== undefined) out.push(item)
      }
      return out
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return undefined
    const out = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) continue
      const item = toLosslessJson(value[key], seen)
      if (item !== undefined) out[key] = item
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/**
 * Strict lossless-JSON check mirroring the Harness boundary (walkJsonValue).
 * Used by tests / diagnostics to prove an output is bridge-safe.
 */
export function isLosslessJson(value) {
  const ancestors = new Set()
  const tasks = [{ kind: 'visit', value }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'leave') { ancestors.delete(task.source); continue }
    if (task.kind === 'array-item') {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return false
      tasks.push({ kind: 'visit', value: task.source[task.index] })
      continue
    }
    if (task.kind === 'object-property') {
      tasks.push({ kind: 'visit', value: task.source[task.key] })
      continue
    }
    const current = task.value
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return false
      continue
    }
    if (typeof current !== 'object') return false
    if (ancestors.has(current)) return false
    if (Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Array.prototype) return false
      if (Reflect.ownKeys(current).length !== current.length + 1) return false
      ancestors.add(current)
      tasks.push({ kind: 'leave', source: current })
      for (let index = current.length - 1; index >= 0; index -= 1) tasks.push({ kind: 'array-item', source: current, index })
      continue
    }
    const proto = Object.getPrototypeOf(current)
    if (proto !== Object.prototype && proto !== null) return false
    const keys = Reflect.ownKeys(current)
    if (keys.some((key) => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(current, key))) return false
    ancestors.add(current)
    tasks.push({ kind: 'leave', source: current })
    for (let index = keys.length - 1; index >= 0; index -= 1) tasks.push({ kind: 'object-property', source: current, key: keys[index] })
  }
  return true
}
