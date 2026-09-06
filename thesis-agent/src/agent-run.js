import { randomUUID } from 'node:crypto'

const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'budget_exceeded', 'needs_user_material'])

const AUTO_SKIP_EVENTS = {
  planning: 'plan_ready',
  awaiting_plan_confirmation: 'plan_confirmed',
  applying: 'apply_completed',
}

const MODE_PRESETS = {
  full: [],
  standard: ['planning', 'awaiting_plan_confirmation'],
  fast: ['planning', 'awaiting_plan_confirmation', 'applying'],
}

const EVENTS = {
  created: { start: 'planning' },
  planning: { plan_ready: 'awaiting_plan_confirmation' },
  awaiting_plan_confirmation: { plan_confirmed: 'retrieving', plan_rejected: 'cancelled' },
  retrieving: { retrieval_completed: 'evaluating_evidence', fail: 'failed' },
  evaluating_evidence: { evidence_sufficient: 'drafting', evidence_insufficient: 'retrieving' },
  drafting: { draft_completed: 'validating', fail: 'failed' },
  validating: { validation_passed: 'reviewing', validation_failed: 'drafting' },
  reviewing: { review_completed: 'awaiting_user_decision', fail: 'failed' },
  awaiting_user_decision: { user_accepted: 'applying', user_requested_revision: 'drafting', user_rejected: 'cancelled' },
  applying: { apply_completed: 'completed', fail: 'failed' },
}

export function getValidEvents(state) {
  const transitions = EVENTS[state]
  if (!transitions) return []
  return Object.keys(transitions)
}

// Recommended main-path event for each state (eliminates LLM guessing)
const RECOMMENDED_EVENTS = {
  created: 'start',
  planning: 'plan_ready',
  awaiting_plan_confirmation: 'plan_confirmed',
  retrieving: 'retrieval_completed',
  evaluating_evidence: 'evidence_sufficient',
  drafting: 'draft_completed',
  validating: 'validation_passed',
  reviewing: 'review_completed',
  awaiting_user_decision: 'user_accepted',
  applying: 'apply_completed',
}

export function getRecommendedNextEvent(state) {
  if (TERMINAL.has(state) || state === 'paused') return null
  return RECOMMENDED_EVENTS[state] || null
}

export function getEventGuidance(state) {
  const recommended = getRecommendedNextEvent(state)
  const valid = getValidEvents(state)
  if (!recommended) return { state, terminal: TERMINAL.has(state), paused: state === 'paused', validEvents: valid, recommendedNextEvent: null, guidance: 'Run is in terminal or paused state — no further advancement possible.' }
  return {
    state,
    validEvents: valid,
    recommendedNextEvent: recommended,
    guidance: `From state "${state}", call thesis_advance_agent_run with event="${recommended}" (expectedRevision from this response). Do NOT invent event names — only use recommendedNextEvent or one of validEvents.`,
  }
}

export const STATE_EVENT_TABLE = `状态机合法事件对照表：
- created → start → planning
- planning → plan_ready → awaiting_plan_confirmation
- awaiting_plan_confirmation → plan_confirmed → retrieving | plan_rejected → cancelled
- retrieving → retrieval_completed → evaluating_evidence | fail → failed
- evaluating_evidence → evidence_sufficient → drafting | evidence_insufficient → retrieving
- drafting → draft_completed → validating | fail → failed
- validating → validation_passed → reviewing | validation_failed → drafting
- reviewing → review_completed → awaiting_user_decision | fail → failed
- awaiting_user_decision → user_accepted → applying | user_requested_revision → drafting | user_rejected → cancelled
- applying → apply_completed → completed | fail → failed
控制操作（不经过 advance）：pause / resume / cancel`

export function createAgentRun(project, input = {}) {
  const timestamp = new Date().toISOString()
  const mode = input.mode || 'standard'
  const skipStages = Array.isArray(input.skipStages)
    ? input.skipStages.filter((s) => AUTO_SKIP_EVENTS[s])
    : (MODE_PRESETS[mode] || [])
  return {
    id: randomUUID(), taskType: input.taskType || 'generate_thesis',
    mode, skipStages,
    scope: input.scope || { type: 'full', outlineNodeIds: project.outline.map((item) => item.id) },
    state: 'created', resumeState: null, revision: 0, reviewEnabled: input.reviewEnabled !== false,
    basePlanningRevision: project.planningRevision, baseManuscriptRevision: project.manuscriptRevision,
    budget: {
      maxSteps: Math.max(1, Number(input.budget?.maxSteps || 30)),
      maxRetrievalAttempts: Math.max(1, Number(input.budget?.maxRetrievalAttempts || 3)),
      maxRevisionAttempts: Math.max(0, Number(input.budget?.maxRevisionAttempts ?? 2)),
      usedSteps: 0, retrievalAttempts: 0, revisionAttempts: 0,
    },
    steps: [], observations: [], artifacts: [], error: null, createdAt: timestamp, updatedAt: timestamp,
  }
}

export function advanceAgentRun(run, input = {}) {
  if (Number(input.expectedRevision) !== run.revision) throw new Error(`Agent run revision conflict: expected ${input.expectedRevision}, current ${run.revision}`)
  if (TERMINAL.has(run.state) || run.state === 'paused') throw new Error(`Agent run cannot advance from ${run.state}`)
  const event = String(input.event || '')
  let next = EVENTS[run.state]?.[event]
  if (!next) {
    const valid = getValidEvents(run.state)
    throw new Error(`Invalid Agent run event "${event}" from state "${run.state}". Valid events from "${run.state}": ${valid.join(', ') || '(none — terminal or paused state)'}. Use thesis_get_agent_run to see the current state and validEvents field.`)
  }
  if (run.budget.usedSteps >= run.budget.maxSteps) next = 'budget_exceeded'
  if (run.state === 'evaluating_evidence' && event === 'evidence_insufficient') {
    run.budget.retrievalAttempts += 1
    if (run.budget.retrievalAttempts >= run.budget.maxRetrievalAttempts) next = 'needs_user_material'
  }
  if ((run.state === 'validating' && event === 'validation_failed') || (run.state === 'awaiting_user_decision' && event === 'user_requested_revision')) {
    run.budget.revisionAttempts += 1
    if (run.budget.revisionAttempts > run.budget.maxRevisionAttempts) next = 'budget_exceeded'
  }
  if (run.state === 'validating' && event === 'validation_passed' && !run.reviewEnabled) next = 'awaiting_user_decision'
  const timestamp = new Date().toISOString()
  run.steps.push({ id: randomUUID(), index: run.steps.length, from: run.state, event, to: next, status: 'completed', summary: String(input.summary || ''), createdAt: timestamp })
  if (input.observation) run.observations.push({ id: randomUUID(), state: run.state, type: input.observation.type || event, result: input.observation.result || '', reasonCodes: input.observation.reasonCodes || [], createdAt: timestamp })
  if (input.artifactId && !run.artifacts.includes(input.artifactId)) run.artifacts.push(input.artifactId)
  run.state = next; run.budget.usedSteps += 1; run.revision += 1; run.updatedAt = timestamp
  if (event === 'fail') run.error = { message: String(input.summary || 'Agent step failed'), createdAt: timestamp }
  // Auto-skip configured stages (audit trail preserved as skipped steps)
  const skipStages = run.skipStages || []
  while (skipStages.includes(run.state) && AUTO_SKIP_EVENTS[run.state] && !TERMINAL.has(run.state)) {
    const autoEvent = AUTO_SKIP_EVENTS[run.state]
    const autoNext = EVENTS[run.state]?.[autoEvent]
    if (!autoNext) break
    const ts = new Date().toISOString()
    run.steps.push({
      id: randomUUID(), index: run.steps.length,
      from: run.state, event: 'skipped', to: autoNext,
      status: 'completed', summary: `Stage "${run.state}" auto-skipped by configuration (via ${autoEvent})`,
      createdAt: ts,
    })
    run.state = autoNext
    run.budget.usedSteps += 1
    run.revision += 1
    run.updatedAt = ts
  }
  return run
}

export function pauseAgentRun(run, expectedRevision) {
  if (Number(expectedRevision) !== run.revision) throw new Error(`Agent run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
  if (TERMINAL.has(run.state) || run.state === 'paused') throw new Error(`Agent run cannot pause from ${run.state}`)
  run.resumeState = run.state; run.state = 'paused'; run.revision += 1; run.updatedAt = new Date().toISOString(); return run
}

export function resumeAgentRun(run, expectedRevision) {
  if (Number(expectedRevision) !== run.revision) throw new Error(`Agent run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
  if (run.state !== 'paused' || !run.resumeState) throw new Error('Agent run is not paused')
  run.state = run.resumeState; run.resumeState = null; run.revision += 1; run.updatedAt = new Date().toISOString(); return run
}

export function cancelAgentRun(run, expectedRevision) {
  if (Number(expectedRevision) !== run.revision) throw new Error(`Agent run revision conflict: expected ${expectedRevision}, current ${run.revision}`)
  if (TERMINAL.has(run.state)) throw new Error(`Agent run cannot cancel from ${run.state}`)
  run.resumeState = null; run.state = 'cancelled'; run.revision += 1; run.updatedAt = new Date().toISOString(); return run
}
