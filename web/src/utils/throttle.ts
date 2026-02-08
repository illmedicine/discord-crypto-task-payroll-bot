export function throttle<T extends (...args: any[]) => void>(fn: T, wait = 100) {
  let last = 0
  let timeout: any = null
  return function(this: any, ...args: any[]) {
    const now = Date.now()
    if (now - last >= wait) {
      last = now
      fn.apply(this, args)
    } else {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        last = Date.now()
        fn.apply(this, args)
      }, wait - (now - last))
    }
  }
}
