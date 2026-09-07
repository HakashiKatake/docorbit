export class DocOrbitError extends Error {
  code: string;

  constructor(message: string, code: string = 'DOCORBIT_ERROR') {
    super(message);
    this.name = 'DocOrbitError';
    this.code = code;
  }
}

export class SsrfError extends DocOrbitError {
  ip?: string;
  host?: string;

  constructor(message: string, ip?: string, host?: string) {
    super(message, 'SSRF_BLOCKED');
    this.name = 'SsrfError';
    this.ip = ip;
    this.host = host;
  }
}

export class FetchTimeoutError extends DocOrbitError {
  timeoutMs?: number;

  constructor(message: string, timeoutMs?: number) {
    super(message, 'FETCH_TIMEOUT');
    this.name = 'FetchTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class PayloadTooLargeError extends DocOrbitError {
  byteCount?: number;
  maxBytes?: number;

  constructor(message: string, byteCount?: number, maxBytes?: number) {
    super(message, 'PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLargeError';
    this.byteCount = byteCount;
    this.maxBytes = maxBytes;
  }
}

export class ValidationError extends DocOrbitError {
  validationDetails?: unknown;

  constructor(message: string, validationDetails?: unknown) {
    super(message, 'VALIDATION_FAILED');
    this.name = 'ValidationError';
    this.validationDetails = validationDetails;
  }
}
