import type { EditorAction, EditorDispatch } from './actions';

/**
 * What a viewer's editor may still do to the document: take what the server
 * sends. Everything else — every edit, and undo/redo, which would fork the
 * canvas from what is saved — is dropped before it reaches the reducer, so no
 * control has to remember to check. Controls are disabled as well, so nothing
 * looks like it works and silently does not.
 */
export function allowedWhenReadOnly(action: EditorAction): boolean {
  return action.type === 'load' || (action.type === 'replaceModel' && action.origin === 'remote');
}

export function guardDispatch(dispatch: EditorDispatch, readOnly: boolean): EditorDispatch {
  if (!readOnly) return dispatch;
  return (action) => {
    if (allowedWhenReadOnly(action)) dispatch(action);
  };
}
