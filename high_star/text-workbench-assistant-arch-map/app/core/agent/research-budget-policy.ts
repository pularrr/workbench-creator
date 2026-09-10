import type { TaskProfile } from "../../plugin/contracts/task-profile";

export interface ApprovedResearchBudget {
  durationMinutes: [number, number];
  visitTopicCount: [number, number];
  maxModelCalls: number;
}

export const DEFAULT_APPROVED_RESEARCH_BUDGET: ApprovedResearchBudget = {
  durationMinutes: [25, 35], visitTopicCount: [80, 300], maxModelCalls: 4096,
};

function validPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item)) && value[0] >= 0 && value[0] <= value[1];
}

export function parseApprovedResearchBudget(value: unknown): ApprovedResearchBudget {
  const input = value as Partial<ApprovedResearchBudget> | undefined;
  const maxModelCalls = input?.maxModelCalls;
  if (!input || !validPair(input.durationMinutes) || !validPair(input.visitTopicCount) || typeof maxModelCalls !== "number" || !Number.isInteger(maxModelCalls) || maxModelCalls <= 0) {
    throw new Error("approvedBudget 必须包含合法的 durationMinutes、visitTopicCount 和 maxModelCalls");
  }
  return { durationMinutes: [...input.durationMinutes] as [number, number], visitTopicCount: [...input.visitTopicCount] as [number, number], maxModelCalls };
}

export function budgetFromProfile(profile: TaskProfile): ApprovedResearchBudget {
  const full = profile.initialization.full;
  return {
    durationMinutes: [...full.rootBudgetMinutes] as [number, number],
    visitTopicCount: [...(full.visitTopicCount ?? DEFAULT_APPROVED_RESEARCH_BUDGET.visitTopicCount)] as [number, number],
    maxModelCalls: full.maxModelCalls ?? DEFAULT_APPROVED_RESEARCH_BUDGET.maxModelCalls,
  };
}

/** Returns a new Profile whose executable full budget is exactly the user-approved budget. */
export function applyApprovedBudget(profile: TaskProfile, approved: ApprovedResearchBudget): TaskProfile {
  const budget = parseApprovedResearchBudget(approved);
  return { ...profile, initialization: { ...profile.initialization, full: {
    ...profile.initialization.full,
    rootBudgetMinutes: budget.durationMinutes,
    durationMinutes: budget.durationMinutes,
    visitTopicCount: budget.visitTopicCount,
    maxModelCalls: budget.maxModelCalls,
  } } };
}

export function profileMatchesApprovedBudget(profile: TaskProfile, approved: ApprovedResearchBudget): boolean {
  const actual = budgetFromProfile(profile); const expected = parseApprovedResearchBudget(approved);
  return actual.durationMinutes[0] === expected.durationMinutes[0] && actual.durationMinutes[1] === expected.durationMinutes[1]
    && actual.visitTopicCount[0] === expected.visitTopicCount[0] && actual.visitTopicCount[1] === expected.visitTopicCount[1]
    && actual.maxModelCalls === expected.maxModelCalls;
}
