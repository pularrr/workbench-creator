const fs = require('fs');
const src = fs.readFileSync('src/workbench-server.js', 'utf8');
const startMarker = 'const page = `';
const startIdx = src.indexOf(startMarker);
if (startIdx < 0) { console.log('未找到 const page = `'); process.exit(1); }
const contentStart = startIdx + startMarker.length;
// 找到下一个未转义的反引号
let endIdx = -1;
for (let i = contentStart; i < src.length; i++) {
  if (src[i] === '`' && src[i-1] !== '\\') { endIdx = i; break; }
}
if (endIdx < 0) { console.log('未找到 page 模板字符串结束反引号'); process.exit(1); }
const pageContent = src.substring(contentStart, endIdx);
console.log('page 长度: ' + pageContent.length);
const scriptMatches = [...pageContent.matchAll(/<script>([\s\S]*?)<\/script>/g)];
console.log('找到 ' + scriptMatches.length + ' 个 script 块');
let allOk = true;
scriptMatches.forEach((m, i) => {
  const js = m[1];
  try {
    new Function(js);
    console.log('script ' + i + ': 语法 OK (长度 ' + js.length + ')');
  } catch (e) {
    allOk = false;
    console.log('script ' + i + ': 语法错误 - ' + e.message);
  }
});
console.log(allOk ? '全部通过' : '存在错误');
process.exit(allOk ? 0 : 1);
