export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function actionOk(): ActionResult<void>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data: data as T };
}

export function actionFail(error: string): ActionResult<never> {
  return { ok: false, error };
}

export function isActionFailure<T>(
  result: ActionResult<T>,
): result is { ok: false; error: string } {
  return !result.ok;
}
