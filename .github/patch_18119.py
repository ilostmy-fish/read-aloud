from pathlib import Path
import json

manifest = Path('manifest.json')
data = json.loads(manifest.read_text())
if data.get('version') != '1.81.18':
    raise SystemExit(f"expected 1.81.18, found {data.get('version')}")
data['version'] = '1.81.19'
manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
