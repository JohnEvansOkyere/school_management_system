import { test,expect,Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const {JobWorker}=require('../backend/dist/jobs/worker');
const school='10000000-0000-4000-8000-000000000001';
test.beforeEach(async({page})=>{await page.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));});
async function signIn(page:Page,email='head@example.test') {
  await page.goto('/');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'School',exact:true}).selectOption(school);
  await expect(page.getByRole('heading',{name:'Adinkra Synthetic School',exact:true})).toBeVisible();
}
test('admission decisions, enrolment, transfer and reload preserve history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const suffix=randomUUID().slice(0,8),yearName=`Browser year ${suffix}`,first=`Primary Blue ${suffix}`,second=`Primary Green ${suffix}`,name=`Synthetic Browser Learner ${suffix}`,admission=`WEB-${suffix}`;
  await signIn(page);await page.getByRole('button',{name:'School setup: academic years and classes',exact:true}).click();
  await page.getByLabel('Year name',{exact:true}).fill(yearName);await page.getByLabel('Start date',{exact:true}).fill('2026-09-01');await page.getByLabel('End date (exclusive)',{exact:true}).fill('2027-08-01');await page.getByRole('button',{name:'Add academic year',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Academic year added.'})).toBeVisible();
  for(const className of [first,second]) {
    await page.getByLabel('Class name',{exact:true}).fill(className);await page.getByLabel('Capacity',{exact:true}).fill('5');await page.getByRole('combobox',{name:'Academic year',exact:true}).selectOption({label:yearName});
    await page.getByRole('button',{name:'Add class',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Class added.'})).toBeVisible();await expect(page.getByLabel('Class name',{exact:true})).toHaveValue('');
  }
  await page.getByLabel('Learner full name',{exact:true}).fill(name);await page.getByLabel('Admission number',{exact:true}).fill(admission);await page.getByRole('combobox',{name:'Intended class',exact:true}).selectOption({label:`${first} · Primary · ${yearName}`});await page.getByLabel('Proposed start date',{exact:true}).fill('2026-09-01');await page.getByRole('button',{name:'Record application',exact:true}).click();
  const application=page.locator('li').filter({hasText:admission});await expect(application).toContainText('Application');
  for(const action of ['Start review','Offer place','Record acceptance','Enrol learner']){await application.getByRole('button',{name:action,exact:true}).click();await expect(application.getByRole('button',{name:action,exact:true})).toHaveCount(0);}
  await expect(application).toContainText('Enrolled');await page.getByRole('combobox',{name:'Find a learner',exact:true}).selectOption({label:`${name} · ${admission}`});
  await expect(page.getByRole('heading',{name:'Class history',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'New class',exact:true}).selectOption({label:`${second} · Primary · ${yearName}`});await page.getByLabel('Effective date',{exact:true}).fill('2026-10-01');await page.getByLabel('Transfer reason',{exact:true}).fill('Synthetic browser transfer review');await page.getByRole('button',{name:'Record transfer',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Previous enrolment history is retained.'})).toBeVisible();await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText('2026-10-01');
  await page.reload();await page.getByRole('combobox',{name:'School',exact:true}).selectOption(school);await page.getByRole('combobox',{name:'Find a learner',exact:true}).selectOption({label:`${name} · ${admission}`});
  const history=page.locator('div').filter({has:page.getByRole('heading',{name:'Class history',exact:true})}).last();
  await expect(history).toContainText('Synthetic browser transfer review');await expect(history).toContainText(second);await expect(history).toContainText('Scheduled');
  await page.setViewportSize({width:375,height:812});await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await history.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/admissions-mobile.png'});expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Withdraw learner',exact:true}).click();await page.getByLabel('Withdrawal date (first day out of class)',{exact:true}).fill('2026-09-29');await page.getByLabel('Withdrawal reason',{exact:true}).fill('Synthetic reviewed school departure');await page.getByRole('button',{name:'Record withdrawal',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Withdrawal recorded.'})).toBeVisible();await expect(page.getByRole('button',{name:'Record transfer',exact:true})).toHaveCount(0);
  await page.reload();await page.getByRole('combobox',{name:'School',exact:true}).selectOption(school);await page.getByRole('combobox',{name:'Find a learner',exact:true}).selectOption({label:`${name} · ${admission}`});
  await expect(page.locator('li').filter({hasText:'Synthetic reviewed school departure'}).filter({hasText:'2026-09-29'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:second}).filter({hasText:'Superseded'})).toHaveCount(1);await expect(page.locator('li').filter({hasText:'Synthetic browser transfer review'})).toContainText(first);
  await expect(page.getByText('No open enrolment. Previous learner and class records are retained.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Withdraw learner',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
test('authorized audit export is generated and downloaded with tenant-scoped records',async({page})=>{
  await signIn(page);await page.getByRole('button',{name:'Export audit history',exact:true}).click();await page.getByRole('button',{name:'Prepare export',exact:true}).click();await expect(page.getByRole('button',{name:'Check export progress',exact:true})).toBeVisible();
  const worker=new JobWorker();try{await worker.runOnce();}finally{await worker.close();}
  await page.getByRole('button',{name:'Check export progress',exact:true}).click();await expect(page.getByRole('button',{name:'Download audit JSON',exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download audit JSON',exact:true}).click();const download=await downloadEvent;await download.saveAs('.local/browser-audit-export.json');
  const result=JSON.parse(await readFile('.local/browser-audit-export.json','utf8'));expect(result.schoolId).toBe(school);expect(result.rows.length).toBeGreaterThan(0);expect(result.rows.length).toBeLessThanOrEqual(500);
});
test('teacher browser exposes no admissions controls and server rejects direct administration',async({page})=>{
  await signIn(page,'teacher@example.test');await expect(page.getByRole('heading',{name:'Admissions and learners',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export audit history',exact:true})).toHaveCount(0);
  const denied=await page.request.get(`/api/v1/schools/${school}/admissions`);expect(denied.status()).toBe(403);
});
test('guardian verification, distinct rights and revocation persist across two browser sessions',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page);
  const suffix=randomUUID().slice(0,8),name=`Synthetic Guardian Child ${suffix}`,admission=`FAM-${suffix}`;
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  async function post(route:string,body:Record<string,unknown>){const response=await page.request.post(`/api/v1/schools/${school}${route}`,{headers:{'x-csrf-token':session.csrfToken},data:{operationId:randomUUID(),...body}});expect(response.status(),await response.text()).toBe(201);return response.json();}
  const year=await post('/academic-years',{name:`Family year ${suffix}`,startDate:'2026-09-01',endDate:'2027-08-01'}),section=await post('/classes',{name:`Family class ${suffix}`,level:'Primary',capacity:5,academicYearId:year.id});
  let application=await post('/admissions',{fullName:name,dateOfBirth:'2018-05-03',admissionNumber:admission,classId:section.id,startDate:'2026-09-01'});
  for(const action of ['review','offer','accept','enrol'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});
  const family=page.locator('section').filter({has:page.getByRole('heading',{name:'Guardian rights',exact:true})});
  await family.getByLabel('Search learners',{exact:true}).fill(name);await family.getByRole('button',{name:'Search learners',exact:true}).click();await family.getByRole('combobox',{name:'Learner',exact:true}).selectOption({label:`${name} · ${admission}`});
  async function create(right:string){await family.getByRole('combobox',{name:'Existing active guardian',exact:true}).selectOption('30000000-0000-4000-8000-000000000004');await family.getByRole('checkbox',{name:right,exact:true}).check();await family.getByRole('button',{name:'Create pending guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'pending verification'})).toBeVisible();}
  await create('Billing information');let pending=family.locator('li').filter({hasText:name}).filter({hasText:'Pending verification'});await expect(pending).toBeVisible();
  const context=await browser.newContext();const portal=await context.newPage();portal.on('pageerror',error=>errors.push(error.message));await portal.clock.setFixedTime(new Date('2026-09-28T10:00:00Z'));
  try{
    await signIn(portal,'guardian@example.test');await expect(portal.getByRole('heading',{name:'Guardian portal',exact:true})).toBeVisible();await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);
    await pending.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed billing authority');await pending.getByRole('button',{name:'Verify guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link verified.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await portal.getByRole('combobox',{name:'Linked child',exact:true}).selectOption({label:`${name} · ${admission}`});await expect(portal.getByRole('heading',{name:'Your verified access',exact:true})).toBeVisible();await expect(portal.getByRole('heading',{name:'Academic information',exact:true})).toHaveCount(0);
    const billing=await (await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).json();expect(billing.billing).toBe(true);expect(billing).not.toHaveProperty('date_of_birth');expect(billing).not.toHaveProperty('enrolments');
    const verified=family.locator('li').filter({hasText:name}).filter({hasText:'Synthetic reviewed billing authority'});await verified.getByLabel('Revocation reason',{exact:true}).fill('Synthetic sponsor authority ended');await verified.getByRole('button',{name:'Revoke guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link revoked.'})).toBeVisible();
    expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${application.learner_id}`)).status()).toBe(404);await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);
    await create('Academic records');pending=family.locator('li').filter({hasText:name}).filter({hasText:'Pending verification'});await pending.getByLabel('Reviewed verification reason',{exact:true}).fill('Synthetic reviewed academic authority');await pending.getByRole('button',{name:'Verify guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link verified.'})).toBeVisible();
    await portal.reload();await portal.getByRole('combobox',{name:'School',exact:true}).selectOption(school);await portal.getByRole('combobox',{name:'Linked child',exact:true}).selectOption({label:`${name} · ${admission}`});await expect(portal.getByText('Date of birth: 2018-05-03',{exact:true})).toBeVisible();await expect(portal.locator('li').filter({hasText:`Family class ${suffix}`})).toContainText('Active today');
    await portal.setViewportSize({width:375,height:812});expect(await portal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await portal.getByRole('heading',{name:'Guardian portal',exact:true}).scrollIntoViewIfNeeded();await portal.screenshot({path:'.local/guardian-mobile.png'});
    expect((await portal.request.get(`/api/v1/schools/${school}/learners/${application.learner_id}`)).status()).toBe(403);expect((await portal.request.get(`/api/v1/schools/${school}/guardian/children/${randomUUID()}`)).status()).toBe(404);
    const academic=family.locator('li').filter({hasText:name}).filter({hasText:'Synthetic reviewed academic authority'});await academic.getByLabel('Revocation reason',{exact:true}).fill('Synthetic academic authority ended');await academic.getByRole('button',{name:'Revoke guardian link',exact:true}).click();await expect(family.getByRole('status').filter({hasText:'Guardian link revoked.'})).toBeVisible();
    await portal.getByRole('button',{name:'Refresh guardian records',exact:true}).click();await expect(portal.getByText('Date of birth: 2018-05-03',{exact:true})).toHaveCount(0);await expect(portal.locator('option').filter({hasText:admission})).toHaveCount(0);expect(errors).toEqual([]);
  }finally{await context.close();}
});
