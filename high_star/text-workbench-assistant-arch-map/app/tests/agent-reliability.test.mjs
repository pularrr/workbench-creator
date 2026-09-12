import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({appType:"custom",configFile:false,root,resolve:{alias:{"@":root}},server:{middlewareMode:true,hmr:false}});
after(() => vite.close());
const output = await vite.ssrLoadModule("/server/agent/research-output.ts");
const build = await vite.ssrLoadModule("/server/agent/research-build.ts");
const { expandedKnowledgeDataset: dataset } = await vite.ssrLoadModule("/data/knowledge/deep-slices.ts");
const { applyOperations } = await vite.ssrLoadModule("/core/agent/graph-operations.ts");
const { datasetToAgentGraph, agentGraphToDataset } = await vite.ssrLoadModule("/core/knowledge/portable-bundle.ts");
const { toLegacyKnowledgeNodes } = await vite.ssrLoadModule("/features/knowledge-graph/model/knowledgeViewModel.ts");
const layout = await vite.ssrLoadModule("/features/knowledge-graph/layout/legacySvgLayout.ts");
const adaptive = await vite.ssrLoadModule("/server/agent/adaptive-research.ts");
const budgets = await vite.ssrLoadModule("/server/agent/research-budget.ts");
const response = (text) => ({id:"mock",provider:"test",model:"test",status:"completed",text,toolCalls:[],session:{previousResponseId:"mock"}});

test("JSON envelope, fences, aliases and optional nulls normalize without losing code or LaTeX", () => {
  const source = { data:{answer:"result",proposal:{new_nodes:[{id:"example",name:"例子",description:"定义",parent_id:"least-squares",blocks:[{type:"code",title:"实现",code:"x = solve(A, b)",language:"python",text:""}]}],card_blocks:[{node_id:"least-squares",type:"principle",title:"公式",content:"$\\hat{x}$"}],evidence:[{title:"领域资料",url:null}]}} };
  const parsed = output.normalizeResearch(output.parseObject("说明\n```json\n"+JSON.stringify(source)+"\n```"));
  assert.equal(parsed.proposal.newNodes[0].parentId,"least-squares");
  assert.equal(parsed.proposal.newNodes[0].blocks[0].code,"x = solve(A, b)");
  assert.equal(parsed.proposal.cardBlocks[0].text,"$\\hat{x}$");
});

test("malformed and truncated model output is repaired using the original result and concrete errors", async () => {
  const calls = [];
  const provider = {name:"test",async createResponse(request) {
    calls.push(request);
    return calls.length === 1 ? {...response('{"answer":"partial"'),status:"incomplete",incompleteReason:"max_output_tokens"} : response(JSON.stringify({answer:"保留知识",proposal:{}}));
  }};
  const result = await output.requestResearch(provider,"研究",[{role:"user",content:"LS"}]);
  assert.equal(calls.length,2);
  assert.match(calls[1].messages.at(-1).content,/截断/);
  assert.match(calls[1].messages.at(-1).content,/partial/);
  assert.equal(result.document.answer,"保留知识");
  await assert.rejects(output.requestResearch({name:"bad",createResponse:async()=>response("invalid")}, "", [{role:"user",content:"test"}]),/三次/);
});

test("max-token handling salvages only closed items and never materializes a half node", async () => {
  const complete = {id:"a",canonicalName:"完整节点",shortFact:"完整事实",parentId:"fmcw",blocks:[]};
  const text = '{"proposal":{"newNodes":[' + JSON.stringify(complete) + ',{"canonicalName":"未完成';
  assert.deepEqual(budgets.completeArrayObjects(text,"newNodes"),[complete]);
  const result = await output.requestResearch({name:"truncated",createResponse:async()=>({...response(text),status:"incomplete",incompleteReason:"max_output_tokens"})},"",[{role:"user",content:"test"}]);
  assert.equal(result.document.proposal.newNodes.length,1);
  assert.equal(result.document.converged,false);
  assert.ok(result.document.gaps.length>0);
});

test("output retries grow within provider cap and fit structured contexts without breaking JSON", async () => {
  const requests=[];
  const provider={name:"limited",limits:{maxOutputTokens:10000,maxInputChars:6000},createResponse:async(request)=>{
    requests.push(request);
    return requests.length===1 ? {...response(""),status:"incomplete",incompleteReason:"max_output_tokens",usage:{outputTokens:8192,reasoningTokens:8000}} : response('{"answer":"ok","proposal":{}}');
  }};
  await output.requestResearch(provider,"研究",[{role:"user",content:JSON.stringify({nodes:Array.from({length:100},(_,id)=>({id,text:"知识".repeat(500)}))})}]);
  assert.equal(requests[0].maxOutputTokens,8192);
  assert.equal(requests[1].maxOutputTokens,10000);
  for(const request of requests) {
    assert.ok(request.instructions.length+request.messages.reduce((n,m)=>n+m.content.length,0)<6000);
    assert.doesNotThrow(()=>JSON.parse(request.messages[0].content));
  }
});

test("Build materializes more than two nodes, resolves new parents, preserves cards and uses existing SVG columns", () => {
  const document = output.normalizeResearch({answer:"测试",proposal:{
    newNodes:[
      {id:"child-temp",canonicalName:"测试层级子节点",shortFact:"验证新父级引用",parentId:"parent-temp"},
      {id:"parent-temp",canonicalName:"测试数值方法",shortFact:"验证父级",parentId:"least-squares",blocks:[{type:"principle",title:"方法原理",text:"用于测试的方法原理。"}]},
      {canonicalName:"测试同层方法甲",shortFact:"甲定义",parentId:"least-squares"},
      {canonicalName:"测试同层方法乙",shortFact:"乙定义",parentId:"least-squares"}],
    cardBlocks:[{nodeId:"least-squares",type:"engineering_tradeoff",title:"测试补充",text:"原有卡片必须保留"}],
    evidence:[{title:"测试来源",note:"测试数据"}],
  }});
  const prepared = build.operationsFromResearch(document,dataset,"least-squares");
  const projected = agentGraphToDataset(applyOperations({...datasetToAgentGraph(dataset),revision:dataset.revision},prepared.operations,dataset.revision+1));
  assert.equal(projected.nodes.length,dataset.nodes.length+4);
  const before = dataset.cards.find((c)=>c.nodeId==="least-squares");
  const after = projected.cards.find((c)=>c.nodeId==="least-squares");
  for (const b of before.blocks) assert.ok(after.blocks.some((n)=>n.type===b.type && n.title===b.title));
  const parent = projected.nodes.find((n)=>n.canonicalName==="测试数值方法");
  const child = projected.nodes.find((n)=>n.canonicalName==="测试层级子节点");
  assert.equal(child.primaryParentId,parent.id);
  const index = layout.createLayoutIndex(toLegacyKnowledgeNodes(projected));
  const positions = layout.arrange(index.nodeMap.get(parent.id),index);
  const parentPosition = positions.find((n)=>n.id===parent.id);
  assert.ok(positions.find((n)=>n.id===child.id).x>parentPosition.x);
  for (const title of ["测试同层方法甲","测试同层方法乙"]) assert.equal(positions.find((n)=>n.title===title).x,parentPosition.x);
});

test("adaptive ReAct resets minimum observations for every visited topic and uses larger sparse-graph budgets", async () => {
  const events = [];
  const provider = {name:"mock",async createResponse(request) {
    if (request.tools?.length) return response("模拟外部证据");
    return response(JSON.stringify({answer:"完成观察",coverageAssessment:"已覆盖",converged:true,proposal:{}}));
  }};
  await adaptive.collectAdaptiveResearch({provider,dataset,nodeId:"foundation",query:"测试逐节点",runId:"test-react-reset",root:false,observations:[],
    budgetOverride:{maxNodes:2,maxCalls:20},onProgress:(m)=>events.push(m)});
  const firstRounds = events.filter((m)=>/第 1\/6 轮/.test(m));
  assert.equal(firstRounds.length,2);
  assert.equal(events.filter((m)=>/第 4\/6 轮/.test(m)).length,2);
  assert.ok(adaptive.researchBudget(1,true).maxNodeRounds>adaptive.researchBudget(114,true).maxNodeRounds);
  assert.equal(adaptive.researchBudget(1,true).maxNodes,300);
  assert.equal(adaptive.researchBudget(1,true).minDurationMs,25*60_000);
});

test("a parent's generated-node budget cannot consume the next topic's local expansion budget", async () => {
  const events = [];
  let serial = 0;
  const provider = {name:"mock",async createResponse(request) {
    if (request.tools?.length) return response("模拟外部证据");
    const input = JSON.parse(request.messages[0].content);
    return response(JSON.stringify({answer:"继续扩展",coverageAssessment:"仍可细分",converged:false,gaps:["下一层"],proposal:{newNodes:[{
      id:`local-child-${serial++}`,canonicalName:`局部子节点${serial}`,shortFact:"用于验证逐节点预算独立。",nodeType:"concept",parentId:input.topic.id,blocks:[]
    }]}}));
  }};
  await adaptive.collectAdaptiveResearch({provider,dataset,nodeId:"foundation",query:"测试局部预算",runId:"test-react-local-budget",root:false,observations:[],
    budgetOverride:{minRounds:1,initialRounds:2,maxNodeRounds:2,maxNodes:2,maxNewEntityNodesPerTopic:1,maxCalls:20,skeletonRounds:0},onProgress:(m)=>events.push(m)});
  assert.equal(events.filter((m)=>/第 1\/2 轮/.test(m)).length,2);
});
