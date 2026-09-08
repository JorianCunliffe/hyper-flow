import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
if(!process.env.CODEX_ARTIFACT_TOOL_MODULE)throw new Error('Set CODEX_ARTIFACT_TOOL_MODULE to the bundled artifact tool module URL');
const {FileBlob,SpreadsheetFile,PresentationFile}=await import(process.env.CODEX_ARTIFACT_TOOL_MODULE);
const base=path.resolve('docs/implementation/evidence/P09-artifacts');
const workbook=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(base,'weekly-report.xlsx')));
workbook.recalculate();
const summary=workbook.worksheets.getItem('Weekly report'),work=workbook.worksheets.getItem('Accepted work');
assert.equal(Number(summary.getRange('B8').values[0][0]),1);
work.getRange('F2').values=[['fulfilled']];workbook.recalculate();assert.equal(Number(summary.getRange('B8').values[0][0]),0);assert.equal(Number(summary.getRange('B9').values[0][0]),2);
work.getRange('F2').values=[['accepted']];workbook.recalculate();assert.equal(Number(summary.getRange('B8').values[0][0]),1);
for(const [name,range,file] of [['Weekly report','A1:C19','workbook-summary'],['Accepted work','A1:F3','workbook-work'],['Accepted work','G1:M3','workbook-dates'],['Evidence','A1:D2','workbook-evidence']]){
 const png=await workbook.render({sheetName:name,range,scale:1.5,format:'png'});await fs.writeFile(path.join(base,file+'.png'),new Uint8Array(await png.arrayBuffer()));
}
await fs.writeFile(path.join(base,'workbook-review.json'),JSON.stringify({recalculation:'Changing accepted to fulfilled updates the open and fulfilled counts; restored original inputs.',checks:'passed'},null,2));
const bytes=await fs.readFile(path.join(base,'weekly-report.pptx')),zip=await JSZip.loadAsync(bytes),count=zip.file(/^ppt\/slides\/slide\d+\.xml$/).length;
const deck=await PresentationFile.importPptx(await FileBlob.load(path.join(base,'weekly-report.pptx')));
for(let i=0;i<count;i++){const slide=deck.slides.getItem(i),png=await deck.export({slide,format:'png',scale:1});await fs.writeFile(path.join(base,`slide-${i+1}.png`),new Uint8Array(await png.arrayBuffer()));}
console.log(JSON.stringify({workbookRecalculation:'passed',workbookViews:4,slidesRendered:count}));
