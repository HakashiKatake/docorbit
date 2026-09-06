export class DocRouterError extends Error {
  code: string;

  constructor(message: string, code: string = 'DOCROUTER_ERROR') {
    super(message);
    this.name = 'DocRouterError';
    this.code = code;
  }
}

export class SsrfError extends DocRouterError {
  ip?: string;
  host?: string;

  constructor(message: string, ip?: string, host?: string) {
    super(message, 'SSRF_BLOCKED');
    this.name = 'SsrfError';
    this.ip = ip;
    this.host = host;
  }
}

export class FetchTimeoutError extends DocRouterError {
  timeoutMs?: number;

  constructor(message: string, timeoutMs?: number) {
    super(message, 'FETCH_TIMEOUT');
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class PayloadTooLargeError extends DocRouterError {
  byteCount?: number;
  maxBytes?: number;

  constructor(message: string, byteCount?: number, maxBytes?: number) {
    super(message, 'PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLargeError';
    this.byteCount = byteCount;
    this.maxBytes = maxBytes;
  }
}

export class ValidationError extends DocRouterError {
  validationDetails?: unknown;

  constructor(message: string, validationDetails?: unknown) {
    super(message, 'VALIDATION_FAILED');
    this.name = 'ValidationError';
    this.validationDetails = validationDetails;
  }
}
