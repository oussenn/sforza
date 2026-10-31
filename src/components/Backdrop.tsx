import { cn } from '@/lib/utils'

/**
 * The painting behind the app: sharp behind the sign-in page, blurred and washed with the editor colour behind
 * the editor. `animate` is on only when the sign-in page was shown, so signing in blurs it smoothly while a page
 * that opens already signed in starts blurred, without any motion.
 */
export function Backdrop({ blurred, animate }: { blurred: boolean; animate: boolean }) {
  const motion = animate ? 'duration-700 ease-out motion-reduce:transition-none' : ''
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--editor-bg)]">
      <img
        src="/background.webp"
        alt=""
        fetchPriority="high"
        className={cn('size-full object-cover', motion && `transition-[filter,transform] ${motion}`)}
        // Scaled up while blurred: a blur fades the picture's edges, which then fall outside the window.
        style={{ filter: `blur(${blurred ? 'var(--backdrop-blur)' : '0px'})`, transform: `scale(${blurred ? 1.1 : 1})` }}
      />
      <div className={cn('absolute inset-0 bg-[var(--editor-bg)]', blurred ? 'opacity-(--backdrop-wash)' : 'opacity-0', motion && `transition-opacity ${motion}`)} />
    </div>
  )
}
