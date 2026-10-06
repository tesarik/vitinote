"""Výtah přípravků povolených pro révu z registru přípravků na ochranu rostlin (ÚKZÚZ).

Zdroj je veřejný export celého registru (XML, ~100 MB, aktualizovaný denně):
https://mze.gov.cz/public/app/eagriapp/POR/DataKeStazeni.aspx

Samostatně:  python3 por_registry.py [zdroj.xml|URL] > por-reva.json
"""

import re
import shutil
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

POR_EXPORT_URL = 'https://mze.gov.cz/public/app/eagriapp/POR/export.xml'
VINE_PREFIX = 'Réva'          # „Réva moštová“, „Réva stolní“, „Réva“
AUTHORIZED = 'P'              # AKT_STAV: P = povolený, Z = zrušený


def _text(el, tag):
    return (el.findtext(tag) or '').strip()


def _date(el, tag):
    return _text(el, tag)[:10] or None


def parse_phi_days(text):
    """Ochranná lhůta ve dnech. „35“, „35 dnů“, „AT, 28“ → největší číslo; „AT“ (dáno odstupem), „-“ → None."""
    days = [int(n) for n in re.findall(r'\d+', text or '')]
    return max(days) if days and not text.strip().endswith('h') else None


def _num(text):
    try:
        return float(text.replace(',', '.'))
    except (AttributeError, ValueError):
        return None


def _use(u):
    crops = sorted({_text(p, 'NAZEV') for p in u.findall('PLODINA') if _text(p, 'NAZEV').startswith(VINE_PREFIX)})
    if not crops:
        return None
    dosing = u.find('DAVKOVANI')
    phi = _text(u, 'OL')
    return {
        'id': _text(u, 'ID'),
        'crops': crops,
        'pest': _text(u, 'SO'),
        'phi': phi,
        'phiDays': parse_phi_days(phi),
        'dose': _text(u, 'DAVKA'),
        'doseMin': _num(_text(dosing, 'MIN_DAVKA')) if dosing is not None else None,
        'doseMax': _num(_text(dosing, 'MAX_DAVKA')) if dosing is not None else None,
        'doseUnit': _text(dosing, 'MJ') if dosing is not None else '',
        'note': _text(u, 'POZNAMKA'),
    }


def _product(name, roz):
    uses = [x for x in map(_use, roz.findall('POUZITI')) if x]
    if not uses:
        return None
    return {
        'regNo': _text(roz, 'REG_CISLO'),
        'name': name,
        'kind': _text(roz, 'B_FCE'),
        'holder': _text(roz, 'DRZ_ROZH'),
        'validTo': _date(roz, 'D_PLATNE_DO'),       # konec povolení
        'sellTo': _date(roz, 'D_ZASD_SKUT'),        # doprodej zásob
        'useTo': _date(roz, 'D_ZAS_SKUT'),          # použití zásob
        'substances': [
            {'name': _text(ul, 'NAZEV'), 'amount': _num(_text(ul, 'MNOZSTVI')), 'unit': _text(ul, 'MJ')}
            for ul in roz.findall('UL')
        ],
        'uses': uses,
    }


def extract_vine_products(xml_file):
    """Projde export proudově (soubor má ~100 MB) a vrátí povolené přípravky s použitím pro révu."""
    products = []
    for _, el in ET.iterparse(xml_file, events=('end',)):
        if el.tag != 'POLOZKA':
            continue
        name = _text(el, 'OJP')
        for roz in el.findall('ROZHODNUTI'):
            if _text(roz, 'AKT_STAV') == AUTHORIZED and (p := _product(name, roz)):
                products.append(p)
        el.clear()
    products.sort(key=lambda p: (p['name'].casefold(), p['regNo']))
    return products


def build_vine_registry(source=POR_EXPORT_URL, timeout=300):
    """Stáhne export (URL, i file://) nebo přečte lokální soubor a vrátí výtah pro révu."""
    with tempfile.TemporaryFile() as tmp:
        if '://' in source:
            with urllib.request.urlopen(source, timeout=timeout) as res:
                shutil.copyfileobj(res, tmp)
        else:
            with open(source, 'rb') as f:
                shutil.copyfileobj(f, tmp)
        tmp.seek(0)
        products = extract_vine_products(tmp)
    if not products:
        raise ValueError('v exportu nejsou žádné přípravky pro révu – změnil se formát?')
    return {'updated': date.today().isoformat(), 'source': source, 'products': products}


if __name__ == '__main__':
    import json
    data = build_vine_registry(sys.argv[1] if len(sys.argv) > 1 else POR_EXPORT_URL)
    json.dump(data, sys.stdout, ensure_ascii=False, indent=1)
