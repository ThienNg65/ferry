import { handle } from './envelope'
import { INVOKE_CHANNELS } from '../../shared/contract'
import { OperationRegistry } from '../operations/OperationRegistry'

/** Registers the long-running-operation control handlers (Activity dock tab). */
export function registerOperationsHandlers(): void {
  handle<void>(INVOKE_CHANNELS.operationCancel, (operationId) => {
    OperationRegistry.getInstance().cancel(String(operationId))
  })
}
