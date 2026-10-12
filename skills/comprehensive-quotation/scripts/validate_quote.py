#!/usr/bin/env python3
"""Validate an exported quotation using only Python's standard library."""
import json
import re
import sys
import zipfile
from decimal import Decimal, ROUND_HALF_UP
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HEADERS = ['序号', '功能模块名称', '功能模块描述', '工种', '人工单价', '工时', '模块总价', '模块合计', '备注建议']
def money(v): return Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
def validate(filename):
    errors = []
    def check(ok, message):
        if not ok: errors.append(message)
    with zipfile.ZipFile(filename) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = workbook.findall('s:sheets/s:sheet', NS)
        check(len(sheets) == 1, '最终结果必须恰好一张worksheet')
        if len(sheets) != 1: return errors, {}
        check(sheets[0].get('name') == '报价清单' and sheets[0].get('state', 'visible') == 'visible', '工作表必须可见且名为报价清单')
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        rid = sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = next(r.get('Target') for r in relationships if r.get('Id') == rid)
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        sheet = ET.fromstring(archive.read(sheet_path))
        styles = ET.fromstring(archive.read('xl/styles.xml'))
        fonts = styles.findall('s:fonts/s:font', NS); fills = styles.findall('s:fills/s:fill', NS); xfs = styles.findall('s:cellXfs/s:xf', NS)
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(t.text or '' for t in e.findall('.//s:t', NS)) for e in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        cells = {c.get('r'): c for c in sheet.findall('s:sheetData/s:row/s:c', NS)}
        def value(address):
            c = cells.get(address)
            if c is None: return None
            if c.get('t') == 'inlineStr': return ''.join(t.text or '' for t in c.findall('.//s:t', NS))
            v = c.find('s:v', NS)
            if v is None or v.text is None: return None
            if c.get('t') == 's': return strings[int(v.text)]
            if c.get('t') in ('str', 'e'): return v.text
            try: return Decimal(v.text)
            except Exception: return v.text
        def formula(address):
            c = cells.get(address); f = c.find('s:f', NS) if c is not None else None
            return f.text if f is not None else None
        header = next((int(a[1:]) for a in cells if a.startswith('A') and value(a) == '序号'), None)
        check(header is not None, '未找到固定表头')
        if header is None: return errors, {}
        check([value(f'{col}{header}') for col in 'ABCDEFGHI'] == HEADERS, '九列表头名称或顺序错误')
        pre = next((int(a[1:]) for a in cells if a.startswith('A') and value(a) == '税前总价'), None)
        post = next((int(a[1:]) for a in cells if a.startswith('A') and value(a) == '税后总价'), None)
        check(pre is not None and post is not None and post == pre + 1, '最后两项必须为税前总价、税后总价')
        if pre is None or post is None: return errors, {}
        nonempty_rows = [int(re.search(r'\d+', a).group()) for a in cells if value(a) is not None or formula(a)]
        check(max(nonempty_rows) == post, '税后总价必须是最后内容行')
        check(sheet.find('s:conditionalFormatting', NS) is None, '禁止条件格式')
        check(sheet.find('s:tableParts', NS) is None, '禁止套用结构化彩色表格样式')
        for address, cell in cells.items():
            col, row_s = re.fullmatch(r'([A-Z]+)(\d+)', address).groups(); row = int(row_s)
            check(col in 'ABCDEFGHI' and len(col) == 1, f'{address}超出九列')
            xf = xfs[int(cell.get('s', '0'))]; font = fonts[int(xf.get('fontId', '0'))]
            active = value(address) is not None or formula(address) is not None
            if active:
                name = font.find('s:name', NS); size = font.find('s:sz', NS)
                check(name is not None and name.get('val') == '宋体', f'{address}非宋体')
                check(size is not None and float(size.get('val')) == 12, f'{address}非小四12磅')
                for tag in ('b', 'i', 'u', 'strike'):
                    e = font.find(f's:{tag}', NS); enabled = e is not None and e.get('val', '1') not in ('0', 'false', 'none')
                    check(not enabled or (row == header and tag == 'b'), f'{address}含禁止字体装饰{tag}')
                align = xf.find('s:alignment', NS)
                check(align is not None and align.get('vertical') == 'center', f'{address}非垂直居中')
                if header <= row < pre and (row == header or isinstance(value(f'A{row}'), Decimal)):
                    want = 'center' if col in 'BDEFG' else 'left'
                    check(align is not None and align.get('horizontal') == want, f'{address}对齐错误，应{want}')
                    check(align is not None and align.get('wrapText') in ('1', 'true'), f'{address}未启用换行')
                check(cell.get('t') != 'e', f'{address}公式缓存错误{value(address)}')
            pattern = fills[int(xf.get('fillId', '0'))].find('s:patternFill', NS)
            painted = pattern is not None and pattern.get('patternType', 'none') != 'none'
            allowed = row == header or (row in (pre, post) and col in ('G', 'H'))
            check(not painted or allowed, f'{address}出现未经允许的背景色')
            if painted:
                fg = pattern.find('s:fgColor', NS)
                check(fg is not None and fg.get('rgb', '').upper().endswith('404040'), f'{address}背景不是指定深灰')
            if formula(address): check('!' not in formula(address) and '[' not in formula(address), f'{address}含外页或外部引用')
        detail = []
        for row in range(header + 1, pre):
            if isinstance(value(f'A{row}'), Decimal): detail.append(row)
        check(bool(detail), '没有报价明细')
        check([value(f'A{n}') for n in detail] == [Decimal(i + 1) for i in range(len(detail))], '序号必须连续')
        check(detail == list(range(header + 1, header + 1 + len(detail))), '明细必须连续')
        amounts = []
        for row in detail:
            role, unit, hours, amount = (value(f'{c}{row}') for c in 'DEFG')
            check(formula(f'G{row}') is not None, f'G{row}应保留计算公式')
            if role in ('设备采购（非人工）', '第三方服务（非人工）'):
                check(unit is None and hours is None, f'采购/服务第{row}行不能伪装成人工')
                f = formula(f'G{row}') or ''; m = re.fullmatch(r'ROUND\(([0-9.eE+]+)\*([0-9.eE+]+),2\)', f)
                if m: check(amount == money(Decimal(m[1]) * Decimal(m[2])), f'第{row}行采购总价错误')
            elif isinstance(unit, Decimal) and isinstance(hours, Decimal):
                check(amount == money(unit * hours), f'第{row}行人工总价错误')
            else: check(amount == '待确认', f'第{row}行缺参数但未显示待确认')
            amounts.append(amount)
        merges = {e.get('ref') for e in sheet.findall('s:mergeCells/s:mergeCell', NS)}
        module_totals = []; names = set(); i = 0
        while i < len(detail):
            start = detail[i]; name = value(f'B{start}'); end = start
            check(isinstance(name, str) and bool(name), f'B{start}缺模块名称')
            check(name not in names, f'模块{name}没有归并'); names.add(name)
            while i + 1 < len(detail) and value(f'B{detail[i + 1]}') is None: i += 1; end = detail[i]
            if end > start:
                check(f'B{start}:B{end}' in merges and f'H{start}:H{end}' in merges, f'模块{name}名称/合计未对应合并')
            vals = [value(f'G{n}') for n in range(start, end + 1)]
            expect = sum(vals, Decimal(0)) if all(isinstance(v, Decimal) for v in vals) else '待确认'
            check(value(f'H{start}') == expect, f'模块{name}合计缓存错误')
            check(formula(f'H{start}') is not None and f'G{start}:G{end}' in formula(f'H{start}'), f'模块{name}合计公式范围错误')
            module_totals.append(expect); i += 1
        pre_expect = sum(amounts, Decimal(0)) if all(isinstance(v, Decimal) for v in amounts) else '待确认'
        check(value(f'G{pre}') == pre_expect, '税前总价与明细独立核对不一致')
        tax_rates = {}
        for n in range(detail[-1] + 1, pre):
            label = value(f'A{n}')
            if isinstance(label, str) and label.startswith('税率：'): tax_rates[label[3:]] = value(f'E{n}')
        post_expect = pre_expect
        if isinstance(pre_expect, Decimal):
            bases = {}
            for n in detail:
                m = re.search(r'(?:^|\n)税组：([^\n]+)', str(value(f'I{n}') or ''))
                check(m is not None, f'第{n}行缺税组依据')
                if m: bases[m[1]] = bases.get(m[1], Decimal(0)) + value(f'G{n}')
            for name, base in bases.items():
                rate = tax_rates.get(name)
                if not isinstance(rate, Decimal): post_expect = '待确认'; break
                post_expect += money(base * rate)
        check(value(f'G{post}') == post_expect, '税后总价与分税组独立核对不一致')
        for n in (pre, post): check(formula(f'G{n}') is not None, f'第{n}行总价不是公式')
        result = {'worksheet_count': len(sheets), 'detail_rows': len(detail), 'module_count': len(module_totals), 'pretax': str(value(f'G{pre}')), 'aftertax': str(value(f'G{post}'))}
        return errors, result

if __name__ == '__main__':
    if len(sys.argv) != 2: print('用法：python validate_quote.py 客户报价.xlsx'); sys.exit(2)
    try:
        errors, result = validate(sys.argv[1]); print(json.dumps({'passed': not errors, 'errors': errors, **result}, ensure_ascii=False, indent=2)); sys.exit(bool(errors))
    except Exception as e: print(json.dumps({'passed': False, 'error': str(e)}, ensure_ascii=False)); sys.exit(1)
