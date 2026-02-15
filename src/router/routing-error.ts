/**
 * RoutingError
 *
 * Custom error thrown when no suitable model can be found for a routing request.
 *
 * Story 13-3: Task-to-Model Router
 */

import { TaskType } from '../providers/interfaces/provider.interfaces';
import { TaskRoutingRequest } from './router.interfaces';

/**
 * Error thrown when no suitable model can be found for a routing request.
 */
export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly taskType: TaskType,
    public readonly request: TaskRoutingRequest,
    public readonly attemptedModels: string[],
  ) {
    super(message);
    this.name = 'RoutingError';
    // Restore prototype chain for instanceof checks when targeting ES5
    Object.setPrototypeOf(this, RoutingError.prototype);
  }
}
