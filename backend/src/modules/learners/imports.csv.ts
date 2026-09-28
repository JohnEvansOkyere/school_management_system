import { BadRequestException } from '@nestjs/common';
export type ImportInput={admissionNumber:string;fullName:string;dateOfBirth:string;columnCount:number};
export type CsvRow={rowNumber:number;input:ImportInput};

export function parseLearnerCsv(source:string):CsvRow[]{
  const csv=source.replace(/^\uFEFF/,'');const records:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  const endField=()=>{row.push(field);field='';closed=false;};
  const endRow=()=>{endField();records.push(row);row=[];if(records.length>201)throw new BadRequestException('Import at most 200 CSV records at a time');};
  for(let i=0;i<csv.length;i++){
    const char=csv[i];
    if(quoted){if(char==='"'){if(csv[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=char;continue;}
    if(char===','){endField();continue;}
    if(char==='\r'||char==='\n'){endRow();if(char==='\r'&&csv[i+1]==='\n')i++;continue;}
    if(closed)throw new BadRequestException('CSV has text after a closing quote');
    if(char==='"'){if(field)throw new BadRequestException('CSV quotes must begin a field');quoted=true;}else field+=char;
  }
  if(quoted)throw new BadRequestException('CSV has an unclosed quoted field');
  if(field||row.length||closed)endRow();
  if(records[0]?.map(value=>value.trim()).join(',')!=='admission_number,full_name,date_of_birth')throw new BadRequestException('Use the CSV header admission_number,full_name,date_of_birth');
  const rows=records.slice(1).flatMap((cells,index)=>cells.every(value=>!value.trim())?[]:[{rowNumber:index+2,input:{admissionNumber:(cells[0]??'').trim(),fullName:(cells[1]??'').trim(),dateOfBirth:(cells[2]??'').trim(),columnCount:cells.length}}]);
  if(!rows.length)throw new BadRequestException('CSV needs at least one learner record');
  return rows;
}
