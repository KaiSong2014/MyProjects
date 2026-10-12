import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

export const HEADERS = ['序号', '功能模块名称', '功能模块描述', '工种', '人工单价', '工时', '模块总价', '模块合计', '备注建议'];
const WIDTHS = [54, 160, 360, 158, 112, 86, 132, 140, 340];
const CENTER = new Set([1, 3, 4, 5, 6]);
const FONT = { name: '宋体', size: 12, bold: false, italic: false, color: '#000000' };
const GRAY = '#404040', letters = 'ABCDEFGHI';
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const safeText = v => { const s = String(v ?? ''); return /^[=+@-]/.test(s) ? "'" + s : s; };
function numberOrNull(v, label) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${label}必须为非负数值或null`);
  return v;
}
function requireText(v, label) { if (typeof v !== 'string' || !v.trim()) throw new Error(`${label}不能为空`); return v.trim(); }
function validate(data) {
  requireText(data.project_name, 'project_name');
  if (!Array.isArray(data.rows) || !data.rows.length) throw new Error('rows必须至少有一项');
  if (!data.tax_rates || typeof data.tax_rates !== 'object' || Array.isArray(data.tax_rates) || !Object.keys(data.tax_rates).length) throw new Error('tax_rates必须至少有一组');
  for (const [key, value] of Object.entries(data.tax_rates)) { requireText(key, '税组名称'); const n = numberOrNull(value, key); if (n !== null && n > 1) throw new Error('税率必须使用0到1的小数'); }
  return data.rows.map((r, index) => {
    const row = { ...r, module: requireText(r.module, `第${index + 1}项module`), description: requireText(r.description, 'description'), tax_group: requireText(r.tax_group, 'tax_group') };
    if (!Object.hasOwn(data.tax_rates, row.tax_group)) throw new Error(`未定义税组：${row.tax_group}`);
    if (!['labor', 'hardware', 'service'].includes(row.kind)) throw new Error('kind必须是labor、hardware或service');
    if (row.kind === 'labor') { row.role = requireText(row.role, 'role'); row.unit_rate = numberOrNull(row.unit_rate, 'unit_rate'); row.hours = numberOrNull(row.hours, 'hours'); }
    else { row.quantity = numberOrNull(row.quantity, 'quantity'); if (!(row.quantity > 0)) throw new Error('采购数量必须大于0'); row.unit_price = numberOrNull(row.unit_price, 'unit_price'); requireText(row.unit, 'unit'); row.role = row.kind === 'hardware' ? '设备采购（非人工）' : '第三方服务（非人工）'; }
    return row;
  });
}
function displayWidth(text) { return Array.from(String(text)).reduce((n, c) => n + (/[^\x00-\x7f]/.test(c) ? 16 : 8.5), 0); }
function height(text, pixels) { const lines = String(text ?? '').split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(displayWidth(p) / (pixels - 20))), 0); return Math.max(34, lines * 21 + 16); }

export async function buildQuote(data, output, previewDir) {
  const rows = validate(data), groups = new Map();
  for (const row of rows) { if (!groups.has(row.module)) groups.set(row.module, []); groups.get(row.module).push(row); }
  const ordered = [...groups.values()].flat(), wb = Workbook.create();
  const sheet = wb.worksheets.add('报价清单'); sheet.showGridLines = false;
  const headerRow = 5, first = 6, last = first + ordered.length - 1;
  const taxStart = last + 2, taxEntries = Object.entries(data.tax_rates);
  const preRow = taxStart + taxEntries.length, postRow = preRow + 1;
  const all = sheet.getRange(`A1:I${postRow}`);
  all.clear({ applyTo: 'formats' }); all.format.font = FONT;
  all.format.wrapText = true; all.format.verticalAlignment = 'center'; all.format.horizontalAlignment = 'left';
  for (let i = 0; i < 9; i++) { const r = sheet.getRange(`${letters[i]}1:${letters[i]}${postRow}`); r.format.columnWidthPx = WIDTHS[i]; if (CENTER.has(i)) r.format.horizontalAlignment = 'center'; }
  all.format.rowHeightPx = 34;
  sheet.mergeCells('A1:I1'); sheet.getRange('A1').values = [[safeText(`${data.project_name}报价清单`)]];
  sheet.mergeCells('A2:I2'); sheet.getRange('A2').values = [['币种：人民币；人工单价：元/小时；工时：人时；金额：元；所有明细为未税价格。']];
  sheet.mergeCells('A3:I3'); sheet.getRange('A3').values = [[safeText(data.scope_note || '按确认范围报价。')]];
  sheet.getRange('A3:I3').format.rowHeightPx = height(data.scope_note || '', WIDTHS.reduce((a, b) => a + b, 0));
  sheet.getRange('A4:I4').format.rowHeightPx = 12;
  sheet.getRange(`A${headerRow}:I${headerRow}`).values = [HEADERS];
  sheet.getRange(`A${headerRow}:I${headerRow}`).format.fill = GRAY;
  sheet.getRange(`A${headerRow}:I${headerRow}`).format.font = { ...FONT, bold: true, color: '#FFFFFF' };
  sheet.getRange(`A${headerRow}:I${headerRow}`).format.rowHeightPx = 46; sheet.freezePanes.freezeRows(headerRow);
  const expected = [], rowNumbers = new Map(taxEntries.map(([name]) => [name, []]));
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i], n = first + i, notes = [r.notes || '', r.source ? `依据：${r.source}` : '', `税组：${r.tax_group}`];
    if (r.kind !== 'labor') notes.push(`数量：${r.quantity}${r.unit}；采购未税单价：${r.unit_price === null ? '待询价' : r.unit_price + '元'}。`);
    const note = notes.filter(Boolean).join('\n');
    sheet.getRange(`A${n}:I${n}`).values = [[i + 1, safeText(r.module), safeText(r.description), safeText(r.role), r.kind === 'labor' ? r.unit_rate : null, r.kind === 'labor' ? r.hours : null, null, null, safeText(note)]];
    let amount;
    if (r.kind === 'labor') { sheet.getRange(`G${n}`).formulas = [[`=IF(AND(ISNUMBER(E${n}),ISNUMBER(F${n})),ROUND(E${n}*F${n},2),"待确认")`]]; amount = r.unit_rate === null || r.hours === null ? null : round(r.unit_rate * r.hours); }
    else { sheet.getRange(`G${n}`).formulas = [[r.unit_price === null ? '="待确认"' : `=ROUND(${r.quantity}*${r.unit_price},2)`]]; amount = r.unit_price === null ? null : round(r.quantity * r.unit_price); }
    expected.push(amount); rowNumbers.get(r.tax_group).push(n);
    const rowHeight = Math.max(height(r.description, WIDTHS[2]), height(note, WIDTHS[8]), height(r.role, WIDTHS[3]), height(r.module, WIDTHS[1]));
    if (rowHeight > 546) throw new Error(`第${i + 1}项文本超出Excel行高上限，请按可验收功能拆分`);
    sheet.getRange(`A${n}:I${n}`).format.rowHeightPx = rowHeight;
  }
  sheet.getRange(`E${first}:E${last}`).setNumberFormat('#,##0.00'); sheet.getRange(`F${first}:F${last}`).setNumberFormat('0.00');
  sheet.getRange(`G${first}:H${postRow}`).setNumberFormat('#,##0.00');
  let cursor = first; const moduleRanges = [];
  for (const [name, items] of groups) {
    const end = cursor + items.length - 1;
    if (end > cursor) { sheet.getRange(`B${cursor + 1}:B${end}`).clear({ applyTo: 'contents' }); sheet.mergeCells(`B${cursor}:B${end}`); sheet.mergeCells(`H${cursor}:H${end}`); }
    sheet.getRange(`H${cursor}`).formulas = [[`=IF(COUNT(G${cursor}:G${end})=${items.length},SUM(G${cursor}:G${end}),"待确认")`]];
    moduleRanges.push({ name, first: cursor, last: end }); cursor = end + 1;
  }
  const taxCells = new Map();
  for (let i = 0; i < taxEntries.length; i++) {
    const [name, rate] = taxEntries[i], n = taxStart + i;
    sheet.mergeCells(`A${n}:D${n}`); sheet.getRange(`A${n}`).values = [[safeText(`税率：${name}`)]];
    sheet.getRange(`E${n}`).values = [[rate]]; sheet.getRange(`E${n}`).setNumberFormat('0.00%');
    sheet.mergeCells(`F${n}:I${n}`); sheet.getRange(`F${n}`).values = [[rate === null ? '待确认税率；税后总价暂不计算。' : '按此税组未税合计计算税额，四舍五入到分。']];
    sheet.getRange(`F${n}:I${n}`).format.horizontalAlignment = 'left'; taxCells.set(name, `$E$${n}`);
  }
  for (const [n, label] of [[preRow, '税前总价'], [postRow, '税后总价']]) {
    sheet.mergeCells(`A${n}:F${n}`); sheet.getRange(`A${n}`).values = [[label]]; sheet.mergeCells(`G${n}:H${n}`);
    sheet.getRange(`G${n}:H${n}`).format.fill = GRAY; sheet.getRange(`G${n}:H${n}`).format.font = { ...FONT, color: '#FFFFFF' };
    sheet.getRange(`A${n}:I${n}`).format.rowHeightPx = 74;
  }
  sheet.getRange(`G${preRow}`).formulas = [[`=IF(COUNT(G${first}:G${last})=${ordered.length},SUM(G${first}:G${last}),"待确认")`]];
  const activeTax = taxEntries.filter(([name]) => rowNumbers.get(name).length);
  const guard = [`ISNUMBER(G${preRow})`, ...activeTax.map(([name]) => `ISNUMBER(${taxCells.get(name)})`)];
  const taxTerms = activeTax.map(([name]) => `ROUND(SUM(${rowNumbers.get(name).map(n => `G${n}`).join(',')})*${taxCells.get(name)},2)`);
  const formula = `=IF(AND(${guard.join(',')}),ROUND(G${preRow}+${taxTerms.join('+')},2),"待确认")`;
  if (formula.length > 8000) throw new Error('税后公式过长：按税组连续排序并改用连续SUM范围，仍保持单表。');
  sheet.getRange(`G${postRow}`).formulas = [[formula]];
  sheet.getRange(`I${preRow}`).values = [['按明细求和，模块合计不重复计入。']]; sheet.getRange(`I${postRow}`).values = [['按上列税率计算；修改税率将更新总价。']];
  wb.recalculate();
  const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 10 }, maxChars: 1500 });
  if (/"(value|text)":"#/.test(errors.ndjson || '')) throw new Error(`公式错误：${errors.ndjson}`);
  const pretax = expected.some(n => n === null) ? null : round(expected.reduce((a, b) => a + b, 0)); let aftertax = pretax;
  if (pretax !== null) for (const [name, rate] of activeTax) { if (rate === null) { aftertax = null; break; } const base = rowNumbers.get(name).reduce((s, n) => s + expected[n - first], 0); aftertax = round(aftertax + round(base * rate)); }
  const savedPre = sheet.getRange(`G${preRow}`).values[0][0], savedPost = sheet.getRange(`G${postRow}`).values[0][0];
  for (const [want, got, label] of [[pretax, savedPre, '税前总价'], [aftertax, savedPost, '税后总价']]) if (want === null ? got !== '待确认' : typeof got !== 'number' || Math.abs(got - want) > 0.011) throw new Error(`${label}核对失败：${got} / ${want}`);
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await (await SpreadsheetFile.exportXlsx(wb)).save(output);
  if (previewDir) {
    await fs.mkdir(previewDir, { recursive: true }); let start = 1, part = 1, pixels = 0;
    for (let n = 1; n <= postRow; n++) { pixels += sheet.getRange(`A${n}:I${n}`).format.rowHeightPx;
      if (pixels >= 1000 || n === postRow) { const blob = await wb.render({ sheetName: '报价清单', range: `A${start}:I${n}`, scale: 1, format: 'png' }); await fs.writeFile(path.join(previewDir, `报价清单-${part++}.png`), new Uint8Array(await blob.arrayBuffer())); start = n + 1; pixels = 0; }
    }
    await fs.writeFile(path.join(previewDir, 'verification.json'), JSON.stringify({ detailRows: ordered.length, moduleRanges, pretax, aftertax, preRow, postRow }, null, 2));
  }
  return { workbook: wb, sheet, preRow, postRow, first, last, pretax, aftertax };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, flag, previewDir] = process.argv.slice(2);
  if (!input || !output || (flag && flag !== '--preview-dir') || (flag && !previewDir)) { console.error('用法：node build_quote.mjs 输入.json 输出.xlsx [--preview-dir 目录]'); process.exit(2); }
  try { const data = JSON.parse(await fs.readFile(input, 'utf8')); const r = await buildQuote(data, output, previewDir); console.log(JSON.stringify({ output, detailRows: data.rows.length, pretax: r.pretax, aftertax: r.aftertax })); }
  catch (error) { console.error(error.message); process.exit(1); }
}
