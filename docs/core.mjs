export const HEADERS = ['序号','功能模块名称','功能模块描述','工种','人工单价','工时','模块总价','模块合计','备注建议'];
export const GROUPS = ['软件','硬件','服务'];
const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function scaled(value, factor=100) {
  if (value === '' || value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole,decimal=''] = s.split('.');
  const number = BigInt(whole)*100n + BigInt(decimal.padEnd(2,'0'));
  if (number > 10000000000n) return null;
  return number * BigInt(factor) / 100n;
}
export const currency = cents => cents === null ? '待确认' : (Number(cents)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const rounded = (a,b,divisor) => (a*b+divisor/2n)/divisor;
export function rowCents(row) {
  const a = scaled(row.kind==='labor' ? row.unit_rate : row.unit_price);
  const b = scaled(row.kind==='labor' ? row.hours : row.quantity);
  return a===null || b===null ? null : rounded(a,b,100n);
}
export function groupRows(rows) {
  const groups = new Map();
  rows.forEach((row,index)=> {
    const name = row.module.trim() || '未命名模块';
    if (!groups.has(name)) groups.set(name,[]);
    groups.get(name).push({...row,module:name,sourceIndex:index});
  });
  return [...groups].map(([name,items])=>({name,items,total:items.some(r=>rowCents(r)===null) ? null : items.reduce((sum,r)=>sum+rowCents(r),0n)}));
}
export function totals(rows, taxes) {
  const groups = groupRows(rows);
  const amounts = rows.map(rowCents);
  const pretax = !rows.length || amounts.includes(null) ? null : amounts.reduce((a,b)=>a+b,0n);
  let aftertax = pretax;
  const bases = {};
  rows.forEach((row,index)=> { if (amounts[index]!==null) bases[row.tax_group]=(bases[row.tax_group] || 0n)+amounts[index]; });
  if (pretax!==null) for (const [name,base] of Object.entries(bases)) {
    const rate = scaled(taxes[name]);
    if (rate===null || rate>10000n) { aftertax=null; break; }
    aftertax += rounded(base,rate,10000n);
  }
  return {groups,pretax,aftertax,bases};
}
export function issues(rows,taxes) {
  const result=[];
  if (!rows.length) result.push('请先加入至少一条功能或采购条目');
  rows.forEach((r,i)=> {
    if (!r.module.trim()) result.push(`第${i+1}项：模块名称待填写`);
    if (!r.description.trim()) result.push(`第${i+1}项：功能描述待填写`);
    if (r.kind==='labor' && (!r.role.trim() || r.role==='待确认')) result.push(`第${i+1}项：工种待确认`);
    if (rowCents(r)===null) result.push(`第${i+1}项：${r.kind==='labor'?'单价或工时':'数量或采购单价'}待确认`);
  });
  [...new Set(rows.map(r=>r.tax_group))].forEach(g=> { const rate=scaled(taxes[g]); if(rate===null||rate>10000n) result.push(`${g}税率待确认`); });
  return result;
}
export function emptyRow(description='') {
  return {module:'',description,role:'',kind:'labor',unit_rate:'',hours:'',quantity:'',unit_price:'',unit:'台',tax_group:'软件',notes:''};
}
export function displayNotes(row) {
  const notes = [row.notes,`税组：${row.tax_group}`];
  if (row.kind!=='labor') notes.push(`数量：${row.quantity===''?'待确认':row.quantity}${row.unit||'项'}；采购未税单价：${row.unit_price===''?'待确认':row.unit_price}元。`);
  return notes.filter(Boolean).join('\n');
}
function estimatedLines(text,width) {
  return String(text).split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil([...line].reduce((s,c)=>s+(/[\u0000-\u00FF]/.test(c)?1:2),0)/(width-2))),0);
}
export function quoteParts({project,scope,rows,taxes}) {
  if (!rows.length) throw new Error('请先加入报价条目');
  if (rows.length>100) throw new Error('体验版最多支持一百条明细');
  const result=totals(rows,taxes);
  const sheetRows=[],merges=['A1:I1','A2:I2','A3:I3'];
  const widths=[6,22,56,22,14,12,18,18,58];
  const cell=(address,value,style=0,formula=null)=> {
    if (value===null || value===undefined) value='待确认';
    if (formula) return `<c r="${address}" s="${style}"${typeof value==='string'?' t="str"':''}><f>${xml(formula)}</f><v>${xml(typeof value==='bigint'?Number(value)/100:value)}</v></c>`;
    if (typeof value==='number') return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  };
  const append=(number,cells,height=30)=>sheetRows.push(`<row r="${number}" ht="${height}" customHeight="1">${cells.join('')}</row>`);
  append(1,[cell('A1',`${project.trim()||'项目'}报价清单`)],32);
  append(2,[cell('A2','币种：人民币；人工单价：元/小时；工时：人时；金额：元；所有明细均为未税价格。')],30);
  append(3,[cell('A3',scope||'范围及报价参数由使用者确认；未填写的参数显示待确认。')],Math.max(32,estimatedLines(scope||'',160)*19));
  append(5,HEADERS.map((h,i)=>cell('ABCDEFGHI'[i]+'5',h,'BDEFG'.includes('ABCDEFGHI'[i])?5:4)),36);
  let n=6,index=1;
  const taxReferences={};
  result.groups.forEach(group=> {
    const start=n,end=n+group.items.length-1;
    if (end>start) merges.push(`B${start}:B${end}`,`H${start}:H${end}`);
    group.items.forEach((r,offset)=> {
      const amount=rowCents(r);
      const role=r.kind==='labor' ? (r.role||'待确认') : r.kind==='hardware'?'设备采购（非人工）':'第三方服务（非人工）';
      let formula;
      if (r.kind==='labor') formula=`IF(COUNT(E${n}:F${n})<2,"待确认",ROUND(E${n}*F${n},2))`;
      else formula=amount===null?'"待确认"':`ROUND(${Number(r.quantity)}*${Number(r.unit_price)},2)`;
      const cells=[cell(`A${n}`,index++),cell(`C${n}`,r.description||'待确认'),cell(`D${n}`,role,1),cell(`G${n}`,amount,2,formula),cell(`I${n}`,displayNotes(r))];
      if(r.kind==='labor') { cells.push(cell(`E${n}`,scaled(r.unit_rate)===null?'待确认':Number(r.unit_rate),2),cell(`F${n}`,scaled(r.hours)===null?'待确认':Number(r.hours),2)); }
      if(offset===0) cells.push(cell(`B${n}`,group.name,1),cell(`H${n}`,group.total,3,`IF(COUNT(G${start}:G${end})<${group.items.length},"待确认",SUM(G${start}:G${end}))`));
      cells.sort((a,b)=>a.match(/r="([A-I])/)[1].localeCompare(b.match(/r="([A-I])/)[1]));
      const lines=Math.max(estimatedLines(r.description,56),estimatedLines(displayNotes(r),58),estimatedLines(role,22),offset===0?Math.ceil(estimatedLines(group.name,22)/group.items.length):1);
      append(n,cells,Math.max(48,lines*19+12));
      (taxReferences[r.tax_group] ||= []).push(`G${n}`);
      n++;
    });
  });
  const lastDetail=n-1; n++;
  const taxCells={};
  Object.keys(taxReferences).forEach(group=> {
    taxCells[group]=`E${n}`;
    const rawRate=scaled(taxes[group]);
    const rate=rawRate!==null&&rawRate<=10000n?rawRate:null;
    append(n,[cell(`A${n}`,`税率：${group}`),cell(`E${n}`,rate===null?'待确认':Number(rate)/10000,7),cell(`F${n}`,'按本税组未税合计计算税额，四舍五入到分。')],30);
    merges.push(`A${n}:D${n}`,`F${n}:I${n}`); n++;
  });
  const pre=n,post=n+1;
  merges.push(`A${pre}:F${pre}`,`G${pre}:H${pre}`,`A${post}:F${post}`,`G${post}:H${post}`);
  append(pre,[cell(`A${pre}`,'税前总价'),cell(`G${pre}`,result.pretax,6,`IF(COUNT(G6:G${lastDetail})<${rows.length},"待确认",SUM(G6:G${lastDetail}))`)],36);
  const taxFormula=Object.entries(taxReferences).map(([g,refs])=>`ROUND(SUM(${refs.join(',')})*${taxCells[g]},2)`).join('+');
  append(post,[cell(`A${post}`,'税后总价'),cell(`G${post}`,result.aftertax,6,`IF(OR(NOT(ISNUMBER(G${pre})),COUNT(${Object.values(taxCells).join(',')})<${Object.keys(taxCells).length}),"待确认",ROUND(G${pre}+${taxFormula},2))`)],36);
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const prefix='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const sheet=prefix+`<worksheet xmlns="${ns}"><dimension ref="A1:I${post}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const xf=(font=0,fill=0,num=0,align='left')=>`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFont="1" applyFill="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`;
  const styles=prefix+`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00%"/></numFmts><fonts count="3"><font><sz val="12"/><color rgb="FF000000"/><name val="宋体"/><family val="1"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="宋体"/><family val="1"/></font><font><sz val="12"/><color rgb="FFFFFFFF"/><name val="宋体"/><family val="1"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF404040"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8">${xf()}${xf(0,0,0,'center')}${xf(0,0,4,'center')}${xf(0,0,4)}${xf(1,2)}${xf(1,2,0,'center')}${xf(2,2,4,'center')}${xf(0,0,164,'center')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return {
    '[Content_Types].xml':prefix+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels':prefix+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':prefix+`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报价清单" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels':prefix+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':sheet
  };
}
export async function exportQuote(data,Zip) {
  const zip=new Zip();
  Object.entries(quoteParts(data)).forEach(([name,body])=>zip.file(name,body));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
export function checkDocumentArchive(buffer) {
  const data=new DataView(buffer); let end=-1;
  for(let i=data.byteLength-22;i>=Math.max(0,data.byteLength-65557);i--) if(data.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0) throw new Error('文档格式无法读取，请选择有效的文字型办公文档');
  const count=data.getUint16(end+10,true),offset=data.getUint32(end+16,true);
  if(count>1500) throw new Error('文档内容过于复杂，请改用纯文本文件');
  let pos=offset;
  const decoder=new TextDecoder();
  for(let i=0;i<count;i++) {
    if(pos+46>data.byteLength||data.getUint32(pos,true)!==0x02014b50) throw new Error('文档压缩结构不完整');
    const length=data.getUint16(pos+28,true),extra=data.getUint16(pos+30,true),comment=data.getUint16(pos+32,true);
    if(pos+46+length+extra+comment>data.byteLength) throw new Error('文档压缩结构不完整');
    const name=decoder.decode(new Uint8Array(buffer,pos+46,length));
    if(name==='word/document.xml'&&data.getUint32(pos+24,true)>8000000) throw new Error('文档正文过长，请精简后再试');
    pos+=46+length+extra+comment;
  }
}
