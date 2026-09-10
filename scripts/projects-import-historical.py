#!/usr/bin/env python3
"""Extract a small, allowlisted DRAFT catalog from the static MEST audit.

Reads the Excel bytes only to verify the SHA-256. Never opens Excel, executes VBA,
imports users/prices/proposals, or changes the source files. No dependencies.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


def columns(start: str, end: str) -> list[str]:
    def number(s: str) -> int:
        n = 0
        for c in s:
            n = n * 26 + ord(c) - 64
        return n
    def label(n: int) -> str:
        s = ''
        while n:
            n, r = divmod(n - 1, 26)
            s = chr(65 + r) + s
        return s
    return [label(n) for n in range(number(start), number(end) + 1)]


# Sheet, category, row range, name column, header row, allowed columns, context cells.
SPECS = [
    ('Inf_Módulos', 'module', 6, 23, 'D', 5, columns('C', 'Q') + columns('AD', 'AI'), ['D2']),
    ('Inf_Inversor', 'inverter', 6, 45, 'D', 5, columns('C', 'BJ'), ['E2']),
    ('Inf_Irrad_Sol', 'solar_resource', 5, 63, 'B', 4, columns('B', 'W'), ['F2']),
    ('Tab_Amp_Cir_AC', 'conductor_rule', 11, 38, 'D', 10, columns('C', 'Q'), ['C5', 'E8', 'G8', 'I8', 'K8']),
    ('Tab_Amp_Cir_AC', 'conductor_rule', 46, 73, 'D', 45, columns('C', 'P'), ['C5', 'E42', 'E43']),
    ('Inf_Tab_Cab', 'installation_method', 12, 17, 'D', 11, columns('C', 'M'), ['C6', 'F8', 'F9', 'H9', 'F10']),
    ('Inf_Sistema_De_Montaje', 'mounting_rule', 8, 15, 'C', 7, columns('C', 'E'), ['H2']),
]


def build_catalog(audit: dict, workbook_bytes: bytes) -> dict:
    source = audit['a']
    actual_hash = hashlib.sha256(workbook_bytes).hexdigest()
    if actual_hash != source['sha256']:
        raise ValueError('SOURCE_SHA256_MISMATCH: el libro no coincide con la auditoría.')
    entries = []
    for sheet_name, category, first, last, name_column, header_row, allowed, contexts in SPECS:
        cells = source['sheets'][sheet_name]['cells']
        for row in range(first, last + 1):
            name = cells.get(f'{name_column}{row}', {}).get('value')
            if not isinstance(name, str) or not name.strip() or name.startswith('#'):
                continue
            raw_fields = {}
            provenance = {}
            for column in allowed:
                address = f'{column}{row}'
                cell = cells.get(address)
                if not cell or cell.get('value') is None:
                    continue
                header = f'{column}{header_row}'
                label = cells.get(header, {}).get('value', column)
                if re.search(r'precio|costo|password|contrase|correo|usuario', str(label), re.I):
                    raise ValueError(f'FORBIDDEN_COLUMN: {sheet_name}!{header}')
                raw_fields[column] = cell['value']
                provenance[column] = {'cell': address, 'headerCell': header, 'label': str(label), 'type': cell.get('type', 'unknown')}
            flags = ['HISTORICAL_UNVERIFIED', 'SOURCE_AGE_NOT_CONFIRMED']
            if category == 'module':
                flags += ['VMP_TEMPERATURE_COEFFICIENT_MISSING', 'TEMPERATURE_COEFFICIENT_UNITS_REQUIRE_REVIEW', 'HISTORICAL_WARRANTIES_NOT_CONTRACTUAL']
            elif category == 'inverter':
                flags += ['SHORT_CIRCUIT_LIMIT_NOT_IDENTIFIED', 'EACH_MPPT_REQUIRES_DATASHEET_REVIEW', 'HISTORICAL_WARRANTIES_NOT_CONTRACTUAL']
            elif category == 'solar_resource':
                flags += ['DATASET_PERIOD_AND_PLANE_UNKNOWN', 'RADIATION_UNITS_REQUIRE_REVIEW', 'TEMPERATURE_EXTREMES_NOT_DESIGN_VALUES']
            elif category in ('conductor_rule', 'installation_method'):
                flags += ['NORM_AND_INSTALLATION_CONDITIONS_REQUIRE_REVIEW', 'ZERO_IS_NOT_VALID_AMPACITY_APPROVAL']
            else:
                flags += ['MOUNTING_CERTIFICATION_CLAIMS_UNVERIFIED', 'STRUCTURAL_REVIEW_REQUIRED']
            if any(isinstance(v, str) and v.startswith('#') for v in raw_fields.values()):
                flags.append('RECOVERED_ERROR_VALUES_PRESENT')
            entry_id = 'mest-' + hashlib.sha256(f'{actual_hash}:{sheet_name}:{row}'.encode()).hexdigest()[:24]
            entries.append({
                'id': entry_id, 'category': category, 'name': name.strip(),
                'data': {'rawFields': raw_fields, 'fieldProvenance': provenance,
                         'context': [{'cell': a, 'value': cells[a]['value']} for a in contexts if a in cells],
                         'reviewFlags': flags},
                'sourceSheet': sheet_name, 'sourceRow': row, 'sourceSha256': actual_hash,
                'status': 'DRAFT', 'requiresReview': True,
            })
    names = Counter((e['category'], e['name']) for e in entries)
    for entry in entries:
        same = names[(entry['category'], entry['name'])]
        entry['data']['sameNameOccurrences'] = same
        if same > 1:
            entry['data']['reviewFlags'].append('DUPLICATE_NAME_SEPARATE_SOURCE_ROWS')
    return {
        'version': 'ENNCO-HISTORICAL-CATALOG-1', 'status': 'DRAFT', 'requiresReview': True,
        'sourceFilename': source['filename'], 'sourceSha256': actual_hash,
        'importPolicy': 'ALLOWLIST_TECHNICAL_CELLS_ONLY_NO_USERS_NO_PRICES_NO_PROPOSALS',
        'sourceDate': None, 'sourceDateNote': 'El año real de verificación de cada ficha no consta en el libro recuperado.',
        'counts': dict(sorted(Counter(e['category'] for e in entries).items())), 'entries': entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-json', type=Path, required=True)
    parser.add_argument('--workbook', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/projects/historical-catalogs.json'))
    parser.add_argument('--check', action='store_true', help='Verifica igualdad sin escribir salida.')
    args = parser.parse_args()
    if args.output.resolve() in {args.workbook.resolve(), args.audit_json.resolve()}:
        raise ValueError('OUTPUT_CANNOT_REPLACE_SOURCE')
    catalog = build_catalog(json.loads(args.audit_json.read_text()), args.workbook.read_bytes())
    rendered = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if args.output.read_text() != rendered:
            raise SystemExit('CATALOG_DOES_NOT_MATCH_SOURCE')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered)
    print(json.dumps({'verified': True, 'entries': len(catalog['entries']), 'counts': catalog['counts'], 'sourceSha256': catalog['sourceSha256']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
