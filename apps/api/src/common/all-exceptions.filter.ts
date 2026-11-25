import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { ApiErrorResponseDto } from '@pressedoils/shared'
import type { Request, Response } from 'express'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request & { id?: string }>()
    const requestId = request.id ?? 'unknown'

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR
    let error = 'Internal Server Error'
    let message = 'An unexpected error occurred'
    let details: unknown

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus()
      const exceptionResponse = exception.getResponse()
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
        error = exception.name
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const body = exceptionResponse as Record<string, unknown>
        message =
          typeof body.message === 'string'
            ? body.message
            : Array.isArray(body.message)
              ? body.message.join('; ')
              : exception.message
        error = typeof body.error === 'string' ? body.error : exception.name
        if (body.details !== undefined) {
          details = body.details
        }
      }
    }

    if (statusCode >= 500) {
      this.logger.error({
        alert: 'API_SERVER_ERROR',
        requestId,
        path: request.originalUrl ?? request.url,
        statusCode,
        errName: exception instanceof Error ? exception.name : 'UnknownError',
        errMessage: exception instanceof Error ? exception.message : String(exception),
      })
    }

    const payload: ApiErrorResponseDto = {
      statusCode,
      error,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    }

    response.status(statusCode).json(payload)
  }
}
