import { randomUUID } from 'node:crypto'

/**
 * Generic configurable state machine for text-generation workbench runs.
 * Abstracted from the thesis 13-state machine; each task-type plugin defines
 * its own state/event table via the Framework plugin.
 */

const TERMINAL_STATES = new Set(['completed', 'cancelled', 'failed', 'budget_exceeded', 'needs_user_material'])

export function isTerminal(state) {
  return TERMINAL_STATES.has(state)
}

/**
 * Build a state machine from a plugin-defined state table.
 * @param {Object} stateTable - { state: { event: nextState, ... }, ... }
 * @returns {Object} { getValidEvents, advance, getRecommendedEvent }
 */
export function createStateMachine(stateTable) {
  const table = { ...stateTable }

  function getValidEvents(state) {
    const transitions = table[state]
    if (!transitions) return []
    return Object.keys(transitions)
  }

  function getRecommendedEvent(state) {
    // Recommend the first non-fail, non-rejection event as the main path
    const events = getValidEvents(state)
    if (events.length === 0) return null
    const mainPath = events.find((e) => !['fail', 'plan_rejected', 'user_rejected', 'evidence_insufficient', 'validation_failed', 'user_requested_revision'].includes(e))
    return mainPath || events[0]
  }

  function getEventGuidance(state) {
    const recommended = getRecommendedEvent(state)
    const valid = getValidEvents(state)
    if (isTerminal(state) || state === 'paused') {
      return { state, terminal: isTerminal(state), paused: state === 'paused', validEvents: valid, recommendedNextEvent: null, guidance: 'Run is in terminal or paused state — no further advancement possible.' }
    }
    return {
      state,
      validEvents: valid,
      recommendedNextEvent: recommended,
      guidance: `From state "${state}", advance with event="${recommended}". Do NOT invent event names — only use recommendedNextEvent or one of validEvents.`,
    }
  }

  function advance(run, input = {}) {
    if (Number(input.expectedRevision) !== run.revision) {
      throw new Error(`Run revision conflict: expected ${input.expectedRevision}, current ${run.revision}`)
    }
    if (isTerminal(run.state) || run.state === 'paused') {
      throw new Error(`Run cannot advance from ${run.state}`)
    }
    const event = String(input.event || '')
    let next = table[run.state]?.[event]
    if (!next) {
      const valid = getValidEvents(run.state)
      throw new Error(`Invalid run event "${event}" from state "${run.state}". Valid events: ${valid.join(', ') || '(none)'}. Use getRun to see current state and recommendedNextEvent.`)
    }
    if (run.budget.usedSteps >= run.budget.maxSteps) next = 'budget_exceeded'
    const timestamp = new Date().toISOString()
    run.steps.push({ id: randomUUID(), index: run.steps.length, from: run.state, event, to: next, status: 'completed', summary: String(input.summary || ''), createdAt: timestamp })
    if (input.observation) {
      run.observations.push({ id: randomUUID(), state: run.state, type: input.observation.type || event, result: input.observation.result || '', reasonCodes: input.observation.reasonCodes || [], createdAt: timestamp })
    }
    if (input.artifactId && !run.artifacts.includes(input.artifactId)) run.artifacts.push(input.artifactId)
    run.state = next
    run.budget.usedSteps += 1
    run.revision += 1
    run.updatedAt = timestamp
    if (event === 'fail') run.error = { message: String(input.summary || 'Run step failed'), createdAt: timestamp }
    // Auto-skip configured stages
    const skipStages = run.skipStages || []
    while (skipStages.includes(run.state) && table[run.state] && getRecommendedEvent(run.state) && !isTerminal(run.state)) {
      const autoEvent = getRecommendedEvent(run.state)
      const autoNext = table[run.state]?.[autoEvent]
      if (!autoNext) break
      const ts = new Date().toISOString()
      run.steps.push({ id: randomUUID(), index: run.steps.length, from: run.state, event: 'skipped', to: autoNext, status: 'completed', summary: `Stage "${run.state}" auto-skipped by configuration (via ${autoEvent})`, createdAt: ts })
      run.state = autoNext
      run.budget.usedSteps += 1
      run.revision += 1
      run.updatedAt = ts
    }
    return run
  }

  function pause(run, expectedRevision) {
    if (Number(expectedRevision) !== run.revision) throw new Error(`Run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
    if (isTerminal(run.state) || run.state === 'paused') throw new Error(`Run cannot pause from ${run.state}`)
    run.resumeState = run.state
    run.state = 'paused'
    run.revision += 1
    run.updatedAt = new Date().toISOString()
    return run
  }

  function resume(run, expectedRevision) {
    if (Number(expectedRevision) !== run.revision) throw new Error(`Run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
    if (run.state !== 'paused' || !run.resumeState) throw new Error('Run is not paused')
    run.state = run.resumeState
    run.resumeState = null
    run.revision += 1
    run.updatedAt = new Date().toISOString()
    return run
  }

  function cancel(run, expectedRevision) {
    if (Number(expectedRevision) !== run.revision) throw new Error(`Run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
    if (isTerminal(run.state)) throw new Error(`Run cannot cancel from ${run.state}`)
    run.resumeState = null
    run.state = 'cancelled'
    run.revision += 1
    run.updatedAt = new Date().toISOString()
    return run
  }

  function createRun(input = {}) {
    const timestamp = new Date().toISOString()
    return {
      id: randomUUID(),
      taskType: input.taskType || 'generic',
      mode: input.mode || 'standard',
      skipStages: Array.isArray(input.skipStages) ? input.skipStages : [],
      scope: input.scope || { type: 'full' },
      state: 'created',
      resumeState: null,
      revision: 0,
      reviewEnabled: input.reviewEnabled !== false,
      budget: {
        maxSteps: Math.max(1, Number(input.budget?.maxSteps || 30)),
        usedSteps: 0,
        retrievalAttempts: 0,
        revisionAttempts: 0,
      },
      steps: [],
      observations: [],
      artifacts: [],
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  return { createRun, advance, pause, resume, cancel, getValidEvents, getRecommendedEvent, getEventGuidance, isTerminal, stateTable: table }
}
