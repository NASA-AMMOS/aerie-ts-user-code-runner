import type ts from "typescript";

function callMapper(msg: string, code: number, errorCodeMessageMappers: {[errorCode: number]: (message: string) => string | undefined}): string {
  const messageMapper = errorCodeMessageMappers[code];
  if (messageMapper === undefined) {
    return msg;
  }
  const mappedMessage = messageMapper(msg);
  if (mappedMessage === undefined) {
    throw new Error(`Insufficient message mapper found for ts diagnostic code ${code}`);
  }
  return mappedMessage;
}

export function createMapDiagnosticMessage(errorCodeMessageMappers: {[errorCode: number]: (message: string) => string | undefined}) {
  function mapDiagnosticMessageChain(msg: string | ts.DiagnosticMessageChain, code: number): string[] {
    let errorMessages: string[] = [];
    if (typeof msg === 'string') {
      if (code === undefined) {
        throw new Error('Must provide a code when mapping a string message');
      }
      errorMessages.push(callMapper(msg, code, errorCodeMessageMappers));
    } else {
      errorMessages.push(callMapper(msg.messageText, msg.code, errorCodeMessageMappers));
      if (msg.next) {
        for (const next of msg.next) {
          errorMessages = errorMessages.concat(mapDiagnosticMessageChain(next, next.code).map(m => `  ${m}`));
        }
      }
    }
    return errorMessages;
  }
  function mapDiagnosticMessage(diagnostic:  ts.Diagnostic): string[] {
    return mapDiagnosticMessageChain(diagnostic.messageText, diagnostic.code);
  }
  return mapDiagnosticMessage;
}
