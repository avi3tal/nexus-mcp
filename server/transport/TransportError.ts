export enum TransportErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_CLOSED = 'CONNECTION_CLOSED',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  MESSAGE_RECEIVE_FAILED = 'MESSAGE_RECEIVE_FAILED',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  RECONNECTION_FAILED = 'RECONNECTION_FAILED'
}

export class TransportError extends Error {
  constructor(
    message: string,
    public readonly code: TransportErrorCode,
    public readonly details?: unknown,
    public readonly retryable: boolean = true
  ) {
    super(message);
    this.name = 'TransportError';
  }

  static fromError(error: Error, code: TransportErrorCode, details?: unknown): TransportError {
    return new TransportError(error.message, code, details);
  }

  static connectionFailed(url: string, error: Error): TransportError {
    return new TransportError(
      `Failed to connect to ${url}: ${error.message}`,
      TransportErrorCode.CONNECTION_FAILED,
      { url, originalError: error }
    );
  }

  static connectionTimeout(url: string, timeout: number): TransportError {
    return new TransportError(
      `Connection to ${url} timed out after ${timeout}ms`,
      TransportErrorCode.CONNECTION_TIMEOUT,
      { url, timeout }
    );
  }

  static messageSendFailed(message: unknown, error: Error): TransportError {
    return new TransportError(
      `Failed to send message: ${error.message}`,
      TransportErrorCode.MESSAGE_SEND_FAILED,
      { message, originalError: error }
    );
  }
} 