import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiErrors } from './core/errors';
import { randomUUID } from 'node:crypto';
export async function createApp() {
  const app = await NestFactory.create(AppModule,{logger:['error','warn']});
  app.use(helmet());
  const attempts = new Map<string,{count:number;until:number}>();
  app.use((req:Request,res:Response,next:NextFunction) => {
    res.setHeader('x-request-id',randomUUID());
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host??'')) return res.status(403).json({message:'Local host required'});
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({message:'Request origin was not accepted'});
    if (req.path === '/api/v1/auth/login' && req.method === 'POST') {
      const address=req.socket.remoteAddress??'unknown';const now=Date.now();
      for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
      const current=attempts.get(address)??{count:0,until:now+60_000};current.count++;attempts.set(address,current);
      if(current.count>30)return res.status(429).json({message:'Too many sign-in attempts. Try again in a minute'});
    }
    next();
  });
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  return app;
}
if (require.main === module) createApp().then(app => app.listen(3018,'127.0.0.1'));
