import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PageDto } from '../learners/learners.dto';

class DayQueryDto {
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;
}
class AbsenceQueryDto extends PageDto {
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) days = 14;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(60) threshold = 3;
}
// Attendance that drives action: which registers are outstanding, and which learners keep missing school.
@Controller('api/v1/schools/:schoolId/attendance')
export class AttendanceFollowUpController {
  constructor(private readonly access: Access) {}
  @Get('follow-up')
  followUp(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: DayQueryDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => {
      const day = query.day ?? (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string;
      const open = (await client.query('SELECT 1 FROM school_days WHERE school_id=$1 AND day=$2 AND is_open=true',[schoolId,day])).rowCount! > 0;
      if (!open) return {day,open:false,classes:[]};
      const classes = (await client.query(`
        SELECT c.id AS class_id,c.name,c.level,
          (SELECT count(*) FROM enrolments e WHERE e.school_id=c.school_id AND e.class_id=c.id AND e.superseded_at IS NULL AND e.start_date<=$2 AND (e.end_date IS NULL OR e.end_date>$2))::int AS learners,
          coalesce(r.status,'missing') AS register_status
        FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id AND y.start_date<=$2 AND y.end_date>$2
        LEFT JOIN attendance_registers r ON r.school_id=c.school_id AND r.class_id=c.id AND r.day=$2
        WHERE c.school_id=$1 ORDER BY c.name,c.id`,[schoolId,day])).rows.filter(row => row.learners > 0);
      return {day,open:true,classes,outstanding:classes.filter(row => row.register_status === 'missing' || row.register_status === 'draft').length};
    });
  }
  @Get('repeated-absence')
  repeated(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Query() query: AbsenceQueryDto) {
    return this.access.school(req,schoolId,['headteacher'],async client => {
      const to = query.to ?? (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS day")).rows[0].day as string;
      const values = [schoolId,to,query.days,query.threshold];
      const base = `FROM attendance_marks m JOIN attendance_registers r ON r.school_id=m.school_id AND r.id=m.register_id AND r.status IN ('submitted','locked')
        JOIN learners l ON l.school_id=m.school_id AND l.id=m.learner_id
        JOIN class_sections c ON c.school_id=r.school_id AND c.id=r.class_id
        WHERE m.school_id=$1 AND m.mark='absent' AND r.day<=$2::date AND r.day>$2::date-$3::int GROUP BY l.id,l.full_name,l.admission_number,c.name HAVING count(*)>=$4`;
      const total = (await client.query(`SELECT count(*) FROM (SELECT 1 ${base}) t`,values)).rows[0].count as string;
      const items = (await client.query(`SELECT l.id AS learner_id,l.full_name,l.admission_number,c.name AS class_name,count(*)::int AS absences,max(r.day)::text AS last_absent_day ${base} ORDER BY absences DESC,l.full_name,l.id LIMIT $5 OFFSET $6`,[...values,query.limit,query.offset])).rows;
      return {to,days:query.days,threshold:query.threshold,items,total:Number(total),limit:query.limit,offset:query.offset};
    });
  }
}
