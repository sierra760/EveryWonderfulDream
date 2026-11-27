#!/usr/bin/env python3
"""Convert Larry Vredenburgh's California patent spreadsheets to JSON.

The spreadsheets are BLM's own index of California land patents, 1856-1995,
released under the Freedom of Information Act in 1997 and published at
https://vredenburgh.org/capatents/ (San Bernardino County: snbdo01-04.zip).

Usage (xlrd reads the old .xls format; -I keeps Python from importing
anything that sits beside the downloaded files):

    uv run --with xlrd python -I scripts/import-foia-patents.py \
        data/raw/vredenburgh/xls data/raw/vredenburgh/patents.json data/foia-small-tract.json

Output 1: every row as {mer, twp, rng, sec, doc, case, authority, date, names},
with names split on ";" and left exactly as indexed (SURNAME GIVEN).
Output 2 (optional): just the "Small Tract Sale" rows, compact, as
{d: patent number, c: case serial, t: date, n: names}. This is the file the
atlas build reads, and the one kept in the repository.
"""
import json
import sys
from pathlib import Path

import xlrd

EXPECTED = ['Mer', 'Twp', 'Rng', 'Sec', 'Doc Id', 'Case No', 'Authority', 'Date', 'Patentee']


def text(v):
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return ' '.join(str(v).split())


def main(src, out, small=None):
    rows = []
    for path in sorted(Path(src).glob('*.xls')):
        sheet = xlrd.open_workbook(str(path)).sheet_by_index(0)
        header = [text(sheet.cell_value(0, c)) for c in range(sheet.ncols)]
        if header != EXPECTED:
            raise SystemExit(f'{path.name}: unexpected columns {header}')
        for r in range(1, sheet.nrows):
            mer, twp, rng, sec, doc, case, authority, date, names = (text(sheet.cell_value(r, c)) for c in range(9))
            rows.append({
                'mer': mer, 'twp': twp, 'rng': rng, 'sec': sec, 'doc': doc, 'case': case,
                'authority': authority, 'date': date.replace('/', '-'),
                'names': [n.strip() for n in names.split(';') if n.strip()],
            })
        print(f'{path.name}: {sheet.nrows - 1} rows')
    Path(out).write_text(json.dumps(rows, separators=(',', ':')))
    print(f'{len(rows)} rows -> {out}')
    if small:
        st = [{'d': r['doc'], 'c': r['case'], 't': r['date'], 'n': r['names']}
              for r in rows if r['authority'] == 'Small Tract Sale']
        Path(small).write_text('[\n' + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in st) + '\n]\n')
        print(f'{len(st)} small tract rows -> {small}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
