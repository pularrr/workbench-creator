export interface ResearchTopic {
  id: string; name: string; parentId: string | null; fact: string; depth: number;
}

export interface TopicQueueState {
  queue: ResearchTopic[];
  queuedIds: string[];
  visitedIds: string[];
  expandedParentIds: string[];
}

export function createTopicQueue(initial: ResearchTopic): TopicQueueState {
  return { queue: [initial], queuedIds: [initial.id], visitedIds: [], expandedParentIds: [] };
}

export function dequeueTopic(state: TopicQueueState): ResearchTopic | undefined {
  const topic = state.queue.shift();
  if (topic) state.visitedIds.push(topic.id);
  return topic;
}

export function enqueueTopics(state: TopicQueueState, topics: readonly ResearchTopic[]): ResearchTopic[] {
  const known = new Set(state.queuedIds); const names = new Set<string>();
  const additions = topics.filter((topic) => {
    const name = topic.name.toLowerCase();
    if (known.has(topic.id) || names.has(name)) return false;
    known.add(topic.id); names.add(name); return true;
  });
  state.queuedIds.push(...additions.map((topic) => topic.id));
  state.queue.unshift(...additions);
  return additions;
}

export function markExpandedParent(state: TopicQueueState, topicId: string, hasChildren: boolean): void {
  if (hasChildren && !state.expandedParentIds.includes(topicId)) state.expandedParentIds.push(topicId);
}
