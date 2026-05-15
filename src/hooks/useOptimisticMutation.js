import { useCallback } from 'react'

export function useOptimisticMutation({ apply, revert, fn, inverse, onToast }) {
  const run = useCallback(async () => {
    apply()
    try {
      await fn()
      onToast?.({
        type: 'success',
        message: 'Done',
        undo: inverse
          ? async () => {
              revert()
              await inverse()
            }
          : undefined,
      })
    } catch (err) {
      revert()
      onToast?.({ type: 'error', message: err.message ?? 'Action failed' })
    }
  }, [apply, revert, fn, inverse, onToast])

  return { run }
}
