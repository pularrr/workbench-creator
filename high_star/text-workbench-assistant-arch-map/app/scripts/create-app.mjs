#!/usr/bin/env node
import { copyFileSync, readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { projectRoot, withProjectModules } from "./lib/project-modules.mjs";

function cpSync(source, destination, options = {}) {
  if (options.filter && !options.filter(source)) return;
  const stat = readdirSync(source, { withFileTypes: true });
  mkdirSync(destination, { recursive: true });
  for (const entry of stat) {
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (options.filter && !options.filter(from)) continue;
    if (entry.isDirectory()) cpSync(from, to, options);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error('模板包含不支持的链接: ' + from);
  }
}

export async function createApp({ profile: profileId, profileFile, name, output }) {
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("--name 必须为小写英文、数字和连字符");
  if ((!profileId && !profileFile) || (profileId && profileFile)) throw new Error("指定 --profile 或 --profile-file 之一");
  if (profileId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profileId)) throw new Error("无效 Profile ID");
  const target = resolve(output || name);
  if (existsSync(target)) throw new Error(`输出目录已存在: ${target}`);
  const relativeToProject = relative(projectRoot, target);
  if (relativeToProject === "" || (!relativeToProject.startsWith("..") && !isAbsolute(relativeToProject))) throw new Error("生成应用必须位于 KnowMap/Skill 项目根目录之外的全新隔离目录");
  const template = join(projectRoot, "templates", "app");
  for (const folder of ["templates/app", "core", "server", "features", "plugin", "profiles", "scripts", "db", "data/knowledge", "app/api"]) {
    const inside = relative(join(projectRoot, folder), target);
    if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) throw new Error("输出不能位于被复制的源目录内");
  }
  if (!existsSync(template)) throw new Error("模板不存在；请使用完整 KnowMap 源项目执行脚手架");
  return withProjectModules(async load => {
    const { validateProfile } = await load("/server/profile/validate-profile.ts");
    let value;
    if (profileFile) value = JSON.parse(readFileSync(resolve(profileFile), "utf8").replace(/^\uFEFF/, ""));
    else {
      if (!existsSync(join(projectRoot, "profiles", `${profileId}.ts`))) throw new Error(`找不到 Profile: ${profileId}`);
      const module = await load(`/profiles/${profileId}.ts`);
      value = Object.values(module).find(p => p && typeof p === "object" && p.id === profileId);
    }
    const profile = validateProfile(value);
    cpSync(template, target, { recursive: true, filter: source => !/(?:^|[\\/])(?:node_modules|\.next|runtime|\.git|\.env[^\\/]*)(?:[\\/]|$)/.test(source) });
    // The template owns the UI; shared engine files are taken from this revision.
    for (const folder of ["core", "server", "features", "plugin", "profiles", "scripts", "db", "data/knowledge"]) {
      cpSync(join(projectRoot, folder), join(target, folder), { recursive: true });
    }
    // Preserve the template's generic initial dataset after copying reference data.
    copyFileSync(join(template, "data/knowledge/initial-dataset.ts"), join(target, "data/knowledge/initial-dataset.ts"));
    cpSync(join(projectRoot, "app/api"), join(target, "app/api"));
    mkdirSync(join(target, "profiles"), { recursive: true });
    writeFileSync(join(target, "profiles/active.json"), JSON.stringify(profile, null, 2));
    writeFileSync(join(target, "profiles/active.ts"), 'import profile from "./active.json";\nimport type { TaskProfile } from "../plugin/contracts/task-profile";\nexport const ACTIVE_PROFILE = profile as unknown as TaskProfile;\n');
    const config = { appName: profile.name, appSubtitle: profile.description, rootNodeId: profile.initialization.rootNode.id,
      storagePrefix: name, eyebrow: "KNOWLEDGE GRAPH · AI ASSISTANT" };
    writeFileSync(join(target, "app/config.ts"), `export const APP_CONFIG = ${JSON.stringify(config, null, 2)} as const;\n`);
    const packagePath = join(target, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    pkg.name = name; pkg.displayName = profile.name;
    pkg.scripts["type-check"] = "tsc --noEmit";
    pkg.scripts.test = "node --test tests/generated-app.test.mjs";
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
    const lockPath = join(target, "package-lock.json");
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")); lock.name = name;
      if (lock.packages?.[""]) lock.packages[""].name = name;
      writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    }
    mkdirSync(join(target, "data/runtime"), { recursive: true });
    writeFileSync(join(target, "data/runtime/.gitkeep"), "");
    mkdirSync(join(target, "docs"), { recursive: true });
    for (const file of ["plugin-audit-plan.md", "plugin-audit-results.md"]) {
      if (existsSync(join(projectRoot, "docs", file))) copyFileSync(join(projectRoot, "docs", file), join(target, "docs", file));
    }
    return { output: target, profileId: profile.id, rootNodeId: config.rootNodeId,
      next: "先注入已审查的数据，再在应用目录 npm install、npm run type-check、npm test、npm run build、npm run dev。" };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    if (args.includes("--help")) console.log("create-app.mjs --profile <id> | --profile-file <json> --name <name> --output <new-directory>");
    else if (args.includes("--list-profiles")) {
      const { readdirSync } = await import("node:fs");
      console.log(readdirSync(join(projectRoot, "profiles")).filter(f => f.endsWith(".ts") && f !== "active.ts").map(f => f.slice(0, -3)).join("\n"));
    } else {
      for (let i = 0; i < args.length; i += 2) {
        const key = { "--profile": "profile", "--profile-file": "profileFile", "--name": "name", "--output": "output" }[args[i]];
        if (!key || !args[i + 1]) throw new Error(`未知或缺值参数: ${args[i]}`);
        options[key] = args[i + 1];
      }
      console.log(JSON.stringify(await createApp(options), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
