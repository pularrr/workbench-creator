import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentRun, advanceAgentRun, getValidEvents, STATE_EVENT_TABLE } from '../src/agent-run.js'

test('getValidEvents returns correct events for each state', () => {
  assert.deepEqual(getValidEvents('created'), ['start'])
  assert.deepEqual(getValidEvents('planning'), ['plan_ready'])
  assert.deepEqual(getValidEvents('awaiting_plan_confirmation'), ['plan_confirmed', 'plan_rejected'])
  assert.deepEqual(getValidEvents('retrieving'), ['retrieval_completed', 'fail'])
  assert.deepEqual(getValidEvents('evaluating_evidence'), ['evidence_sufficient', 'evidence_insufficient'])
  assert.deepEqual(getValidEvents('drafting'), ['draft_completed', 'fail'])
  assert.deepEqual(getValidEvents('validating'), ['validation_passed', 'validation_failed'])
  assert.deepEqual(getValidEvents('reviewing'), ['review_completed', 'fail'])
  assert.deepEqual(getValidEvents('awaiting_user_decision'), ['user_accepted', 'user_requested_revision', 'user_rejected'])
  assert.deepEqual(getValidEvents('applying'), ['apply_completed', 'fail'])
  assert.deepEqual(getValidEvents('completed'), [])
  assert.deepEqual(getValidEvents('cancelled'), [])
})

test('full happy-path state machine advances correctly', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  let run = createAgentRun(project, { mode: 'full', reviewEnabled: true })
  assert.equal(run.state, 'created')
  const events = [
    ['start', 'planning'],
    ['plan_ready', 'awaiting_plan_confirmation'],
    ['plan_confirmed', 'retrieving'],
    ['retrieval_completed', 'evaluating_evidence'],
    ['evidence_sufficient', 'drafting'],
    ['draft_completed', 'validating'],
    ['validation_passed', 'reviewing'],
    ['review_completed', 'awaiting_user_decision'],
    ['user_accepted', 'applying'],
    ['apply_completed', 'completed'],
  ]
  for (const [event, expectedState] of events) {
    run = advanceAgentRun(run, { expectedRevision: run.revision, event, summary: `step ${event}` })
    assert.equal(run.state, expectedState, `event ${event} should lead to ${expectedState}`)
  }
  assert.equal(run.budget.usedSteps, events.length)
  assert.equal(run.steps.length, events.length)
})

test('invalid event from planning throws with valid events in message', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  let run = createAgentRun(project, { mode: 'full' })
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'start' })
  assert.equal(run.state, 'planning')
  assert.throws(
    () => advanceAgentRun(run, { expectedRevision: run.revision, event: 'plan' }),
    (err) => {
      assert.ok(err.message.includes('Invalid Agent run event'))
      assert.ok(err.message.includes('planning'))
      assert.ok(err.message.includes('plan_ready'))
      return true
    },
  )
})

test('STATE_EVENT_TABLE is exported and non-empty', () => {
  assert.ok(typeof STATE_EVENT_TABLE === 'string')
  assert.ok(STATE_EVENT_TABLE.includes('planning'))
  assert.ok(STATE_EVENT_TABLE.includes('plan_ready'))
})

test('standard mode auto-skips planning and awaiting_plan_confirmation', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  let run = createAgentRun(project, { mode: 'standard' })
  assert.deepEqual(run.skipStages, ['planning', 'awaiting_plan_confirmation'])
  assert.equal(run.state, 'created')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'start' })
  // After start: created → planning (auto-skip) → awaiting_plan_confirmation (auto-skip) → retrieving
  assert.equal(run.state, 'retrieving')
  assert.equal(run.budget.usedSteps, 3) // start + 2 skipped
  assert.equal(run.steps.length, 3)
  assert.equal(run.steps[1].event, 'skipped')
  assert.equal(run.steps[2].event, 'skipped')
  assert.ok(run.steps[1].summary.includes('planning'))
  assert.ok(run.steps[2].summary.includes('awaiting_plan_confirmation'))
})

test('fast mode auto-skips planning, awaiting_plan_confirmation, and applying', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  let run = createAgentRun(project, { mode: 'fast', reviewEnabled: false })
  assert.equal(run.skipStages.length, 3)
  // Fast-forward through all stages to verify applying is skipped
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'start' })
  assert.equal(run.state, 'retrieving')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'retrieval_completed' })
  assert.equal(run.state, 'evaluating_evidence')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'evidence_sufficient' })
  assert.equal(run.state, 'drafting')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'draft_completed' })
  assert.equal(run.state, 'validating')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'validation_passed' })
  // reviewEnabled=false → awaiting_user_decision
  assert.equal(run.state, 'awaiting_user_decision')
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'user_accepted' })
  // user_accepted → applying (auto-skip) → completed
  assert.equal(run.state, 'completed')
  const skippedSteps = run.steps.filter((s) => s.event === 'skipped')
  assert.equal(skippedSteps.length, 3) // planning, awaiting_plan_confirmation, applying
})

test('full mode does not skip any stages', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  let run = createAgentRun(project, { mode: 'full' })
  assert.deepEqual(run.skipStages, [])
  run = advanceAgentRun(run, { expectedRevision: run.revision, event: 'start' })
  assert.equal(run.state, 'planning') // not auto-skipped
  assert.equal(run.budget.usedSteps, 1)
})

test('custom skipStages overrides mode and filters invalid stages', () => {
  const project = { outline: [{ id: 'o1' }], planningRevision: 0, manuscriptRevision: 0 }
  const run = createAgentRun(project, { mode: 'full', skipStages: ['planning', 'invalid_stage', 'applying'] })
  // invalid_stage is filtered out
  assert.deepEqual(run.skipStages, ['planning', 'applying'])
})
