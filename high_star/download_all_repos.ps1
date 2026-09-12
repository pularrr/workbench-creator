# AI Agent Open Source Projects & Skills Downloader
$ErrorActionPreference = "Continue"
$BASE = "D:\雷达毕设相关\high_star"

function Git-ShallowClone($url, $name) {
    $dir = Join-Path $BASE $name
    if (Test-Path $dir) {
        Write-Host "[SKIP] $name (exists)"
        return
    }
    Write-Host "[CLONE] $name ..."
    git clone --depth 1 $url $dir 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "[OK] $name" }
    else { Write-Host "[FAIL] $name" }
}

# === Frameworks (8) ===
Git-ShallowClone "https://github.com/langchain-ai/langchain.git"               "langchain"
Git-ShallowClone "https://github.com/langgenius/dify.git"                      "dify"
Git-ShallowClone "https://github.com/FoundationAgents/MetaGPT.git"             "MetaGPT"
Git-ShallowClone "https://github.com/microsoft/autogen.git"                    "autogen"
Git-ShallowClone "https://github.com/langchain-ai/langgraph.git"               "langgraph"
Git-ShallowClone "https://github.com/crewAIInc/crewAI.git"                     "crewAI"
Git-ShallowClone "https://github.com/All-Hands-AI/OpenHands.git"               "OpenHands"
Git-ShallowClone "https://github.com/huggingface/smolagents.git"               "smolagents"

# === Applications (7) ===
Git-ShallowClone "https://github.com/infiniflow/ragflow.git"                   "ragflow"
Git-ShallowClone "https://github.com/mem0ai/mem0.git"                          "mem0"
Git-ShallowClone "https://github.com/assafelovic/gpt-researcher.git"           "gpt-researcher"
Git-ShallowClone "https://github.com/microsoft/AI-Agents-For-Beginners.git"    "AI-Agents-For-Beginners"
Git-ShallowClone "https://github.com/datawhalechina/hello-agents.git"          "hello-agents"
Git-ShallowClone "https://github.com/huginn/huginn.git"                         "huginn"
Git-ShallowClone "https://github.com/n8n-io/n8n.git"                            "n8n"

# === Tools & Infrastructure (5) ===
Git-ShallowClone "https://github.com/modelcontextprotocol/python-sdk.git"       "mcp-python-sdk"
Git-ShallowClone "https://github.com/modelcontextprotocol/specification.git"    "mcp-specification"
Git-ShallowClone "https://github.com/stateful/docs.rag.git"                     "docs-rag"
Git-ShallowClone "https://github.com/vercel-labs/agent-browser.git"            "agent-browser"
Git-ShallowClone "https://github.com/e2b-dev/infra.git"                         "e2b-infra"

# === Skills (5) ===
Git-ShallowClone "https://github.com/langchain-ai/langchain-skills.git"        "langchain-skills"
Git-ShallowClone "https://github.com/tinh2/skills-hub-registry.git"            "skills-hub-registry"
Git-ShallowClone "https://github.com/GuDaStUDIO/modular-agent-skills.git"      "modular-agent-skills"
Git-ShallowClone "https://github.com/alg-bug-engineer/agent-skills-collections.git" "agent-skills-collections"
Git-ShallowClone "https://github.com/openclaw/skills.git"                      "openclaw-skills"

Write-Host "All clones done."
