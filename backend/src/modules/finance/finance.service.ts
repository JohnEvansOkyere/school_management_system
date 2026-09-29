import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { FeeItemDto, GenerateInvoicesDto, InvoiceQueryDto, PaymentDto, ReverseDto } from './finance.dto';

// Paid = payments that have not been reversed. bigint sums come back as strings; they stay whole pesewas.
const paidSql = `coalesce((SELECT sum(p.amount_pesewas) FROM payments p WHERE p.school_id=i.school_id AND p.invoice_id=i.id
  AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.school_id=p.school_id AND r.payment_id=p.id)),0)`;
const money = (value: string | number) => Number(value);

@Injectable()
export class FinanceService {
  private async term(client: PoolClient, schoolId: string, termId: string) {
    const row = (await client.query('SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 AND id=$2',[schoolId,termId])).rows[0];
    if (!row) throw new NotFoundException('Term unavailable');
    return row;
  }
  createFeeItem(client: PoolClient, actor: Actor, body: FeeItemDto) {
    return command(client,actor,body.operationId,'finance.fee-item',body,async () => {
      await this.term(client,actor.schoolId,body.termId);
      const row = (await client.query('INSERT INTO fee_items(id,school_id,term_id,name,level,amount_pesewas,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,term_id,name,level,amount_pesewas::float8 AS amount_pesewas',[randomUUID(),actor.schoolId,body.termId,body.name.trim(),body.level ?? null,body.amountPesewas,actor.membershipId])).rows[0];
      await audit(client,actor,'finance.fee-item.created',row.id,{amountPesewas:body.amountPesewas});
      return row;
    });
  }
  async feeItems(client: PoolClient, schoolId: string, termId?: string) {
    return (await client.query('SELECT id,term_id,name,level,amount_pesewas::float8 AS amount_pesewas FROM fee_items WHERE school_id=$1 AND ($2::uuid IS NULL OR term_id=$2) ORDER BY name,id',[schoolId,termId ?? null])).rows;
  }
  generate(client: PoolClient, actor: Actor, body: GenerateInvoicesDto) {
    return command(client,actor,body.operationId,'finance.invoices.generate',body,async () => {
      const term = await this.term(client,actor.schoolId,body.termId);
      const section = (await client.query('SELECT id,level FROM class_sections WHERE school_id=$1 AND id=$2',[actor.schoolId,body.classId])).rows[0];
      if (!section) throw new NotFoundException('Class unavailable');
      const items = (await client.query('SELECT name,amount_pesewas::float8 AS amount FROM fee_items WHERE school_id=$1 AND term_id=$2 AND (level IS NULL OR level=$3) ORDER BY name,id',[actor.schoolId,body.termId,section.level])).rows;
      if (!items.length) throw new ConflictException('Add fee items for this term and class level first');
      const lines = items.map(item => ({name:item.name,amountPesewas:item.amount})), total = lines.reduce((sum,line) => sum + line.amountPesewas,0);
      const learners = (await client.query('SELECT DISTINCT e.learner_id FROM enrolments e WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<$4 AND (e.end_date IS NULL OR e.end_date>$3)',[actor.schoolId,body.classId,term.start_date,term.end_date])).rows;
      let created = 0;
      for (const learner of learners) {
        const made = await client.query('INSERT INTO invoices(id,school_id,learner_id,term_id,class_id,lines,total_pesewas,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(school_id,learner_id,term_id) DO NOTHING',[randomUUID(),actor.schoolId,learner.learner_id,body.termId,body.classId,JSON.stringify(lines),total,actor.membershipId]);
        created += made.rowCount ?? 0;
      }
      await audit(client,actor,'finance.invoices.generated',body.classId,{termId:body.termId,created,totalPerLearnerPesewas:total});
      return {created,alreadyInvoiced:learners.length - created,totalPerLearnerPesewas:total};
    });
  }
  async invoices(client: PoolClient, schoolId: string, query: InvoiceQueryDto) {
    const search = `%${(query.search ?? '').trim().replace(/[\\%_]/g,'\\$&')}%`;
    const filter = `i.school_id=$1 AND i.term_id=$2 AND ($3::uuid IS NULL OR i.class_id=$3) AND (l.full_name ILIKE $4 ESCAPE '\\' OR l.admission_number ILIKE $4 ESCAPE '\\')`;
    const values = [schoolId,query.termId,query.classId ?? null,search];
    const from = `FROM invoices i JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id JOIN class_sections c ON c.school_id=i.school_id AND c.id=i.class_id`;
    const having = query.outstandingOnly ? ` AND i.total_pesewas > ${paidSql}` : '';
    const total = (await client.query(`SELECT count(*) ${from} WHERE ${filter}${having}`,values)).rows[0].count;
    const items = (await client.query(`SELECT i.id,i.learner_id,l.full_name,l.admission_number,c.name AS class_name,i.total_pesewas::float8 AS total_pesewas,${paidSql}::float8 AS paid_pesewas,i.lines ${from} WHERE ${filter}${having} ORDER BY l.full_name,i.id LIMIT $5 OFFSET $6`,[...values,query.limit,query.offset])).rows
      .map(row => ({...row,balance_pesewas:row.total_pesewas - row.paid_pesewas}));
    return {items,total:Number(total),limit:query.limit,offset:query.offset};
  }
  payment(client: PoolClient, actor: Actor, body: PaymentDto) {
    return command(client,actor,body.operationId,'finance.payment',body,async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`invoice:${actor.schoolId}:${body.invoiceId}`]);
      const invoice = (await client.query(`SELECT i.id,i.learner_id,i.total_pesewas::float8 AS total,${paidSql}::float8 AS paid FROM invoices i WHERE i.school_id=$1 AND i.id=$2`,[actor.schoolId,body.invoiceId])).rows[0];
      if (!invoice) throw new NotFoundException('Invoice unavailable');
      const balance = invoice.total - invoice.paid;
      if (body.amountPesewas > balance) throw new ConflictException(`Payment is more than the balance of ${balance} pesewas`);
      const receipt = (await client.query('INSERT INTO receipt_counters(school_id,next_number) VALUES($1,2) ON CONFLICT(school_id) DO UPDATE SET next_number=receipt_counters.next_number+1 RETURNING next_number-1 AS number',[actor.schoolId])).rows[0].number as number;
      const row = (await client.query('INSERT INTO payments(id,school_id,invoice_id,amount_pesewas,method,reference,received_on,receipt_number,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,receipt_number',[randomUUID(),actor.schoolId,body.invoiceId,body.amountPesewas,body.method,body.reference?.trim() ?? null,body.receivedOn,receipt,actor.membershipId])).rows[0];
      await audit(client,actor,'finance.payment.recorded',row.id,{amountPesewas:body.amountPesewas,method:body.method,receiptNumber:receipt});
      return {id:row.id,receiptNumber:row.receipt_number,balancePesewas:balance - body.amountPesewas};
    });
  }
  reverse(client: PoolClient, actor: Actor, paymentId: string, body: ReverseDto) {
    return command(client,actor,body.operationId,'finance.payment.reverse',{paymentId,...body},async () => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payment:${actor.schoolId}:${paymentId}`]);
      const payment = (await client.query('SELECT id FROM payments WHERE school_id=$1 AND id=$2',[actor.schoolId,paymentId])).rows[0];
      if (!payment) throw new NotFoundException('Payment unavailable');
      if ((await client.query('SELECT 1 FROM payment_reversals WHERE school_id=$1 AND payment_id=$2',[actor.schoolId,paymentId])).rowCount) throw new ConflictException('This payment was already reversed');
      await client.query('INSERT INTO payment_reversals(id,school_id,payment_id,reason,reversed_by) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.schoolId,paymentId,body.reason.trim(),actor.membershipId]);
      await audit(client,actor,'finance.payment.reversed',paymentId,{reason:body.reason.trim()});
      return {reversed:true};
    });
  }
  async receipt(client: PoolClient, schoolId: string, paymentId: string) {
    const row = (await client.query(`SELECT p.id,p.receipt_number,p.amount_pesewas::float8 AS amount_pesewas,p.method,p.reference,p.received_on::text,p.recorded_at,
        l.full_name,l.admission_number,t.name AS term_name,s.name AS school_name,i.total_pesewas::float8 AS invoice_total,r.reason AS reversal_reason
      FROM payments p JOIN invoices i ON i.school_id=p.school_id AND i.id=p.invoice_id JOIN learners l ON l.school_id=i.school_id AND l.id=i.learner_id
      JOIN terms t ON t.school_id=i.school_id AND t.id=i.term_id JOIN schools s ON s.id=p.school_id
      LEFT JOIN payment_reversals r ON r.school_id=p.school_id AND r.payment_id=p.id WHERE p.school_id=$1 AND p.id=$2`,[schoolId,paymentId])).rows[0];
    if (!row) throw new NotFoundException('Payment unavailable');
    return row;
  }
  async summary(client: PoolClient, schoolId: string, termId: string) {
    await this.term(client,schoolId,termId);
    const row = (await client.query(`SELECT count(*)::int AS invoices,coalesce(sum(i.total_pesewas),0)::float8 AS billed,coalesce(sum(${paidSql}),0)::float8 AS collected FROM invoices i WHERE i.school_id=$1 AND i.term_id=$2`,[schoolId,termId])).rows[0];
    return {invoices:row.invoices,billedPesewas:row.billed,collectedPesewas:row.collected,outstandingPesewas:row.billed - row.collected};
  }
  async statement(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT id FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND billing=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rows[0];
    if (!link) throw new NotFoundException('Child unavailable');
    const invoices = (await client.query(`SELECT i.id,t.name AS term_name,i.total_pesewas::float8 AS total_pesewas,${paidSql}::float8 AS paid_pesewas,i.lines FROM invoices i JOIN terms t ON t.school_id=i.school_id AND t.id=i.term_id WHERE i.school_id=$1 AND i.learner_id=$2 ORDER BY t.start_date DESC,i.id`,[actor.schoolId,learnerId])).rows;
    return {items:invoices.map(row => ({...row,balance_pesewas:row.total_pesewas - row.paid_pesewas}))};
  }
}
