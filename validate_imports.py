import os
import re

exports = {}

# Gather all exports
for file in os.listdir('js'):
    if file.endswith('.js'):
        with open(os.path.join('js', file), 'r', encoding='utf-8') as f:
            content = f.read()
            # Find export function/const names
            matches = re.findall(r'^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)', content, re.MULTILINE)
            exports[file] = set(matches)

# Validate imports
for file in os.listdir('js'):
    if file.endswith('.js'):
        with open(os.path.join('js', file), 'r', encoding='utf-8') as f:
            content = f.read()
            # Find import statements
            imports = re.findall(r'^import\s+\{([^}]+)\}\s+from\s+[\'"]\.\/([^\'"]+)[\'"]', content, re.MULTILINE)
            for imp_list, src_file in imports:
                if src_file not in exports:
                    print(f"Error in {file}: imports from missing file {src_file}")
                    continue
                for sym in imp_list.split(','):
                    sym = sym.strip()
                    if sym and sym not in exports[src_file]:
                        print(f"Error in {file}: missing export '{sym}' from {src_file}")

print("Validation complete.")
