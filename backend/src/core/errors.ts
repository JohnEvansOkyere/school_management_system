import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost) {
    const req=host.switchToHttp().getRequest<Request>();const res=host.switchToHttp().getResponse<Response>();
    const status=error instanceof HttpException?error.getStatus():500;
    const detail=error instanceof HttpException?error.getResponse():{message:'The request could not be completed'};
    const message=typeof detail==='string'?detail:(detail as {message?:unknown}).message;
    if(status>=500)console.error(JSON.stringify({requestId:res.getHeader('x-request-id'),path:req.path,code:(error as {code?:string})?.code??'INTERNAL_ERROR'}));
    res.status(status).json({statusCode:status,code:status===500?'INTERNAL_ERROR':`HTTP_${status}`,message,requestId:res.getHeader('x-request-id')});
  }
}
