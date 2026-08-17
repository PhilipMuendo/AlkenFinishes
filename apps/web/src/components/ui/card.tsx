import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-hairline bg-surface shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 sm:p-5', className)} {...props} />;
}

/**
 * A card's heading. `h2` by default because the page title is the `h1` and
 * cards sit directly under it — an `h3` there skipped a level, which is what a
 * screen reader's heading outline is built from. Pass `as="h3"` where a card
 * really is nested inside another titled section.
 */
export function CardTitle({
  className,
  as: Heading = 'h2',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }) {
  // Content arrives through the props spread, which the rule cannot see.
  // eslint-disable-next-line jsx-a11y/heading-has-content
  return <Heading className={cn('text-sm font-semibold text-fg', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />;
}
