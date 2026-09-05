"""Reacquire exact frozen archives; never replace a valid local source."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def check(path, source):
    data = path.read_bytes()
    if len(data) != source['byte_size'] or hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Frozen source mismatch: ' + path.name)

def main():
    manifest = json.loads((ROOT/'final_release/source_provenance/drug_information/SOURCE_MANIFEST.json').read_bytes())
    for source in manifest['sources']:
        path = ROOT/source['path']
        if not path.resolve().is_relative_to(ROOT/'data/downloads') or not source['url'].startswith('https://'):
            raise ValueError('Unsafe source path/URL')
        if path.exists():
            check(path,source)
            print('PASS existing source:',path.name)
            continue
        path.parent.mkdir(parents=True,exist_ok=True)
        partial = path.with_suffix(path.suffix+'.part')
        with partial.open('xb') as handle:
            subprocess.run(['curl.exe' if os.name=='nt' else 'curl','--silent','--show-error','--fail',
                '--location','--proto','=https','--proto-redir','=https','--max-time','180',
                '--max-filesize',str(source['byte_size']),source['url']],stdout=handle,check=True)
            handle.flush();os.fsync(handle.fileno())
        check(partial,source)
        os.link(partial,path)
        partial.unlink()
        print('PASS reacquired exact frozen source:',path.name)

if __name__ == '__main__': main()
