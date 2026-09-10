// Refresh only from the public dictionary used by the official /jobs page.
// Review the official UI/parameter contract before updating the pinned snapshot.
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = 'https://fe-api.zhaopin.com/c/i/search/base/data';
const normalize = rows => rows.filter(n => !n.deleted && n.name).map(n => ({code:String(n.code ?? ''),name:n.name,children:normalize(n.sublist || [])}));
async function main() {
  const raw = process.argv[2] ? fs.readFileSync(process.argv[2],'utf8') : await (await fetch(source)).text();
  const envelope=JSON.parse(raw); if(envelope.code!==200) throw new Error('Official dictionary unavailable');
  const options=Object.fromEntries(['companyType','subway','salaryType','financing','jobType','industry','allCity','educationType','workExpType','jobStatus','companySize','overseas'].map(k=>[k,normalize(envelope.data[k])]));
  const snapshot={source,version:'2026-09-08',sha256:crypto.createHash('sha256').update(raw).digest('hex'),
    contractSource:'https://fecdn4.zhaopin.cn/www_zhaopin_com/chunk-common.web.a8b4b8a58bd387931f03e07fdece4dc3.js',options};
  fs.mkdirSync('src/main/resources/zhilian',{recursive:true});
  fs.writeFileSync('src/main/resources/zhilian/official-filters.json', JSON.stringify(snapshot)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1});
