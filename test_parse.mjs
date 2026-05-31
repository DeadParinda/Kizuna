import fs from 'fs';
import * as acorn from 'acorn';

try {
  const code = fs.readFileSync('js/main.js', 'utf-8');
  acorn.parse(code, { sourceType: 'module', ecmaVersion: 2022 });
  console.log("main.js parses successfully!");
} catch (e) {
  console.error(e);
}
