// src/의 모든 ES 모듈을 파싱해 문법 오류를 잡는다. (node scripts/check-syntax.mjs)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
let failed = 0;
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const file = path.join(dir, name);
  try {
    new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file });
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
